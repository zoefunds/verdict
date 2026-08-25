import { env } from "./env";
import { useAuthStore } from "./auth-store";
import type { Case, CaseParticipant, Evidence, User, ConstitutionVersion, ConstitutionArticle } from "@/types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${env.apiBaseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    useAuthStore.getState().setSession(data.accessToken, useAuthStore.getState().walletAddress ?? "");
    return data.accessToken as string;
  } catch {
    return null;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  auth?: boolean;
  isFormData?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, auth = false, isFormData = false, headers, ...rest } = opts;

  const doFetch = async (token: string | null): Promise<Response> => {
    const finalHeaders: Record<string, string> = { ...(headers as Record<string, string>) };
    if (!isFormData && body !== undefined) finalHeaders["Content-Type"] = "application/json";
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;

    return fetch(`${env.apiBaseUrl}${path}`, {
      ...rest,
      credentials: "include",
      headers: finalHeaders,
      body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let token = useAuthStore.getState().accessToken;
  let res = await doFetch(auth ? token : null);

  if (auth && res.status === 401) {
    token = await refreshAccessToken();
    if (token) {
      res = await doFetch(token);
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error ?? message;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- Auth ----
export const authApi = {
  nonce: (walletAddress: string) =>
    request<{ nonce: string; message: string }>("/auth/nonce", { method: "POST", body: { walletAddress } }),
  verify: (walletAddress: string, nonce: string, signature: string) =>
    request<{ accessToken: string; userId: string; walletAddress: string }>("/auth/verify", {
      method: "POST",
      body: { walletAddress, nonce, signature },
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me", { auth: true }),
};

// ---- Cases ----
export const casesApi = {
  create: (payload: {
    title: string;
    claimText: string;
    resolutionRule: string;
    category: string;
    constitutionVersionId: string;
    caseRules: string[];
    respondentAddress: string;
    stakeAmountWei: string;
    appealBondAmountWei: string;
    visibility: "public" | "private";
    evidenceWindowHours: number;
  }) => request<{ case: Case }>("/cases", { method: "POST", body: payload, auth: true }),
  linkContract: (id: string, contractCaseId: string, stakeTxHash: string) =>
    request<{ case: Case }>(`/cases/${id}/link-contract`, {
      method: "PATCH",
      body: { contractCaseId, stakeTxHash },
      auth: true,
    }),
  fundRespondentConfirm: (id: string, stakeTxHash: string) =>
    request<{ ok: boolean }>(`/cases/${id}/fund-respondent`, {
      method: "PATCH",
      body: { stakeTxHash },
      auth: true,
    }),
  get: (id: string) => request<{ case: Case; participants: CaseParticipant[] }>(`/cases/${id}`, { auth: false }),
  list: (params: { status?: string; category?: string; mine?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.category) qs.set("category", params.category);
    if (params.mine) qs.set("mine", "true");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ cases: Case[] }>(`/cases${suffix}`, { auth: Boolean(params.mine) });
  },
};

// ---- Evidence ----
export const evidenceApi = {
  submitText: (payload: {
    caseId: string;
    evidenceType: "url" | "transaction_record" | "text_statement";
    title: string;
    description?: string;
    sourceUrl?: string;
    textContent?: string;
  }) => request<{ evidence: Evidence }>("/evidence/text", { method: "POST", body: payload, auth: true }),
  submitFile: (formData: FormData) =>
    request<{ evidence: Evidence }>("/evidence/file", { method: "POST", body: formData, auth: true, isFormData: true }),
  listForCase: (caseId: string) => request<{ evidence: Evidence[] }>(`/cases/${caseId}/evidence`),
};

// ---- Casebook ----
export const casebookApi = {
  list: (params: { category?: string; sort?: "recent" | "highest_stake" | "most_appealed" } = {}) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set("category", params.category);
    if (params.sort) qs.set("sort", params.sort);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ cases: Case[] }>(`/casebook${suffix}`);
  },
};

// ---- Constitutions ----
export const constitutionsApi = {
  getVersion: (versionId: string) =>
    request<{ version: ConstitutionVersion; articles: ConstitutionArticle[] }>(`/constitutions/${versionId}`),
  listActive: () =>
    request<{ constitutions: { id: string; slug: string; title: string; category: string; currentVersionId: string }[] }>(
      "/constitutions",
    ),
};

export { request };
