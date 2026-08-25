import { useState } from "react";
import { genlayerContract } from "@/lib/genlayer";
import { fetchCaseEvidenceIds } from "@/lib/genlayer-proxy";
import { evidenceApi } from "@/lib/api";
import { env } from "@/lib/env";
import type { Evidence } from "@/types";

/**
 * Commits an existing off-chain-only evidence row on-chain — same logic
 * EvidenceSubmitForm runs right after a fresh submission, but usable
 * standalone for evidence that was saved before on-chain submission was
 * wired up (or where the wallet step was skipped/failed at submit time).
 * Reconstructs the contract call args from the already-stored row rather
 * than requiring the user to re-enter anything.
 */
function toContractKind(kind: Evidence["evidenceType"]): "URL" | "TEXT_STATEMENT" | "TX_RECORD" | "DOCUMENT_HASH" {
  if (kind === "url") return "URL";
  if (kind === "transaction_record") return "TX_RECORD";
  if (kind === "document" || kind === "image") return "DOCUMENT_HASH";
  return "TEXT_STATEMENT";
}

export function useCommitEvidenceOnChain() {
  const [committingId, setCommittingId] = useState<string | null>(null);

  async function commit(account: `0x${string}`, contractCaseId: number, item: Evidence): Promise<void> {
    setCommittingId(item.id);
    try {
      const kind = toContractKind(item.evidenceType);
      await genlayerContract.submitEvidenceOnChain({
        account,
        contractCaseId,
        kind,
        url: item.sourceUrl ?? undefined,
        description: item.description ?? (kind === "DOCUMENT_HASH" ? item.title : undefined),
        txReference:
          kind === "TX_RECORD" ? (item.textContent ?? undefined) : kind === "DOCUMENT_HASH" ? item.contentHashSha256 : undefined,
      });
      const ids = await fetchCaseEvidenceIds(env.apiBaseUrl, contractCaseId);
      const newId = ids[ids.length - 1];
      if (newId !== undefined) {
        await evidenceApi.linkContract(item.id, String(newId));
      }
    } finally {
      setCommittingId(null);
    }
  }

  return { commit, committingId };
}
