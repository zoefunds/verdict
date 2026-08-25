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

  /** Maps to `request_investigation(case_id)` — triggers the non-deterministic verdict pipeline. */
  async requestInvestigation(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "request_investigation", [args.contractCaseId]);
  },

  /** Maps to `settle_case(case_id)` — triggers payout after a verdict is rendered. */
  async settleCase(args: { account: `0x${string}`; contractCaseId: number }): Promise<{ txHash: string }> {
    return writeCase(args.account, "settle_case", [args.contractCaseId]);
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
