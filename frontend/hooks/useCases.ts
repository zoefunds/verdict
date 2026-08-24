"use client";

import { useQuery } from "@tanstack/react-query";
import { casesApi, casebookApi, evidenceApi, constitutionsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

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
