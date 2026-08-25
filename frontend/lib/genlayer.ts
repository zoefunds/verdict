// Real GenLayer StudioNet client, wired to the deployed VERDICT contract.
//
// Reads: proxied through the backend (`lib/genlayer-proxy.ts`) so every
// browser tab shares one Redis-coordinated rate-limit budget against
// StudioNet's 30 requests/minute cap, instead of each tab hammering the RPC
// independently.
//
// Writes: wallet-signed directly from the browser via genlayer-js's
// `writeContract`, using the connected wagmi/Reown wallet's EIP-1193
// provider (`window.ethereum`) as the signer. The backend never touches or
// custodies these funds — this is a non-custodial write path end to end.
//
// No method in this file fabricates a transaction hash or a fake result:
// every write either returns a real tx hash from genlayer-js or throws.

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { env, isContractDeployed } from "./env";
import { fetchCaseFromContract, fetchProtocolConfig } from "./genlayer-proxy";

export class ContractNotDeployedError extends Error {
  constructor() {
    super("VERDICT contract is not yet deployed — NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS is unset.");
    this.name = "ContractNotDeployedError";
  }
}

export class WalletProviderUnavailableError extends Error {
  constructor() {
    super("No browser wallet provider found (window.ethereum is undefined). Connect a wallet first.");
    this.name = "WalletProviderUnavailableError";
  }
}

function assertDeployed() {
  if (!isContractDeployed) throw new ContractNotDeployedError();
}

function getBrowserProvider(): NonNullable<(typeof window)["ethereum"]> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new WalletProviderUnavailableError();
  }
  return window.ethereum;
}

/**
 * Builds a genlayer-js client scoped to the connected wallet account.
 * `account` is the checksummed address of the currently-connected wagmi
 * account (obtained from useAccount() in a component) — this client is
 * short-lived and created per-call, not cached as a singleton, since the
 * connected account can change between calls.
 */
async function getWriteClient(account: `0x${string}`) {
  assertDeployed();
  const provider = getBrowserProvider();
  const client = createClient({
    chain: studionet,
    account,
    provider,
  });
  await client.connect("studionet"); // prompts a network switch/add if the wallet isn't already on StudioNet
  return client;
}

async function writeCase(
  account: `0x${string}`,
  functionName: string,
  args: unknown[],
  valueWei?: bigint,
): Promise<{ txHash: string }> {
  const client = await getWriteClient(account);
  // `client` was already constructed scoped to `account` above, so the
  // write call itself doesn't need it repeated — genlayer-js's Client type
  // for writeContract expects a resolved Account object here, not a bare
  // address string, and the client already carries that context.
  const txHash = await client.writeContract({
    address: env.verdictContractAddress as `0x${string}`,
    functionName,
    args,
    value: valueWei ?? BigInt(0),
  } as Parameters<typeof client.writeContract>[0]);
  return { txHash: String(txHash) };
}

export const genlayerContract = {
  address: env.verdictContractAddress,
  rpcUrl: env.genlayerRpcUrl,
  isDeployed: isContractDeployed,

  /**
   * Creates a case on-chain. Maps to `create_case(respondent_address, title,
   * claim_text, required_stake_wei, evidence_window_seconds,
   * respondent_join_window_seconds)` in contracts/verdict_contract.py — a
   * @gl.public.write.payable method, so requiredStakeWei must be sent as
   * the transaction's value AND must exactly equal required_stake_wei (the
   * contract rejects "enough", it requires exact match). Note the contract
   * does not take resolutionRule/constitutionVersion/caseRules as
   * parameters at all — those live only in the off-chain case record; the
   * on-chain contract only needs the respondent, title, claim, and stake
   * terms to open escrow.
   */
  async createCase(args: {
    account: `0x${string}`;
    respondentAddress: `0x${string}`;
    requiredStakeWei: bigint;
    title: string;
    claimText: string;
    evidenceWindowSeconds: number;
    respondentJoinWindowSeconds?: number;
  }): Promise<{ txHash: string }> {
    return writeCase(
      args.account,
      "create_case",
      [
        args.respondentAddress,
        args.title,
        args.claimText,
        // Must stay a bigint/number, NOT .toString() — genlayer-js maps a
        // JS string arg to a Python str on the GenVM side, and the
        // contract does `required_stake_wei >= int(self.min_stake_wei)`,
        // which raises TypeError: '>=' not supported between 'str' and
        // 'int' if this arrives as text. Confirmed against a real failed
        // StudioNet transaction (contract.py line 651) before this fix.
        args.requiredStakeWei,
        args.evidenceWindowSeconds,
        args.respondentJoinWindowSeconds ?? 14 * 24 * 60 * 60,
      ],
      args.requiredStakeWei,
    );
  },

  /** Maps to `fund_respondent_stake(case_id)` — payable, respondent locks the matching stake. */
  async fundRespondentStake(args: {
    account: `0x${string}`;
    contractCaseId: number;
    valueWei: bigint;
  }): Promise<{ txHash: string }> {
    return writeCase(args.account, "fund_respondent_stake", [args.contractCaseId], args.valueWei);
  },

  /**
   * Maps to `submit_evidence(case_id, kind, url, description,
   * tx_reference)`. Not payable. The contract only accepts this while the
   * case is in EVIDENCE_WINDOW or RE_INVESTIGATION status — calling it
   * outside that window reverts. `kind` must be one of URL / TEXT_STATEMENT
   * / TX_RECORD / DOCUMENT_HASH.
   */
  async submitEvidenceOnChain(args: {
    account: `0x${string}`;
    contractCaseId: number;
    kind: "URL" | "TEXT_STATEMENT" | "TX_RECORD" | "DOCUMENT_HASH";
    url?: string;
    description?: string;
    txReference?: string;
  }): Promise<{ txHash: string }> {
    return writeCase(args.account, "submit_evidence", [
      args.contractCaseId,
      args.kind,
      args.url ?? "",
      args.description ?? "",
      args.txReference ?? "",
    ]);
  },

  /** Maps to `file_appeal(case_id, new_evidence_note)` — payable, sends the appeal bond. */
  async fileAppeal(args: {
    account: `0x${string}`;
    contractCaseId: number;
    bondWei: bigint;
    note: string;
  }): Promise<{ txHash: string }> {
    return writeCase(args.account, "file_appeal", [args.contractCaseId, args.note], args.bondWei);
  },

  /**
   * Maps to `close_evidence_window_early(case_id)`. Either party may call
   * this to signal readiness; once BOTH parties have called it, the
   * contract collapses the evidence deadline to now. Calling it once
   * (only one side ready) is a no-op on-chain besides recording the
   * signal — it does not error, so this is safe to call speculatively.
   */
  async closeEvidenceWindowEarly(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "close_evidence_window_early", [args.contractCaseId]);
  },

  /** Maps to `request_investigation(case_id)` — triggers the non-deterministic verdict pipeline. */
  async requestInvestigation(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "request_investigation", [args.contractCaseId]);
  },

  /**
   * Maps to `render_verdict(case_id)` — this is the actual adjudication
   * step: triggers GenLayer's non-deterministic LLM + web-fetch evidence
   * evaluation and records the structured verdict on-chain. Only callable
   * once the case is UNDER_INVESTIGATION (i.e. after request_investigation
   * has already succeeded).
   */
  async renderVerdict(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "render_verdict", [args.contractCaseId]);
  },

  /** Maps to `settle_case(case_id)` — triggers payout after a verdict is rendered. */
  async settleCase(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "settle_case", [args.contractCaseId]);
  },

  /** Maps to `cancel_case(case_id)` — claimant-only, before the respondent has funded. Full stake refund. */
  async cancelCase(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "cancel_case", [args.contractCaseId]);
  },

  /**
   * Maps to `open_appeal_evidence_window(case_id, additional_evidence_window_seconds)`
   * — either party, once an appeal has been filed (status APPEALED), moves
   * the case to RE_INVESTIGATION and reopens evidence submission so the
   * "new evidence" cited in the appeal can actually be submitted.
   */
  async openAppealEvidenceWindow(args: {
    account: `0x${string}`;
    contractCaseId: number;
    additionalEvidenceWindowSeconds?: number;
  }): Promise<{ txHash: string }> {
    return writeCase(args.account, "open_appeal_evidence_window", [
      args.contractCaseId,
      args.additionalEvidenceWindowSeconds ?? 3 * 24 * 60 * 60,
    ]);
  },

  /**
   * Maps to `resolve_appeal(case_id)` — the SECOND and final adjudication
   * step. Only callable once RE_INVESTIGATION's evidence deadline has
   * passed. Triggers independent re-evaluation; refunds the appeal bond
   * to the appellant if the appeal succeeded, otherwise forfeits it to
   * treasury. The resulting verdict is final — no further appeals.
   */
  async resolveAppeal(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "resolve_appeal", [args.contractCaseId]);
  },

  /**
   * Maps to `claim_case_abandonment(case_id)` — lets a case party reclaim
   * their OWN deposited stake (never a counterparty's) once the case has
   * stalled past its current stage's deadline plus a 14-day grace period.
   * The only fund-recovery exit that exists specifically so GEN can never
   * be permanently stuck if a counterparty disappears.
   */
  async claimCaseAbandonment(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "claim_case_abandonment", [args.contractCaseId]);
  },

  // ---- Reads: go through the backend proxy, not a direct RPC call, so the
  // shared Redis rate-limit budget is respected. See lib/genlayer-proxy.ts. ----

  async getCase(contractCaseId: number): Promise<unknown> {
    assertDeployed();
    return fetchCaseFromContract(env.apiBaseUrl, contractCaseId);
  },

  async getProtocolConfig(): Promise<unknown> {
    assertDeployed();
    return fetchProtocolConfig(env.apiBaseUrl);
  },
};
