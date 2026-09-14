#!/usr/bin/env node
/**
 * Two-product live verification round for a fresh contract deployment
 * (requested 2026-09-14): after clearing the database of prior claims,
 * run 2 entirely different product disputes against the newly deployed
 * contract, exercising every non-admin read AND write method, with real
 * detailed (non-placeholder) data, and zero reverted transactions on the
 * explorer.
 *
 * Built on scripts/verification/lifecycle_demo.mjs's proven pattern
 * (genlayer-js directly, not the CLI, since `genlayer write` cannot send
 * payable value). One correction versus that script: close_evidence_window_early
 * only applies while status is EVIDENCE_WINDOW — calling it again after
 * open_appeal_evidence_window (status RE_INVESTIGATION) would revert, so
 * the re-investigation window is genuinely waited out in full here
 * instead (no shortcut exists for that window).
 *
 * Case A — "SaaS integration project, milestone non-payment" — full
 *   lifecycle including a real appeal: create_case, add_case_rule,
 *   fund_respondent_stake, submit_evidence (x4 across both rounds),
 *   close_evidence_window_early (x2), request_investigation,
 *   render_verdict, file_appeal, open_appeal_evidence_window,
 *   resolve_appeal, settle_case.
 * Case B — "Freelance logo design commission" — claimant cancels before
 *   the respondent ever funds: create_case, cancel_case.
 *
 * Together: every non-admin write method except claim_case_abandonment
 * (needs a real 14-day stall — out of scope for a live round, same as
 * every prior round) and every non-admin view method.
 *
 * Usage:
 *   VERDICT_CONTRACT_ADDRESS=0x... \
 *   CLAIMANT_PRIVATE_KEY=0x... \
 *   RESPONDENT_PRIVATE_KEY=0x... \
 *   node scripts/verification/two_product_test_round.mjs
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const CONTRACT_ADDRESS = requireEnv("VERDICT_CONTRACT_ADDRESS");
const CLAIMANT_PK = requireEnv("CLAIMANT_PRIVATE_KEY");
const RESPONDENT_PK = requireEnv("RESPONDENT_PRIVATE_KEY");

const transcript = [];
function log(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ");
  console.log(line);
  transcript.push(line);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
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
const CLAIMANT_ADDRESS = createAccount(CLAIMANT_PK).address;
const RESPONDENT_ADDRESS = createAccount(RESPONDENT_PK).address;

// genlayer-js's waitForTransactionReceipt defaults to status:"ACCEPTED" and
// returns as soon as consensus is decided, well before true on-chain
// finality — its simplified receipt then carries only numeric `status`/
// `result` fields, not the human-readable names its docs might suggest.
// Explicitly requesting status:"FINALIZED" below makes it actually poll
// until real finality (numeric 7); these two maps mirror genlayer-js's own
// internal tables so results can be judged by name instead of magic numbers.
const STATUS_NUMBER_TO_NAME = { 0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING", 4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED", 9: "APPEAL_REVEALING", 10: "APPEAL_COMMITTING", 11: "READY_TO_FINALIZE", 12: "VALIDATORS_TIMEOUT", 13: "LEADER_TIMEOUT" };
const RESULT_NUMBER_TO_NAME = { 0: "IDLE", 1: "AGREE", 2: "DISAGREE", 3: "TIMEOUT", 4: "DETERMINISTIC_VIOLATION", 5: "NO_MAJORITY", 6: "MAJORITY_AGREE", 7: "MAJORITY_DISAGREE" };

async function write(privateKey, method, args, value = 0n, label = method, maxAttempts = 4) {
  const c = client(privateKey);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const txHash = await c.writeContract({ address: CONTRACT_ADDRESS, functionName: method, args, value });
    log(`[${label} attempt ${attempt}/${maxAttempts}] submitted: ${txHash}`);
    const receipt = await c.waitForTransactionReceipt({ hash: txHash, status: "FINALIZED", retries: 150, interval: 3000 });
    const statusName = STATUS_NUMBER_TO_NAME[Number(receipt.status)] ?? String(receipt.status);
    const resultName = RESULT_NUMBER_TO_NAME[Number(receipt.result)] ?? String(receipt.result);
    const leaderExecResult = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
    log(`[${label} attempt ${attempt}/${maxAttempts}] statusName=${statusName} resultName=${resultName} leaderExecResult=${leaderExecResult} tx=${txHash}`);
    if (statusName !== "FINALIZED") {
      throw new Error(`${label} unexpectedly not FINALIZED (tx ${txHash}): statusName=${statusName}`);
    }
    if (leaderExecResult && leaderExecResult !== "SUCCESS") {
      // A real revert (e.g. gl.vm.UserError) — never silently treat this as
      // success or blindly retry; surface it immediately.
      throw new Error(`${label} REVERTED on-chain (tx ${txHash}): leader execution_result=${leaderExecResult}. Fix the call before proceeding.`);
    }
    if (resultName === "AGREE" || resultName === "MAJORITY_AGREE") {
      return { txHash, receipt };
    }
    if (resultName === "DISAGREE" || resultName === "MAJORITY_DISAGREE") {
      if (attempt < maxAttempts) {
        log(`[${label}] finalized as ${resultName} — genuine consensus non-agreement, retrying with a fresh call`);
        continue;
      }
      throw new Error(`${label} did not reach agreement after ${maxAttempts} attempts (last: ${resultName})`);
    }
    throw new Error(`${label} finalized with unexpected result ${resultName} (tx ${txHash}) — investigate before proceeding.`);
  }
}

async function read(method, args = [], label = method) {
  const result = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: method, args });
  log(`[read ${label}]`, result);
  return result;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  log("=== VERDICT two-product live verification round ===");
  log(`Contract: ${CONTRACT_ADDRESS}`);
  log(`Claimant wallet:   ${CLAIMANT_ADDRESS}`);
  log(`Respondent wallet: ${RESPONDENT_ADDRESS}`);

  // ---- Baseline read-method sweep (protocol-level, before any case exists) ----
  await read("get_case_count", [], "get_case_count (before)");
  await read("get_current_constitution_version", [], "get_current_constitution_version");
  const constitutionVersion = Number(await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_current_constitution_version", args: [] }));
  await read("get_constitution", [constitutionVersion], "get_constitution");
  await read("get_protocol_config", [], "get_protocol_config (before)");
  await read("get_metrics", [], "get_metrics (before)");

  // =========================================================================
  // CASE A — SaaS integration project, milestone non-payment (full lifecycle)
  // =========================================================================
  log("\n--- CASE A: SaaS integration project, milestone non-payment ---");

  const stakeA = 2_000_000_000_000_000_000n; // 2 GEN each side
  const resumeCaseIdA = process.env.RESUME_CASE_ID_A;
  let caseIdA;
  if (resumeCaseIdA !== undefined) {
    caseIdA = Number(resumeCaseIdA);
    log(`Resuming Case A at existing id ${caseIdA} (create_case already succeeded in a prior run)`);
  } else {
    const titleA = "SaaS integration milestone 2 payment dispute";
    const claimA =
      "I was contracted to build a Stripe-to-NetSuite invoice sync integration for the respondent's finance team, billed in three milestones. Milestone 2 (webhook-driven invoice creation, covering the agreed scope of 6 invoice types and idempotent retry handling) was delivered on the agreed date with a recorded demo and a passing test suite the respondent's own QA lead signed off on in writing. The respondent has since refused to pay the $4,200 milestone 2 invoice, claiming the integration is 'incomplete', but has not specified what scope item is missing, and continued using the integration in production for 11 days after the QA sign-off before raising any complaint.";
    await write(
      CLAIMANT_PK,
      "create_case",
      [RESPONDENT_ADDRESS, titleA, claimA, stakeA, 3600, 3600],
      stakeA,
      "create_case(A)",
    );
    const caseCountAfterA = Number(await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_case_count", args: [] }));
    caseIdA = caseCountAfterA - 1;
  }
  log(`Case A id: ${caseIdA}`);

  // add_case_rule is only allowed before the evidence window opens
  // (DRAFT/OPEN/AWAITING_RESPONDENT_STAKE/FUNDED) — fund_respondent_stake
  // transitions straight to EVIDENCE_WINDOW with no intermediate step, so
  // this MUST run first. Confirmed the hard way: calling it after funding
  // reverts on-chain with "case rules are frozen once the evidence window
  // opens" (a real, correctly-enforced revert, not a bug) — when resuming
  // past a case that's already funded, this step is skipped for Case A and
  // exercised on Case B instead (see below), so the method is still
  // covered exactly once across the round.
  if (resumeCaseIdA === undefined) {
    await write(
      CLAIMANT_PK,
      "add_case_rule",
      [caseIdA, "For this case: a written QA sign-off from the respondent's own staff, followed by continued production use without objection, is strong evidence the delivered milestone met the agreed scope."],
      0n,
      "add_case_rule(A)",
    );
  } else {
    log("Skipping add_case_rule(A): case A's evidence window is already open in this resumed run (exercised on Case B instead).");
  }

  if (resumeCaseIdA === undefined) {
    await write(RESPONDENT_PK, "fund_respondent_stake", [caseIdA], stakeA, "fund_respondent_stake(A)");
  } else {
    log("Skipping fund_respondent_stake(A): already funded in a prior run (case is in EVIDENCE_WINDOW).");
  }

  const claimantEvidence1 =
    "Slack message from respondent's QA lead, dated the delivery day: 'Ran the full milestone 2 test suite against staging, all 6 invoice types pass including the idempotency retry cases. Signing off, nice work.' Screenshot hash committed on submission.";
  await write(
    CLAIMANT_PK,
    "submit_evidence",
    [caseIdA, "TEXT_STATEMENT", "", claimantEvidence1, "", sha256(claimantEvidence1)],
    0n,
    "submit_evidence(A, claimant #1)",
  );
  const claimantEvidence2 =
    "Server access logs (tx_reference to respondent's own NetSuite audit trail export) showing the integration's webhook endpoint was actively receiving and processing real invoice events in the respondent's production NetSuite account for 11 consecutive days after QA sign-off, with zero error-rate spikes reported.";
  await write(
    CLAIMANT_PK,
    "submit_evidence",
    [caseIdA, "TX_RECORD", "", claimantEvidence2, "netsuite-audit-export-20260901-20260912", sha256(claimantEvidence2)],
    0n,
    "submit_evidence(A, claimant #2)",
  );
  const respondentEvidence1 =
    "Internal email (not shared with claimant until now) from our finance director dated 9 days after QA sign-off: 'the sync is dropping partial-refund line items on invoice type 4, we noticed this in week 2 of production use and are still evaluating full impact.' We maintain milestone 2's scope explicitly included correct handling of partial refunds.";
  await write(
    RESPONDENT_PK,
    "submit_evidence",
    [caseIdA, "TEXT_STATEMENT", "", respondentEvidence1, "", sha256(respondentEvidence1)],
    0n,
    "submit_evidence(A, respondent #1)",
  );

  await write(CLAIMANT_PK, "close_evidence_window_early", [caseIdA], 0n, "close_evidence_window_early(A, claimant)");
  await write(RESPONDENT_PK, "close_evidence_window_early", [caseIdA], 0n, "close_evidence_window_early(A, respondent)");

  await write(CLAIMANT_PK, "request_investigation", [caseIdA], 0n, "request_investigation(A)");
  await write(CLAIMANT_PK, "render_verdict", [caseIdA], 0n, "render_verdict(A)");

  const firstVerdictA = await read("get_case", [caseIdA], "get_case(A) after first verdict");
  await read("get_case_evidence_ids", [caseIdA], "get_case_evidence_ids(A)");
  const evidenceIdsA = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_case_evidence_ids", args: [caseIdA] });
  for (const eid of evidenceIdsA) {
    await read("get_evidence", [Number(eid)], `get_evidence(A, ${eid})`);
  }
  await read("get_case_rules", [caseIdA], "get_case_rules(A)");
  await read("get_case_events", [caseIdA, 50], "get_case_events(A)");

  // Appeal: respondent submits the partial-refund evidence they'd held back,
  // directly addressing the first verdict's evidentiary basis.
  const configBefore = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_protocol_config", args: [] });
  const appealBondBps = Number(configBefore.appeal_bond_bps);
  const bondWeiA = (stakeA * 2n * BigInt(appealBondBps)) / 10000n;
  const bondA = bondWeiA > 0n ? bondWeiA : 1n;
  await write(
    RESPONDENT_PK,
    "file_appeal",
    [caseIdA, "Filing an appeal to submit the specific bug ticket and screen recording showing the partial-refund line-item defect on invoice type 4, which was only referenced generally in the first round."],
    bondA,
    "file_appeal(A)",
  );
  await write(RESPONDENT_PK, "open_appeal_evidence_window", [caseIdA, 3600], 0n, "open_appeal_evidence_window(A)");

  const respondentAppealEvidence =
    "Bug tracker ticket #INT-204, filed 9 days post-sign-off: 'Invoice type 4 partial refunds: sync drops the refunded line item entirely instead of creating a negative adjustment line, confirmed on 3 separate live invoices (#8821, #8830, #8842). Screen recording attached showing NetSuite ledger mismatch of $612 total across the 3 invoices.' This directly contradicts the claim that continued use meant no defect existed.";
  await write(
    RESPONDENT_PK,
    "submit_evidence",
    [caseIdA, "TX_RECORD", "", respondentAppealEvidence, "bugtracker-INT-204", sha256(respondentAppealEvidence)],
    0n,
    "submit_evidence(A, appeal — respondent)",
  );

  // No early-close exists for the re-investigation window — the contract
  // enforces a genuine 1-hour minimum here (see file header). Wait for real.
  const caseAfterAppealA = await read("get_case", [caseIdA], "get_case(A) after file_appeal/open_appeal_evidence_window");
  const deadlineA = Number(caseAfterAppealA.evidence_deadline);
  const waitMsA = Math.max(0, deadlineA * 1000 - Date.now()) + 15000;
  log(`Waiting ${Math.round(waitMsA / 1000)}s for Case A's real on-chain re-investigation window to close...`);
  await sleep(waitMsA);

  await write(CLAIMANT_PK, "resolve_appeal", [caseIdA], 0n, "resolve_appeal(A)");
  const finalVerdictA = await read("get_case", [caseIdA], "get_case(A) final verdict");

  await write(CLAIMANT_PK, "settle_case", [caseIdA], 0n, "settle_case(A)");
  const settledA = await read("get_case", [caseIdA], "get_case(A) settled");

  // =========================================================================
  // CASE B — Freelance logo design commission (cancelled pre-funding)
  // =========================================================================
  log("\n--- CASE B: Freelance logo design commission (cancelled before funding) ---");

  const titleB = "Freelance logo design commission deposit dispute";
  const claimB =
    "I paid a 50% deposit for a freelance logo design commission (3 initial concepts, 2 revision rounds) with a 10-business-day delivery target. I'm opening this case as a precaution because the respondent has been slow to respond to messages, but we have since resolved this privately: the respondent refunded my deposit in full via a separate payment before ever accepting this case on-chain, so I'm withdrawing this claim rather than proceeding.";
  await write(
    CLAIMANT_PK,
    "create_case",
    [RESPONDENT_ADDRESS, titleB, claimB, 500_000_000_000_000_000n, 3600, 3600],
    500_000_000_000_000_000n,
    "create_case(B)",
  );
  const caseCountAfterB = Number(await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_case_count", args: [] }));
  const caseIdB = caseCountAfterB - 1;
  log(`Case B id: ${caseIdB}`);

  await read("get_case", [caseIdB], "get_case(B) before cancel");
  // add_case_rule covered here instead of Case A, since Case A's resumed
  // run had already opened its evidence window (see comment above).
  await write(
    CLAIMANT_PK,
    "add_case_rule",
    [caseIdB, "For this case: a private refund confirmed by both parties before respondent funding supersedes the on-chain claim."],
    0n,
    "add_case_rule(B)",
  );
  await write(CLAIMANT_PK, "cancel_case", [caseIdB], 0n, "cancel_case(B)");
  const cancelledB = await read("get_case", [caseIdB], "get_case(B) after cancel");

  // ---- Final read-method sweep ----
  await read("get_case_count", [], "get_case_count (after)");
  await read("get_protocol_config", [], "get_protocol_config (after)");
  await read("get_metrics", [], "get_metrics (after)");

  log("\n=== Two-product test round complete ===");
  log(`Case A: id=${caseIdA}, final status=${settledA.status}, settled=${settledA.settled}`);
  log(`Case B: id=${caseIdB}, final status=${cancelledB.status}, settled=${cancelledB.settled}`);
  log(`Inspect both on the GenLayer Studio explorer: ${CONTRACT_ADDRESS}`);

  writeFileSync(new URL("./two_product_test_round.transcript.log", import.meta.url), transcript.join("\n"));
  writeFileSync(
    new URL("./two_product_test_round.result.json", import.meta.url),
    JSON.stringify({ caseIdA, caseIdB, firstVerdictA, finalVerdictA, settledA, cancelledB }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
}

main().catch((err) => {
  console.error("Two-product test round failed:", err);
  writeFileSync(new URL("./two_product_test_round.transcript.log", import.meta.url), transcript.join("\n"));
  process.exit(1);
});
