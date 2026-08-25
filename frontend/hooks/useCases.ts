"use client";

import { useQuery } from "@tanstack/react-query";
import { casesApi, casebookApi, evidenceApi, constitutionsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { fetchCaseFromContract, fetchProtocolMetrics } from "@/lib/genlayer-proxy";
import { env, isContractDeployed } from "@/lib/env";

/**
 * Reads the on-chain case record — this is where verdict/outcome data
 * lives (outcome, verdict_split_bps, confidence_bps, reasoning_summary),
 * not in the off-chain Postgres row, since the contract is the source of
 * truth for anything financial/decisional. Only fetches once a
 * contractCaseId exists (draft cases have none yet).
 */
export function useContractCase(contractCaseId: string | null | undefined) {
  return useQuery({
    queryKey: ["contract-case", contractCaseId],
    queryFn: () => fetchCaseFromContract(env.apiBaseUrl, Number(contractCaseId)),
    enabled: Boolean(contractCaseId) && isContractDeployed,
    // Case lifecycle actions gate on wall-clock deadlines (evidence/appeal
    // windows) as well as on-chain state changed by the OTHER party — a
    // one-shot fetch would leave the UI stuck showing a stale action (e.g.
    // "waiting for the window to close") long after the deadline actually
    // passed, or after the other party's transaction confirmed, with no
    // way to notice short of a manual page reload. Poll periodically so
    // both kinds of transition surface on their own.
    refetchInterval: 15_000,
  });
}

export function useMyCases() {
  const isAuthenticated = Boolean(useAuthStore((s) => s.accessToken));
  return useQuery({
    queryKey: ["cases", "mine"],
    queryFn: () => casesApi.list({ mine: true }),
    enabled: isAuthenticated,
    // The dashboard is exactly where a user watches for "did the other
    // party act yet" across all their cases — poll so a status change
    // (funded, verdict rendered, etc.) shows up without a manual reload.
    refetchInterval: 20_000,
  });
}

export function useCase(id: string | undefined) {
  return useQuery({
    queryKey: ["case", id],
    queryFn: () => casesApi.get(id as string),
    enabled: Boolean(id),
    // The off-chain status here lags the contract by up to one indexer
    // poll cycle (~15s) — poll here too so a case detail page open in the
    // background catches a status transition (e.g. respondent funded, or
    // the indexer catching up) without the user needing to reload.
    refetchInterval: 15_000,
  });
}

export function useCaseEvidence(caseId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", caseId],
    queryFn: () => evidenceApi.listForCase(caseId as string),
    enabled: Boolean(caseId),
    // The other party's evidence submissions land here with no wallet
    // action on this user's end at all — poll so a case page open while
    // the other side is actively submitting evidence updates live.
    refetchInterval: 15_000,
  });
}

export function useCasebook(params: { category?: string; sort?: "recent" | "highest_stake" | "most_appealed" }) {
  return useQuery({
    queryKey: ["casebook", params],
    queryFn: () => casebookApi.list(params),
    // Lower urgency than an open case (nothing here is time-sensitive to
    // a specific user), but still shouldn't require a manual reload to
    // see a newly-settled case appear.
    refetchInterval: 30_000,
  });
}

export function useConstitutionVersion(versionId: string | undefined) {
  return useQuery({
    queryKey: ["constitution-version", versionId],
    queryFn: () => constitutionsApi.getVersion(versionId as string),
    enabled: Boolean(versionId),
  });
}

export function useActiveConstitutions() {
  return useQuery({
    queryKey: ["constitutions"],
    queryFn: () => constitutionsApi.listActive(),
  });
}

/** Protocol-wide totals read directly from the deployed contract's get_metrics. */
export function useProtocolMetrics() {
  return useQuery({
    queryKey: ["protocol-metrics"],
    queryFn: () => fetchProtocolMetrics(env.apiBaseUrl),
    enabled: isContractDeployed,
    refetchInterval: 30_000,
  });
}
