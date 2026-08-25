"use client";

import { FileText, Link2, Receipt, MessageSquareText, Image as ImageIcon, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useCommitEvidenceOnChain } from "@/hooks/useCommitEvidenceOnChain";
import { genlayerContract } from "@/lib/genlayer";
import type { Evidence } from "@/types";

const ICONS: Record<Evidence["evidenceType"], React.ElementType> = {
  url: Link2,
  document: FileText,
  image: ImageIcon,
  transaction_record: Receipt,
  text_statement: MessageSquareText,
};

/**
 * `canCommitOnChain` gates the retroactive "Commit On-Chain" button: only
 * meaningful if the contract is deployed, the case has a contractCaseId,
 * and the case is still in a status where the contract's own
 * submit_evidence accepts calls (EVIDENCE_WINDOW or RE_INVESTIGATION) —
 * matches contracts/verdict_contract.py's own requirement, so the button
 * never offers an action that would just revert.
 */
export function EvidenceTimeline({
  evidence,
  caseId,
  contractCaseId,
  canCommitOnChain,
}: {
  evidence: Evidence[];
  caseId?: string;
  contractCaseId?: string | null;
  canCommitOnChain?: boolean;
}) {
  const { user } = useAuth();
  const { address } = useAccount();
  const { commit, committingId } = useCommitEvidenceOnChain();
  const queryClient = useQueryClient();

  if (evidence.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">No evidence submitted yet.</p>;
  }

  const sorted = [...evidence].sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  async function handleCommit(item: Evidence) {
    if (!address || !contractCaseId) return;
    try {
      await commit(address, Number(contractCaseId), item);
      toast.success("Evidence committed on-chain.");
      if (caseId) queryClient.invalidateQueries({ queryKey: ["evidence", caseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to commit evidence on-chain");
    }
  }

  return (
    <ol className="relative space-y-6 border-l-2 border-outline-variant pl-6">
      {sorted.map((item) => {
        const Icon = ICONS[item.evidenceType];
        const isOnChain = Boolean(item.contractEvidenceId);
        const isOwn = Boolean(user && user.id === item.submittedByUserId);
        return (
          <li key={item.id} className="relative">
            <span className="absolute -left-[31px] flex h-4 w-4 items-center justify-center rounded-full bg-primary" />
            <div className="rounded-md border border-outline-variant bg-surface-container p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-on-surface">{item.title}</span>
                </div>
                <span className="font-mono text-label-sm text-on-surface-variant">{item.contentHashSha256.slice(0, 12)}…</span>
              </div>
              {item.description && <p className="mt-2 text-body-sm text-on-surface-variant">{item.description}</p>}
              {item.sourceUrl && (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-body-sm text-primary hover:underline">
                  {item.sourceUrl}
                </a>
              )}
              {item.textContent && <p className="mt-2 whitespace-pre-wrap text-body-sm text-on-surface">{item.textContent}</p>}
              <div className="mt-3 flex items-center justify-between">
                <p className="font-mono text-label-sm text-on-surface-variant">
                  {formatDateTime(item.submittedAt)} · {item.status}
                  {item.isAppealEvidence ? " · appeal evidence" : ""}
                </p>
                {isOnChain ? (
                  <span className="flex items-center gap-1 font-mono text-label-sm text-secondary">
                    <CheckCircle2 className="h-3.5 w-3.5" /> On-chain (evidence #{item.contractEvidenceId})
                  </span>
                ) : isOwn && canCommitOnChain && genlayerContract.isDeployed && contractCaseId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={committingId === item.id}
                    onClick={() => void handleCommit(item)}
                  >
                    {committingId === item.id ? "Confirm in wallet…" : "Commit On-Chain"}
                  </Button>
                ) : !isOnChain ? (
                  <span className="font-mono text-label-sm text-on-surface-variant">Off-chain only</span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
