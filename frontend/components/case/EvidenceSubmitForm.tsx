"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { evidenceApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function EvidenceSubmitForm({ caseId, isAppeal = false }: { caseId: string; isAppeal?: boolean }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"url" | "text_statement" | "transaction_record" | "file">("url");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.error("Sign in with your wallet to submit evidence.");
      return;
    }
    setSubmitting(true);
    try {
      if (kind === "file") {
        if (!file) throw new Error("Choose a file");
        const fd = new FormData();
        fd.append("caseId", caseId);
        fd.append("title", title);
        fd.append("evidenceType", file.type.startsWith("image/") ? "image" : "document");
        fd.append("file", file);
        await evidenceApi.submitFile(fd);
      } else {
        await evidenceApi.submitText({
          caseId,
          evidenceType: kind,
          title,
          description: description || undefined,
          sourceUrl: kind === "url" ? sourceUrl : undefined,
          textContent: kind !== "url" ? textContent : undefined,
        });
      }
      toast.success("Evidence submitted.");
      setTitle("");
      setDescription("");
      setSourceUrl("");
      setTextContent("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["evidence", caseId] });
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
    </form>
  );
}
