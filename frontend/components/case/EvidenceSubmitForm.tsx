"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { evidenceApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { genlayerContract } from "@/lib/genlayer";
import { fetchCaseEvidenceIds } from "@/lib/genlayer-proxy";
import { env } from "@/lib/env";
import type { Evidence } from "@/types";

// Maps the off-chain evidenceType to the contract's `kind` enum
// (URL / TEXT_STATEMENT / TX_RECORD / DOCUMENT_HASH — see
// contracts/verdict_contract.py submit_evidence).
function toContractKind(kind: string): "URL" | "TEXT_STATEMENT" | "TX_RECORD" | "DOCUMENT_HASH" {
  if (kind === "url") return "URL";
  if (kind === "transaction_record") return "TX_RECORD";
  if (kind === "file") return "DOCUMENT_HASH";
  return "TEXT_STATEMENT";
}

export function EvidenceSubmitForm({
  caseId,
  contractCaseId,
  isAppeal = false,
  canCommitOnChain = true,
}: {
  caseId: string;
  contractCaseId: string | null;
  isAppeal?: boolean;
  /**
   * Whether the case is actually in a status the contract's
   * submit_evidence accepts (EVIDENCE_WINDOW or RE_INVESTIGATION) right
   * now. Defaults to true for backward compatibility, but callers that
   * know the case's current status (e.g. the appeal page, where the case
   * sits in APPEALED until "Open Appeal Evidence Window" is clicked)
   * should pass this explicitly — otherwise the on-chain commit attempts
   * a submit_evidence call that reverts with "case is not currently
   * accepting evidence" (confirmed from a real failed StudioNet tx).
   */
  canCommitOnChain?: boolean;
}) {
  const { isAuthenticated } = useAuth();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"url" | "text_statement" | "transaction_record" | "file">("url");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [onChainStatus, setOnChainStatus] = useState<string | null>(null);

  async function submitOnChain(created: Evidence) {
    if (!genlayerContract.isDeployed || !contractCaseId || !address || !canCommitOnChain) {
      if (!canCommitOnChain && genlayerContract.isDeployed && contractCaseId) {
        setOnChainStatus(
          "Saved off-chain only — this case isn't currently accepting on-chain evidence (e.g. an appeal evidence window may need to be opened first). You can commit it on-chain once it is.",
        );
      }
      return;
    }
    setOnChainStatus("Confirm the on-chain evidence commit in your wallet…");
    try {
      const contractKind = toContractKind(kind);
      // The contract's `description` field is the only free-text slot for
      // TEXT_STATEMENT evidence — there's no separate "content" parameter.
      // The optional "Description" field in this form was previously sent
      // alone, silently dropping the actual statement text (`textContent`)
      // that the user typed into "Content" — confirmed from a real
      // StudioNet transaction whose decoded params showed an empty
      // description for a text_statement submission. Also capped at 2000
      // chars: the contract's MAX_EVIDENCE_DESCRIPTION_LEN rejects
      // anything longer (off-chain storage keeps the untruncated text).
      const onChainDescription =
        kind === "text_statement"
          ? [textContent, description].filter(Boolean).join(" — ").slice(0, 2000)
          : kind === "file"
            ? (description || title).slice(0, 2000)
            : (description ?? "").slice(0, 2000) || undefined;
      await genlayerContract.submitEvidenceOnChain({
        account: address,
        contractCaseId: Number(contractCaseId),
        kind: contractKind,
        // The backend computed this from the ACTUAL content (fetched page
        // body for URL kind, not the URL string — see backend/src/routes
        // /evidence.ts) — this is the real on-chain content-hash commitment.
        contentHash: created.contentHashSha256,
        url: kind === "url" ? sourceUrl : undefined,
        description: onChainDescription,
        txReference:
          kind === "transaction_record" ? textContent : kind === "file" ? created.contentHashSha256 : undefined,
      });
      setOnChainStatus("Confirming on-chain id…");
      const ids = await fetchCaseEvidenceIds(env.apiBaseUrl, Number(contractCaseId));
      const newId = ids[ids.length - 1];
      if (newId !== undefined) {
        await evidenceApi.linkContract(created.id, String(newId));
      }
      setOnChainStatus("Committed on-chain.");
      toast.success("Evidence committed on-chain.");
    } catch (err) {
      setOnChainStatus(null);
      toast.error(
        err instanceof Error
          ? `Evidence saved, but the on-chain commit failed: ${err.message}`
          : "Evidence saved, but the on-chain commit failed.",
      );
    } finally {
      queryClient.invalidateQueries({ queryKey: ["evidence", caseId] });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.error("Sign in with your wallet to submit evidence.");
      return;
    }
    setSubmitting(true);
    setOnChainStatus(null);
    try {
      let created: Evidence;
      if (kind === "file") {
        if (!file) throw new Error("Choose a file");
        const fd = new FormData();
        fd.append("caseId", caseId);
        fd.append("title", title);
        fd.append("evidenceType", file.type.startsWith("image/") ? "image" : "document");
        fd.append("file", file);
        const res = await evidenceApi.submitFile(fd);
        created = res.evidence;
      } else {
        const res = await evidenceApi.submitText({
          caseId,
          evidenceType: kind,
          title,
          description: description || undefined,
          sourceUrl: kind === "url" ? sourceUrl : undefined,
          textContent: kind !== "url" ? textContent : undefined,
        });
        created = res.evidence;
      }
      toast.success("Evidence saved.");
      queryClient.invalidateQueries({ queryKey: ["evidence", caseId] });

      // Off-chain save always happens first (so nothing is lost if the
      // wallet step is skipped or fails) — the on-chain commit is a
      // second, separate step using the same content hash.
      await submitOnChain(created);

      setTitle("");
      setDescription("");
      setSourceUrl("");
      setTextContent("");
      setFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit evidence");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-outline-variant bg-surface-container p-6">
      <p className="font-mono text-label-md uppercase tracking-wide text-on-surface-variant">
        {isAppeal ? "Submit Appeal Evidence" : "Submit Evidence"}
      </p>
      {!genlayerContract.isDeployed ? (
        <p className="text-body-sm text-tertiary">
          Contract not deployed — evidence will be saved here but not committed on-chain.
        </p>
      ) : !contractCaseId ? (
        <p className="text-body-sm text-tertiary">
          This case hasn&apos;t been published on-chain yet — evidence will be saved here but not committed
          on-chain until it has.
        </p>
      ) : !canCommitOnChain ? (
        <p className="text-body-sm text-tertiary">
          This case isn&apos;t currently accepting on-chain evidence
          {isAppeal ? ' — open the "Appeal Evidence Window" above first' : ""}. Evidence will be saved here
          and can be committed on-chain once it is.
        </p>
      ) : (
        <p className="text-body-sm text-on-surface-variant">
          Saved here first, then committed on-chain via a wallet-signed <code className="font-mono">submit_evidence</code> transaction.
        </p>
      )}
      <div>
        <Label className="mb-1.5 block">Type</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="url">URL</SelectItem>
            <SelectItem value="text_statement">Text statement</SelectItem>
            <SelectItem value="transaction_record">Transaction record</SelectItem>
            <SelectItem value="file">Document / Image upload</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mb-1.5 block" htmlFor="evidence-title">Title</Label>
        <Input id="evidence-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      {kind === "url" && (
        <div>
          <Label className="mb-1.5 block" htmlFor="evidence-url">Source URL</Label>
          <Input id="evidence-url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required />
        </div>
      )}
      {(kind === "text_statement" || kind === "transaction_record") && (
        <div>
          <Label className="mb-1.5 block" htmlFor="evidence-text">Content</Label>
          <Textarea id="evidence-text" value={textContent} onChange={(e) => setTextContent(e.target.value)} rows={4} required />
        </div>
      )}
      {kind === "file" && (
        <div>
          <Label className="mb-1.5 block" htmlFor="evidence-file">File (PDF, PNG, JPEG, WebP)</Label>
          <input
            id="evidence-file"
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-body-sm text-on-surface-variant file:mr-4 file:rounded file:border-0 file:bg-primary/15 file:px-3 file:py-2 file:text-primary"
            required
          />
        </div>
      )}
      <div>
        <Label className="mb-1.5 block" htmlFor="evidence-desc">Description (optional)</Label>
        <Textarea id="evidence-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
      <Button type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit Evidence"}</Button>
      {onChainStatus && <p className="text-body-sm text-on-surface-variant">{onChainStatus}</p>}
    </form>
  );
}
