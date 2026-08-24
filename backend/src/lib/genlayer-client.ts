/**
 * GenLayer StudioNet read client, backing both the indexer and the
 * frontend's /genlayer/* read proxy.
 *
 * GenLayer's execution model is not identical to a Solidity EVM chain —
 * this contract does not emit Solidity-style event logs; instead it records
 * an internal, bounded per-case event log readable via the `get_case_events`
 * view method (see contracts/verdict_contract.py `_log` / `get_case_events`).
 * That means the reliable sync strategy here is POLLING the contract's view
 * methods on an interval, not subscribing to `eth_getLogs`-style filters.
 *
 * Uses the official `genlayer-js` SDK's `readContract` rather than hand-
 * rolled JSON-RPC — an earlier version of this file guessed at the raw
 * wire format (a `gen_call` method) and it was wrong (StudioNet rejected it
 * with a KeyError-shaped error). The SDK is the source of truth for the
 * actual RPC shape, confirmed against a live read against the deployed
 * VERDICT contract (0x56118ae3ee66b662a9a4CEf3424008c1D1036DbD) during
 * development.
 */

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { env } from "./env.js";
import { acquireGenlayerRpcSlot } from "./rate-limiter.js";

export class GenLayerClientError extends Error {}

function contractAddressOrThrow(): `0x${string}` {
  const addr = env.VERDICT_CONTRACT_ADDRESS;
  if (!addr || addr.startsWith("changeme")) {
    throw new GenLayerClientError("VERDICT_CONTRACT_ADDRESS is not configured — contract not yet deployed");
  }
  return addr as `0x${string}`;
}

let cachedClient: ReturnType<typeof createClient> | null = null;

/**
 * The backend's read client has no signer/account — it never sends
 * transactions, only reads. genlayer-js's readContract does not require an
 * account for view calls (see docs.genlayer.com/api-references/genlayer-js).
 */
function getReadClient() {
  if (!cachedClient) {
    cachedClient = createClient({ chain: studionet });
  }
  return cachedClient;
}

/** Calls a @gl.public.view method on the deployed VERDICT contract. */
export async function viewCall<T>(method: string, args: unknown[] = []): Promise<T> {
  const address = contractAddressOrThrow();
  await acquireGenlayerRpcSlot();
  const client = getReadClient();
  try {
    // NOTE: the installed genlayer-js version's readContract() type does not
    // accept a `stateStatus` param (unlike some documented examples) — omit
    // it; the SDK defaults to the accepted/finalized state for reads.
    const result = await client.readContract({
      address,
      functionName: method,
      args: args as Parameters<typeof client.readContract>[0]["args"],
    });
    return result as T;
  } catch (err) {
    throw new GenLayerClientError(`GenLayer readContract("${method}") failed: ${(err as Error).message}`);
  }
}

export async function getCaseCount(): Promise<number> {
  return viewCall<number>("get_case_count");
}

export async function getCase(caseId: number): Promise<Record<string, unknown>> {
  return viewCall<Record<string, unknown>>("get_case", [caseId]);
}

export async function getCaseEvents(caseId: number, limit = 50): Promise<Array<Record<string, unknown>>> {
  return viewCall<Array<Record<string, unknown>>>("get_case_events", [caseId, limit]);
}

export async function getEvidence(evidenceId: number): Promise<Record<string, unknown>> {
  return viewCall<Record<string, unknown>>("get_evidence", [evidenceId]);
}

export function isContractConfigured(): boolean {
  const addr = env.VERDICT_CONTRACT_ADDRESS;
  return Boolean(addr) && !addr!.startsWith("changeme");
}
