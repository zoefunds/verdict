"use client";

import { useQuery } from "@tanstack/react-query";
import { casesApi, casebookApi, evidenceApi, constitutionsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { fetchCaseFromContract } from "@/lib/genlayer-proxy";
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
  });
}

export function useMyCases() {
  const isAuthenticated = Boolean(useAuthStore((s) => s.accessToken));
  return useQuery({
    queryKey: ["cases", "mine"],
    queryFn: () => casesApi.list({ mine: true }),
    enabled: isAuthenticated,
  });
}

export function useCase(id: string | undefined) {
  return useQuery({
    queryKey: ["case", id],
    queryFn: () => casesApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCaseEvidence(caseId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", caseId],
    queryFn: () => evidenceApi.listForCase(caseId as string),
    enabled: Boolean(caseId),
  });
}

export function useCasebook(params: { category?: string; sort?: "recent" | "highest_stake" | "most_appealed" }) {
  return useQuery({
    queryKey: ["casebook", params],
    queryFn: () => casebookApi.list(params),
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
