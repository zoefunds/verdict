/**
 * One-off backfill: the live end-to-end lifecycle audit (2026-08-25)
 * submitted evidence directly on-chain via genlayer-js (to isolate testing
 * the contract's own consensus behavior), bypassing the app's normal
 * POST /evidence/text -> PATCH /evidence/:id/link-contract flow entirely.
 * That left the on-chain evidence (case 0, evidence id 0) with no
 * corresponding Postgres row, so it never appears in the frontend's
 * evidence timeline even though it's real and correct on-chain — confirmed
 * via `genlayer call ... get_evidence 0`. This backfills exactly the row
 * that flow would have created, using the real on-chain values, not
 * placeholders.
 *
 * Run via:
 *   flyctl ssh console --app verdict-backend --command "node dist/db/backfill_test_evidence.js"
 */
import "dotenv/config";
import { db } from "./client.js";
import { evidence, caseParticipants, users } from "./schema.js";
import { eq, and } from "drizzle-orm";

const CASE_DB_ID = "05935c6f-709d-4943-a94a-922b9b8d4c06";
const CLAIMANT_WALLET = "0xD958cd79b7a68Fb489507653B0fB146C5D798BF7"; // stored checksummed, not lowercase — confirmed against the real users row

async function main() {
  const [claimantUser] = await db.select().from(users).where(eq(users.walletAddress, CLAIMANT_WALLET)).limit(1);
  if (!claimantUser) {
    throw new Error(`No user row found for wallet ${CLAIMANT_WALLET} — cannot backfill without a submitter`);
  }

  const [participant] = await db
    .select()
    .from(caseParticipants)
    .where(and(eq(caseParticipants.caseId, CASE_DB_ID), eq(caseParticipants.userId, claimantUser.id)))
    .limit(1);
  if (!participant) {
    throw new Error(`No case_participants row for user ${claimantUser.id} on case ${CASE_DB_ID}`);
  }

  const [existing] = await db.select().from(evidence).where(eq(evidence.contractEvidenceId, "0")).limit(1);
  if (existing) {
    console.log("Evidence already backfilled:", existing.id);
    process.exit(0);
  }

  const [created] = await db
    .insert(evidence)
    .values({
      caseId: CASE_DB_ID,
      submittedByUserId: claimantUser.id,
      contractEvidenceId: "0",
      evidenceType: "url",
      title: "E2E audit test evidence",
      description: "The audit harness's own submitted evidence, hashed server-side exactly as the backend evidence route would.",
      sourceUrl: "https://example.com",
      contentHashSha256: "d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8",
      status: "verification_failed", // real on-chain content_hash_matched: false at verdict time — see contracts/README.md's residual-limitation note
      provenance: "contract_verified", // independently_fetched: true on-chain
    })
    .returning();

  if (!created) throw new Error("Insert returned no row");
  console.log("Backfilled evidence row:", created.id, "-> contractEvidenceId", created.contractEvidenceId);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
