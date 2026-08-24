/**
 * Minimal GenLayer StudioNet read client for the indexer.
 *
 * GenLayer's execution model is not identical to a Solidity EVM chain —
 * this contract does not emit Solidity-style event logs; instead it records
 * an internal, bounded per-case event log readable via the `get_case_events`
 * view method (see contracts/verdict_contract.py `_log` / `get_case_events`).
 * That means the reliable sync strategy here is POLLING the contract's view
 * methods on an interval, not subscribing to `eth_getLogs`-style filters.
 *
 * This client wraps the GenLayer JSON-RPC `gen_call` (view-call) endpoint.
 * Exact method/param names should be reconfirmed against the GenLayer JS SDK
 * / docs.genlayer.com for your installed SDK version before relying on this
 * in production — this file intentionally isolates that surface to one
 * place so it's a single, small area to patch if the RPC shape differs.
 */

import { env } from "./env.js";

export class GenLayerClientError extends Error {}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  if (!env.GENLAYER_RPC_URL) {
    throw new GenLayerClientError("GENLAYER_RPC_URL is not configured");
  }
  const res = await fetch(env.GENLAYER_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new GenLayerClientError(`GenLayer RPC HTTP ${res.status}`);
  }
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) {
    throw new GenLayerClientError(`GenLayer RPC error: ${body.error.message}`);
  }
  if (body.result === undefined) {
    throw new GenLayerClientError("GenLayer RPC returned no result");
  }
  return body.result;
}

function contractAddressOrThrow(): string {
  const addr = env.VERDICT_CONTRACT_ADDRESS;
  if (!addr || addr.startsWith("changeme")) {
    throw new GenLayerClientError("VERDICT_CONTRACT_ADDRESS is not configured — contract not yet deployed");
  }
  return addr;
}

/** Calls a @gl.public.view method on the deployed VERDICT contract. */
export async function viewCall<T>(method: string, args: unknown[] = []): Promise<T> {
  const address = contractAddressOrThrow();
  // NOTE: param shape (`gen_call` vs `eth_call`-style calldata encoding) is
  // SDK-version-dependent. This uses a plausible JSON-RPC shape; validate
  // against the installed GenLayer SDK's documented low-level call method
  // before depending on this in production, and adjust here only.
  return rpcCall<T>("gen_call", [{ to: address, function: method, args }]);
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
