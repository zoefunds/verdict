/**
 * Polling indexer: syncs on-chain VERDICT case state into Postgres so the
 * frontend/casebook can browse/search quickly. This is a DERIVED index,
 * never the source of truth — every write here is idempotent (upsert) and
 * the whole table set can be safely truncated and rebuilt by re-running
 * this poll loop against the contract's view methods.
 *
 * Runs as a long-lived loop when started via indexer/run.ts. Does nothing
 * (logs a warning once and idles) if VERDICT_CONTRACT_ADDRESS is not yet
 * configured, so local/dev/pre-deployment environments don't crash-loop.
 */

import { db } from "../db/client.js";
import { cases } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getCaseCount, getCase, isContractConfigured } from "../lib/genlayer-client.js";

const CONTRACT_STATUS_TO_DB_STATUS: Record<string, (typeof cases.status.enumValues)[number]> = {
  DRAFT: "draft",
  OPEN: "open",
  AWAITING_RESPONDENT_STAKE: "awaiting_respondent_stake",
  FUNDED: "funded",
  EVIDENCE_WINDOW: "evidence_window",
  UNDER_INVESTIGATION: "under_investigation",
  VERDICT_RENDERED: "verdict_rendered",
  APPEAL_WINDOW: "appeal_window",
  APPEALED: "appealed",
  RE_INVESTIGATION: "re_investigation",
  FINAL: "final",
  SETTLED: "settled",
  CANCELLED: "cancelled",
  ABANDONED_REFUNDED: "abandoned",
};

export async function syncOneCase(contractCaseId: number): Promise<void> {
  const onChain = await getCase(contractCaseId);
  const status = CONTRACT_STATUS_TO_DB_STATUS[String(onChain.status)];
  if (!status) {
    console.warn(`[indexer] unknown on-chain status "${onChain.status}" for case ${contractCaseId}, skipping`);
    return;
  }

  const [existing] = await db
    .select()
    .from(cases)
    .where(eq(cases.contractCaseId, String(contractCaseId)))
    .limit(1);

  if (!existing) {
    // The case row should already exist as a DRAFT (created via POST /cases
    // and linked via PATCH /cases/:id/link-contract before the on-chain tx
    // was even submitted). If it's missing here, the off-chain and on-chain
    // records have diverged — log loudly rather than silently fabricating a
    // case row with placeholder claim text.
    console.error(
      `[indexer] contract case ${contractCaseId} has no matching DB row — off-chain/on-chain state has diverged, manual review needed`,
    );
    return;
  }

  if (existing.status !== status) {
    await db
      .update(cases)
      .set({
        status,
        settledAt: status === "settled" ? new Date() : existing.settledAt,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, existing.id));
    console.log(`[indexer] case ${contractCaseId}: ${existing.status} -> ${status}`);
  }
}

/**
 * Returns whether the cycle completed a real read from the contract (true)
 * or was skipped/failed before that point (false). AUDIT FIX (2026-08-25):
 * the caller (indexer/run.ts) uses this to back off on sustained failures
 * — a fixed-interval retry-forever loop was observed live to keep hammering
 * StudioNet at the same rate even while every single call was being
 * rejected with "Rate limit exceeded: 5000 requests per day". If rejected
 * calls still count against that daily counter (plausible — StudioNet has
 * to receive and evaluate the request to reject it), blind fixed-interval
 * retrying can perpetuate its own exhaustion instead of giving the quota
 * room to recover.
 */
export async function syncAllCases(): Promise<boolean> {
  if (!isContractConfigured()) {
    console.warn("[indexer] VERDICT_CONTRACT_ADDRESS not configured — skipping sync cycle");
    return false;
  }

  let count: number;
  try {
    count = await getCaseCount();
  } catch (err) {
    console.error("[indexer] failed to read case count from contract", err);
    return false;
  }

  // Case ids are 0-indexed (contracts/verdict_contract.py create_case:
  // `case_id = int(self.case_count)` before incrementing), so valid ids
  // run from 0 to count-1 inclusive — starting this loop at 1 skipped
  // case 0 entirely and queried a nonexistent case at `count`, which is
  // exactly the bug that left case 0 stuck showing stale status.
  for (let id = 0; id < count; id += 1) {
    try {
      await syncOneCase(id);
    } catch (err) {
      // One bad case must never halt the whole sync cycle.
      console.error(`[indexer] failed to sync case ${id}`, err);
    }
  }
  return true;
}
