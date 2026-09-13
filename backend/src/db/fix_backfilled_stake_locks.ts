/**
 * One-off fix: backfill_e2e_test_cases_v6.ts (before this fix) inserted
 * case_participants rows without ever setting `stakeLockedAt` — that
 * field is only ever set by the app's real fund-locking flow
 * (routes/cases.ts), which the backfill's test cases never went through
 * (created by calling the contract directly). The frontend's EscrowBar
 * component correctly derives "Locked"/"Pending" from this DB field, not
 * live chain state — so despite stakes genuinely being locked (and, for
 * settled cases, already paid out) on-chain, the UI showed "Pending" and
 * "0 GEN in escrow" regardless of actual case status.
 *
 * Fixes every already-backfilled case with a null stakeLockedAt on either
 * participant, deriving the real lock timestamp from the contract's own
 * event log (CASE_CREATED = claimant's stake locked at creation;
 * RESPONDENT_FUNDED = respondent's stake locked) — real on-chain
 * timestamps, not estimated ones. A case whose respondent never funded
 * (e.g. one cancelled pre-funding) correctly has no RESPONDENT_FUNDED
 * event and is left showing "Pending" for that side, which is accurate.
 *
 * Run via:
 *   flyctl ssh console --app verdict-backend --command "node dist/db/fix_backfilled_stake_locks.js"
 */
import "dotenv/config";
import { db } from "./client.js";
import { cases, caseParticipants } from "./schema.js";
import { isNotNull, isNull, eq, and } from "drizzle-orm";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT_ADDRESS = "0x41e2bD175ce730ec613e5977a069dC5061A271E2" as `0x${string}`;
const readClient = createClient({ chain: studionet });

async function getCaseEvents(id: number): Promise<Array<{ kind: string; ts: number }>> {
  return readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_case_events",
    args: [id, 200],
  }) as Promise<Array<{ kind: string; ts: number }>>;
}

async function main() {
  // Every case backfilled by this project's on-chain-direct test rounds
  // has a non-null contractCaseId; only those are candidates for this fix
  // (a normal user-created case already has real stakeLockedAt values
  // from its real funding flow and should never be touched).
  const candidateCases = await db.select().from(cases).where(isNotNull(cases.contractCaseId));

  let fixedCount = 0;
  for (const caseRow of candidateCases) {
    const participants = await db.select().from(caseParticipants).where(eq(caseParticipants.caseId, caseRow.id));
    const needsFix = participants.some((p) => p.stakeLockedAt === null);
    if (!needsFix) continue;

    const contractCaseId = Number(caseRow.contractCaseId);
    const events = await getCaseEvents(contractCaseId);
    const caseCreatedEvent = events.find((e) => e.kind === "CASE_CREATED");
    const respondentFundedEvent = events.find((e) => e.kind === "RESPONDENT_FUNDED");
    const claimantLockedAt = caseCreatedEvent ? new Date(caseCreatedEvent.ts * 1000) : null;
    const respondentLockedAt = respondentFundedEvent ? new Date(respondentFundedEvent.ts * 1000) : null;

    if (claimantLockedAt) {
      const updated = await db
        .update(caseParticipants)
        .set({ stakeLockedAt: claimantLockedAt })
        .where(and(eq(caseParticipants.caseId, caseRow.id), eq(caseParticipants.role, "claimant"), isNull(caseParticipants.stakeLockedAt)))
        .returning();
      if (updated.length > 0) console.log(`Case ${caseRow.caseNumber} (${contractCaseId}): claimant lockedAt -> ${claimantLockedAt.toISOString()}`);
    }
    if (respondentLockedAt) {
      const updated = await db
        .update(caseParticipants)
        .set({ stakeLockedAt: respondentLockedAt })
        .where(and(eq(caseParticipants.caseId, caseRow.id), eq(caseParticipants.role, "respondent"), isNull(caseParticipants.stakeLockedAt)))
        .returning();
      if (updated.length > 0) console.log(`Case ${caseRow.caseNumber} (${contractCaseId}): respondent lockedAt -> ${respondentLockedAt.toISOString()}`);
    }
    fixedCount += 1;
  }

  console.log(`Checked ${candidateCases.length} on-chain-backed case(s), fixed ${fixedCount}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
