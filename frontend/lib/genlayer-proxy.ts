/**
 * Frontend read access to the VERDICT contract goes through the backend
 * proxy (`${NEXT_PUBLIC_API_BASE_URL}/genlayer/*`), NOT a direct RPC call
 * from the browser. This lets the backend coordinate GenLayer StudioNet's
 * 30 requests/minute rate limit across every open tab and the indexer via
 * one shared Redis counter (backend/src/lib/rate-limiter.ts) — see
 * docs/GENLAYER.md "Rate limiting" section.
 *
 * Direct browser -> contract calls are reserved for WRITE transactions
 * (stake locking, evidence submission, appeal filing, etc.), which are
 * wallet-signed by the user and go through the wallet's own RPC, not this
 * app's coordinated read budget.
 */
export async function fetchCaseFromContract(apiBaseUrl: string, contractCaseId: number) {
  const res = await fetch(`${apiBaseUrl}/genlayer/case/${contractCaseId}`);
  if (!res.ok) {
    throw new Error(`Failed to read case ${contractCaseId} from contract (${res.status})`);
  }
  const body = (await res.json()) as { case: Record<string, unknown> };
  return body.case;
}

export async function fetchProtocolConfig(apiBaseUrl: string) {
  const res = await fetch(`${apiBaseUrl}/genlayer/protocol-config`);
  if (!res.ok) {
    throw new Error(`Failed to read protocol config (${res.status})`);
  }
  const body = (await res.json()) as { config: Record<string, unknown> };
  return body.config;
}
