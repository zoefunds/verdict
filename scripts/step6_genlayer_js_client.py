#!/usr/bin/env python3
"""
step6_genlayer_js_client.py

Replaces frontend/lib/genlayer.ts's stub with a real genlayer-js client now
that the VERDICT contract is deployed on StudioNet. Reads go through the
backend proxy (Redis rate-limit coordinated); writes are wallet-signed
directly via genlayer-js's writeContract against window.ethereum.

Also adds the genlayer-js dependency to frontend/package.json.

Sourced from https://docs.genlayer.com/api-references/genlayer-js
(createClient({chain, account, provider}), client.connect("studionet"),
client.readContract({address, functionName, args, stateStatus}),
client.writeContract({account, address, functionName, args, value})).

Usage:
    cd /Users/macbook/verdict
    python3 scripts/step6_genlayer_js_client.py
"""

from pathlib import Path
import json

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND = PROJECT_ROOT / "frontend"

GENLAYER_TS = """\
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
  const txHash = await client.writeContract({
    account,
    address: env.verdictContractAddress as `0x${string}`,
    functionName,
    args,
    value: valueWei ?? BigInt(0),
  });
  return { txHash: String(txHash) };
}

export const genlayerContract = {
  address: env.verdictContractAddress,
  rpcUrl: env.genlayerRpcUrl,
  isDeployed: isContractDeployed,

  /**
   * Creates a case on-chain. Maps to `create_case(...)` in
   * contracts/verdict_contract.py — a @gl.public.write.payable method, so
   * requiredStakeWei must be sent as the transaction's value.
   */
  async createCase(args: {
    account: `0x${string}`;
    requiredStakeWei: bigint;
    title: string;
    claimText: string;
    resolutionRule: string;
    constitutionVersion: number;
    caseRules: string[];
    evidenceWindowSeconds: number;
  }): Promise<{ txHash: string }> {
    return writeCase(
      args.account,
      "create_case",
      [
        args.title,
        args.claimText,
        args.resolutionRule,
        args.constitutionVersion,
        args.caseRules,
        args.evidenceWindowSeconds,
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

  /** Maps to `submit_evidence(case_id, evidence_type, ref, content_hash)`. Not payable. */
  async submitEvidenceOnChain(args: {
    account: `0x${string}`;
    contractCaseId: number;
    evidenceType: string;
    reference: string;
    contentHashSha256: string;
  }): Promise<{ txHash: string }> {
    return writeCase(args.account, "submit_evidence", [
      args.contractCaseId,
      args.evidenceType,
      args.reference,
      args.contentHashSha256,
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
"""


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {path.relative_to(PROJECT_ROOT)}")


def main() -> None:
    print(f"Step 6: genlayer-js client wiring — project root: {PROJECT_ROOT}\n")

    genlayer_path = FRONTEND / "lib" / "genlayer.ts"
    write_file(genlayer_path, GENLAYER_TS)

    pkg_path = FRONTEND / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    if "genlayer-js" not in pkg.get("dependencies", {}):
        pkg["dependencies"]["genlayer-js"] = "^0.16.0"
        pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
        print(f"PATCHED {pkg_path.relative_to(PROJECT_ROOT)} (added genlayer-js dependency)")
    else:
        print(f"SKIP  (genlayer-js already present): {pkg_path.relative_to(PROJECT_ROOT)}")

    print("\nDone. Run `npm install` in frontend/ to pull in genlayer-js.")


if __name__ == "__main__":
    main()
