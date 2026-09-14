/**
 * One-off backfill: the v7 contract 2-test round (2026-09-14, contract
 * 0xe232251B11bbbf13C848d739914178F27D9F4a56 — a fresh redeployment;
 * requested explicitly: clear the database of prior claims, run 2 entirely
 * different product tests with real detailed data, covering every
 * non-admin read/write method, with zero errors on the explorer). Same
 * pattern as every prior round's backfill (v4/v5/v6): the test cases were
 * created by calling create_case/submit_evidence directly via genlayer-js
 * (scripts/verification/two_product_test_round.mjs) for precise,
 * scriptable control over every method — bypassing the app's normal
 * POST /cases -> wallet-signed on-chain tx -> PATCH /cases/:id/link-contract
 * flow, which never sees these cases and so never rows them into Postgres.
 * This backfills the exact rows that flow would have created, pulling
 * every value live from the contract — no placeholders. Idempotent: skips
 * any case/evidence id already backfilled.
 *
 * Run via:
 *   flyctl ssh console --app verdict-backend --command "node dist/db/backfill_e2e_test_cases_v7.js"
 */
import "dotenv/config";
import { db } from "./client.js";
import { users, cases, caseParticipants, evidence, constitutionVersions } from "./schema.js";
import { eq } from "drizzle-orm";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT_ADDRESS = "0xe232251B11bbbf13C848d739914178F27D9F4a56" as `0x${string}`;
const readClient = createClient({ chain: studionet });

async function getCase(id: number): Promise<Record<string, unknown>> {
  return readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_case", args: [id] }) as Promise<
    Record<string, unknown>
  >;
}
async function getCaseEvidenceIds(id: number): Promise<number[]> {
  return readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_case_evidence_ids",
    args: [id],
  }) as Promise<number[]>;
}
async function getCaseEvents(id: number, limit: number): Promise<Array<{ kind: string; ts: number }>> {
  return readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_case_events",
    args: [id, limit],
  }) as Promise<Array<{ kind: string; ts: number }>>;
}
async function getEvidence(id: number): Promise<Record<string, unknown>> {
  return readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_evidence", args: [id] }) as Promise<
    Record<string, unknown>
  >;
}

// Case A = SaaS integration milestone dispute (full appeal lifecycle),
// Case B = freelance logo design commission (cancelled pre-funding).
const CASE_IDS = [0, 4];

const CLAIMANT_WALLET = "0x2b269eba4A84ce04b9f8F449397538BE8FB86c43";
const RESPONDENT_WALLET = "0xB85C4975AB60929913Aa20112e4ee0031aCCFa16";

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

const CATEGORY_BY_CASE: Record<number, string> = {
  0: "professional_services",
  4: "creative_commission",
};

function evidenceTypeFromKind(kind: string): (typeof evidence.evidenceType.enumValues)[number] {
  if (kind === "URL") return "url";
  if (kind === "TX_RECORD") return "transaction_record";
  return "text_statement";
}

async function ensureUser(walletAddress: string): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.walletAddress, walletAddress)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(users).values({ walletAddress }).returning();
  if (!created) throw new Error(`Failed to create user for ${walletAddress}`);
  console.log(`Created user for ${walletAddress}: ${created.id}`);
  return created.id;
}

function randomCaseNumber(): string {
  return `VX-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function main() {
  const claimantUserId = await ensureUser(CLAIMANT_WALLET);
  const respondentUserId = await ensureUser(RESPONDENT_WALLET);

  const [currentConstitution] = await db
    .select()
    .from(constitutionVersions)
    .where(eq(constitutionVersions.isCurrent, true))
    .limit(1);
  if (!currentConstitution) throw new Error("No current constitution_versions row found — cannot backfill without one");

  for (const contractCaseId of CASE_IDS) {
    const [existingCase] = await db
      .select()
      .from(cases)
      .where(eq(cases.contractCaseId, String(contractCaseId)))
      .limit(1);

    let caseDbId: string;
    if (existingCase) {
      console.log(`Case ${contractCaseId} already backfilled as ${existingCase.id} — skipping case row, checking evidence`);
      caseDbId = existingCase.id;
    } else {
      const onChain = await getCase(contractCaseId);
      const dbStatus = CONTRACT_STATUS_TO_DB_STATUS[String(onChain.status)];
      if (!dbStatus) throw new Error(`Unknown on-chain status "${onChain.status}" for case ${contractCaseId}`);

      const onChainClaimant = String(onChain.claimant);
      const claimantIsWallet0 = onChainClaimant.toLowerCase() === CLAIMANT_WALLET.toLowerCase();
      const caseClaimantUserId = claimantIsWallet0 ? claimantUserId : respondentUserId;
      const caseRespondentUserId = claimantIsWallet0 ? respondentUserId : claimantUserId;
      const onChainRespondent = String(onChain.respondent);

      const [createdCase] = await db
        .insert(cases)
        .values({
          contractCaseId: String(contractCaseId),
          caseNumber: randomCaseNumber(),
          title: String(onChain.title),
          claimText: String(onChain.claim_text),
          resolutionRule: "Whichever side the evidence and constitution support should prevail, in whole or split proportionally.",
          category: CATEGORY_BY_CASE[contractCaseId] ?? "custom",
          status: dbStatus,
          constitutionVersionId: currentConstitution.id,
          createdByUserId: caseClaimantUserId,
          respondentAddress: onChainRespondent,
          stakeAmountWei: String(onChain.required_stake_wei),
          appealBondAmountWei: String(onChain.appeal_bond_wei ?? 0),
          settledAt: Boolean(onChain.settled) ? new Date(Number(onChain.verdict_rendered_at) * 1000 || Date.now()) : null,
        })
        .returning();
      if (!createdCase) throw new Error(`Failed to insert case row for contract case ${contractCaseId}`);
      caseDbId = createdCase.id;
      console.log(`Backfilled case ${contractCaseId} -> DB case ${caseDbId} (${createdCase.caseNumber}, status=${dbStatus})`);

      // Same fix as the v6 backfill: derive real stakeLockedAt timestamps
      // from the contract's own event log rather than leaving them null,
      // which would make a fully settled case display "Pending"/"0 GEN in
      // escrow" forever (see docs/SECURITY.md "v6 contract: 2-test round").
      const events = await getCaseEvents(contractCaseId, 200);
      const caseCreatedEvent = events.find((e) => e.kind === "CASE_CREATED");
      const respondentFundedEvent = events.find((e) => e.kind === "RESPONDENT_FUNDED");
      const claimantLockedAt = caseCreatedEvent ? new Date(caseCreatedEvent.ts * 1000) : null;
      const respondentLockedAt = respondentFundedEvent ? new Date(respondentFundedEvent.ts * 1000) : null;

      await db.insert(caseParticipants).values([
        { caseId: caseDbId, userId: caseClaimantUserId, role: "claimant", stakeLockedAt: claimantLockedAt },
        { caseId: caseDbId, userId: caseRespondentUserId, role: "respondent", stakeLockedAt: respondentLockedAt },
      ]);
      console.log(
        `  -> participants inserted (claimant=${caseClaimantUserId} lockedAt=${claimantLockedAt}, respondent=${caseRespondentUserId} lockedAt=${respondentLockedAt})`,
      );
    }

    const evidenceIds = await getCaseEvidenceIds(contractCaseId);
    for (const evId of evidenceIds) {
      const [existingEvidence] = await db
        .select()
        .from(evidence)
        .where(eq(evidence.contractEvidenceId, String(evId)))
        .limit(1);
      if (existingEvidence) {
        console.log(`  evidence ${evId} already backfilled — skipping`);
        continue;
      }

      const ev = await getEvidence(evId);
      const submittedByWallet = String(ev.submitted_by);
      const submittedByUserId =
        submittedByWallet.toLowerCase() === CLAIMANT_WALLET.toLowerCase() ? claimantUserId : respondentUserId;

      const isUrlKind = String(ev.kind) === "URL";
      const status = !isUrlKind ? "submitted" : ev.content_hash_matched ? "verified" : "verification_failed";

      await db.insert(evidence).values({
        caseId: caseDbId,
        submittedByUserId,
        contractEvidenceId: String(evId),
        evidenceType: evidenceTypeFromKind(String(ev.kind)),
        title: `${String(ev.kind)} evidence #${evId}`,
        description: String(ev.description ?? ""),
        sourceUrl: ev.url ? String(ev.url) : null,
        contentHashSha256: String(ev.content_hash),
        status,
        provenance: "contract_verified",
      });
      console.log(`  -> backfilled evidence ${evId} (${ev.kind}, hash_matched=${ev.content_hash_matched})`);
    }
  }

  console.log("Backfill complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
