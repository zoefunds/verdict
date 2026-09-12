/**
 * One-off backfill: the v5 contract 2-test round (2026-09-12, contract
 * 0xc4650C47245FDF354b1502FE9533BD944087cB88) created both test cases by
 * calling create_case/submit_evidence directly via genlayer-js, to run
 * every non-admin read/write method with precise, scriptable control —
 * bypassing the app's normal POST /cases -> wallet-signed on-chain tx ->
 * PATCH /cases/:id/link-contract flow entirely (same reason and same gap
 * as the prior v4 round's backfill_e2e_test_cases.ts). Backfills the exact
 * rows that flow would have created, pulling every value live from the
 * contract — no placeholders. Idempotent: skips any case/evidence id
 * already backfilled.
 *
 * Run via:
 *   flyctl ssh console --app verdict-backend --command "node dist/db/backfill_e2e_test_cases_v5.js"
 */
import "dotenv/config";
import { db } from "./client.js";
import { users, cases, caseParticipants, evidence, constitutionVersions } from "./schema.js";
import { eq } from "drizzle-orm";
import { getCase, getCaseEvidenceIds, getEvidence } from "../lib/genlayer-client.js";

const CASE_IDS = [0, 3];

const CLAIMANT_WALLET = "0xD958cd79b7a68Fb489507653B0fB146C5D798BF7";
const RESPONDENT_WALLET = "0x0C0fCF0C853206E73a465C43093CeeA85BBd342D";

// Same mapping table as backend/src/indexer/poll.ts's CONTRACT_STATUS_TO_DB_STATUS.
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
  0: "freelance",
  3: "marketplace",
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
      const onChainRespondent = String(onChain.respondent);
      const claimantIsWallet0 = onChainClaimant.toLowerCase() === CLAIMANT_WALLET.toLowerCase();
      const caseClaimantUserId = claimantIsWallet0 ? claimantUserId : respondentUserId;
      const caseRespondentUserId = claimantIsWallet0 ? respondentUserId : claimantUserId;

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

      await db.insert(caseParticipants).values([
        { caseId: caseDbId, userId: caseClaimantUserId, role: "claimant" },
        { caseId: caseDbId, userId: caseRespondentUserId, role: "respondent" },
      ]);
      console.log(`  -> participants inserted (claimant=${caseClaimantUserId}, respondent=${caseRespondentUserId})`);
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
