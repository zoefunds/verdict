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

/**
 * Case ids on the contract are sequential starting at 0, so the count read
 * immediately before submitting create_case IS the id the new case will
 * receive — this is how the frontend learns the new contractCaseId without
 * needing to decode a write transaction's return value.
 */
export async function fetchCaseCount(apiBaseUrl: string): Promise<number> {
  const res = await fetch(`${apiBaseUrl}/genlayer/case-count`);
  if (!res.ok) {
    throw new Error(`Failed to read case count from contract (${res.status})`);
  }
  const body = (await res.json()) as { count: number };
  return body.count;
}

/**
 * Evidence ids are appended in submission order to a case's list, so the
 * last element right after a submit_evidence tx confirms is the id that
 * was just created — avoids decoding the write's return value directly.
 */
export async function fetchCaseEvidenceIds(apiBaseUrl: string, contractCaseId: number): Promise<number[]> {
  const res = await fetch(`${apiBaseUrl}/genlayer/case/${contractCaseId}/evidence-ids`);
  if (!res.ok) {
    throw new Error(`Failed to read evidence ids for case ${contractCaseId} (${res.status})`);
  }
  const body = (await res.json()) as { ids: number[] };
  return body.ids;
}
