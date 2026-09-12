#!/usr/bin/env node
/**
 * Reproducible StudioNet verification harness for VERDICT.
 *
 * Demonstrates a REAL dispute lifecycle against the deployed contract —
 * not a simulation, not a mock — covering everything a reviewer needs to
 * see happen for real: case creation and escrow, independent evidence
 * fetch, MATERIALLY CONFLICTING evidence from both sides, an appeal, real
 * GenVM consensus, and a real settlement that moves GEN.
 *
 * This is the same underlying pattern used throughout this project's own
 * development verification (see docs/SECURITY.md's "Live end-to-end
 * lifecycle audit" and "Multi-product live lifecycle audit" sections) —
 * formalized here into one committed, repeatable script instead of a
 * one-off scratch file, per the project's standing rule that GenLayer's
 * `write` CLI subcommand cannot send value with a payable call (see
 * contracts/README.md "Interacting with the deployed contract"), so
 * genlayer-js is used directly instead of the CLI for the payable steps.
 *
 * WHY THIS LIVES OUTSIDE CI: it needs two real, funded StudioNet private
 * keys and takes real wall-clock time (the contract enforces a hard
 * 1-hour minimum on evidence/re-investigation windows — see
 * docs/SECURITY.md "Real timing constraints discovered"). Never wire
 * funded keys or this script into an automated CI run. Run it by hand,
 * on demand, whenever you want to re-verify the deployed contract end to
 * end.
 *
 * Usage:
 *   VERDICT_CONTRACT_ADDRESS=0x... \
 *   CLAIMANT_PRIVATE_KEY=0x... \
 *   RESPONDENT_PRIVATE_KEY=0x... \
 *   node scripts/verification/lifecycle_demo.mjs
 *
 * Both private keys need real StudioNet test GEN (StudioNet is a
 * development network — GEN there is test currency, not real value).
 * Get keys via `genlayer account create` + `genlayer account export`, or
 * `ethers.Wallet.fromEncryptedJson(keystoreJson, password)` against an
 * existing `genlayer account create`d keystore file.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";

const CONTRACT_ADDRESS = requireEnv("VERDICT_CONTRACT_ADDRESS");
const CLAIMANT_PK = requireEnv("CLAIMANT_PRIVATE_KEY");
const RESPONDENT_PK = requireEnv("RESPONDENT_PRIVATE_KEY");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("See this file's header comment for usage.");
    process.exit(1);
  }
  return value;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function client(privateKey) {
  const account = createAccount(privateKey);
  return createClient({ chain: studionet, account });
}

const readClient = createClient({ chain: studionet });

/**
 * genlayer-js's `write` subcommand equivalent, done directly: submits a
 * transaction and waits for a finalized receipt. Retries once on a
 * genuine MAJORITY_DISAGREE (a real consensus split after all leader
 * rotations are exhausted — not a bug, see docs/SECURITY.md) with a
 * fresh leader/validator draw, since that's expected GenVM behavior for
 * a genuinely close/subjective judgment call, not something to treat as
 * a failure.
 */
async function write(privateKey, method, args, value = 0n, label = method, maxAttempts = 3) {
  const c = client(privateKey);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const txHash = await c.writeContract({ address: CONTRACT_ADDRESS, functionName: method, args, value });
    console.log(`[${label} attempt ${attempt}/${maxAttempts}] submitted: ${txHash}`);
    const receipt = await c.waitForTransactionReceipt({ hash: txHash, retries: 120, interval: 3000 });
    const statusName = receipt.statusName ?? receipt.status;
    const resultName = receipt.result_name ?? receipt.resultName;
    console.log(`[${label} attempt ${attempt}/${maxAttempts}] statusName=${statusName} result_name=${resultName}`);
    if (statusName === "FINALIZED") return { txHash, receipt };
    if (attempt < maxAttempts) {
      console.log(`[${label}] finalized as ${resultName} — genuine consensus non-agreement, retrying with a fresh call`);
      continue;
    }
    throw new Error(`${label} did not reach FINALIZED after ${maxAttempts} attempts (last: ${statusName}/${resultName})`);
  }
}

async function read(method, args = []) {
  return readClient.readContract({ address: CONTRACT_ADDRESS, functionName: method, args });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== VERDICT reproducible lifecycle demo ===");
  console.log(`Contract: ${CONTRACT_ADDRESS}`);

  const caseCount = await read("get_case_count");
  console.log(`Case count before: ${caseCount}`);

  // 1. Case creation with real escrowed collateral.
  const claim =
    "Demo dispute: contractor claims final invoice was never paid despite " +
    "written acceptance of delivered work. This is intentionally a scenario " +
    "with genuinely conflicting evidence from both sides (see step 4).";
  await write(
    CLAIMANT_PK,
    "create_case",
    [
      /* respondent_address */ createAccount(RESPONDENT_PK).address,
      "Reproducible verification demo case",
      claim,
      /* required_stake_wei */ 1_000_000_000_000_000_000n, // 1 GEN
      /* evidence_window_seconds */ 3600, // contract enforces a 1-hour floor regardless of the value passed
      /* respondent_join_window_seconds */ 3600,
    ],
    1_000_000_000_000_000_000n,
    "create_case",
  );
  const caseId = Number(await read("get_case_count")) - 1;
  console.log(`New case id: ${caseId}`);

  // 2. Respondent locks matching collateral — opens the evidence window.
  await write(RESPONDENT_PK, "fund_respondent_stake", [caseId], 1_000_000_000_000_000_000n, "fund_respondent_stake");

  // 3. Case-specific rule, exercising add_case_rule and demonstrating it
  // actually reaches the verdict prompt (see docs/SECURITY.md's test #4).
  await write(
    CLAIMANT_PK,
    "add_case_rule",
    [caseId, "For this case: written acceptance of delivered work obligates payment within 14 days absent a documented, timely quality dispute."],
    0n,
    "add_case_rule",
  );

  // 4. MATERIALLY CONFLICTING evidence from both sides — the specific
  // scenario the audit asked this harness to demonstrate.
  const claimantStatement = "Written acceptance email from respondent dated day of delivery: 'Work received, looks complete, will process payment this week.' No quality issues were ever raised afterward.";
  await write(
    CLAIMANT_PK,
    "submit_evidence",
    [caseId, "TEXT_STATEMENT", "", claimantStatement, "", sha256(claimantStatement)],
    0n,
    "submit_evidence(claimant)",
  );
  const respondentStatement = "The claimant's cited email was about a PARTIAL preview, not final delivery — final delivery never happened, and we raised specific missing-feature complaints in writing three days later that were never addressed.";
  await write(
    RESPONDENT_PK,
    "submit_evidence",
    [caseId, "TEXT_STATEMENT", "", respondentStatement, "", sha256(respondentStatement)],
    0n,
    "submit_evidence(respondent)",
  );

  // Collapse the evidence window instantly (both parties ready) rather
  // than waiting out the full window — close_evidence_window_early only
  // takes effect once BOTH sides have called it.
  await write(CLAIMANT_PK, "close_evidence_window_early", [caseId], 0n, "close_evidence_window_early(claimant)");
  await write(RESPONDENT_PK, "close_evidence_window_early", [caseId], 0n, "close_evidence_window_early(respondent)");

  // 5. Trigger investigation, then the real GenVM consensus verdict.
  await write(CLAIMANT_PK, "request_investigation", [caseId], 0n, "request_investigation");
  await write(CLAIMANT_PK, "render_verdict", [caseId], 0n, "render_verdict");

  const firstVerdict = await read("get_case", [caseId]);
  console.log("FIRST VERDICT:", JSON.stringify(firstVerdict, null, 2));
  console.log("Structured findings (evidence-linked, not just outcome + prose):");
  console.log("  claim_findings:", firstVerdict.claim_findings);
  console.log("  evidence_findings:", firstVerdict.evidence_findings);

  // 6. Appeal, with new evidence specifically addressing the first
  // verdict's stated reasoning.
  const appealBondBps = Number((await read("get_protocol_config")).appeal_bond_bps);
  const totalStake = 2_000_000_000_000_000_000n;
  const bondWei = (totalStake * BigInt(appealBondBps)) / 10000n;
  await write(RESPONDENT_PK, "file_appeal", [caseId, "Submitting the actual dated bug-report thread omitted from the first round."], bondWei, "file_appeal");
  await write(RESPONDENT_PK, "open_appeal_evidence_window", [caseId, 3600], 0n, "open_appeal_evidence_window");
  const newEvidence = "Dated bug-report thread, three separate messages over 5 days, each specifying a distinct missing feature, sent before any payment demand.";
  await write(RESPONDENT_PK, "submit_evidence", [caseId, "TEXT_STATEMENT", "", newEvidence, "", sha256(newEvidence)], 0n, "submit_evidence(new appeal evidence)");
  await write(RESPONDENT_PK, "close_evidence_window_early", [caseId], 0n, "close_evidence_window_early(respondent, appeal)");
  await write(CLAIMANT_PK, "close_evidence_window_early", [caseId], 0n, "close_evidence_window_early(claimant, appeal)");

  // The re-investigation window still enforces the real on-chain 1-hour
  // floor even after both parties signal ready via close_evidence_window_early —
  // see docs/SECURITY.md. This harness waits for real; it is not sped up.
  const caseAfterAppeal = await read("get_case", [caseId]);
  const deadline = Number(caseAfterAppeal.evidence_deadline);
  const waitMs = Math.max(0, deadline * 1000 - Date.now()) + 5000;
  console.log(`Waiting ${Math.round(waitMs / 1000)}s for the real on-chain re-investigation window to close...`);
  await sleep(waitMs);

  // 7. Resolve the appeal — second, final, independent verdict.
  await write(CLAIMANT_PK, "resolve_appeal", [caseId], 0n, "resolve_appeal");
  const finalVerdict = await read("get_case", [caseId]);
  console.log("FINAL VERDICT (post-appeal):", JSON.stringify(finalVerdict, null, 2));

  // 8. Real settlement — moves real GEN according to the final verdict.
  await write(CLAIMANT_PK, "settle_case", [caseId], 0n, "settle_case");
  const settled = await read("get_case", [caseId]);
  console.log(`Settled: ${settled.settled}, status: ${settled.status}`);

  console.log(`\n=== Demo complete. Inspect case ${caseId} on the GenLayer Studio explorer to verify independently. ===`);
}

main().catch((err) => {
  console.error("Lifecycle demo failed:", err);
  process.exit(1);
});
