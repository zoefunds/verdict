"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAccount } from "wagmi";
import { isAddress, getAddress } from "viem";
import { useAuth } from "@/hooks/useAuth";
import { useActiveConstitutions } from "@/hooks/useCases";
import { usePublishCaseOnChain } from "@/hooks/usePublishCaseOnChain";
import { casesApi } from "@/lib/api";
import { isContractDeployed, env } from "@/lib/env";
import { fetchProtocolConfig } from "@/lib/genlayer-proxy";
import { useQuery } from "@tanstack/react-query";
import type { Case } from "@/types";

const STEPS = ["Claim", "Rules & Recipe", "Stake & Visibility", "Review"] as const;

export default function CreateCasePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { address } = useAccount();
  const { data: constitutionsData } = useActiveConstitutions();
  const { state: publishState, publish } = usePublishCaseOnChain();
  const { data: protocolConfig } = useQuery({
    queryKey: ["protocol-config"],
    queryFn: () => fetchProtocolConfig(env.apiBaseUrl),
    enabled: isContractDeployed,
  });
  const appealBondBps = protocolConfig ? Number(protocolConfig.appeal_bond_bps ?? 0) : null;

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [createdCase, setCreatedCase] = useState<Case | null>(null);

  const [form, setForm] = useState({
    title: "",
    claimText: "",
    resolutionRule: "",
    category: "delivery",
    constitutionVersionId: "",
    caseRulesText: "",
    respondentAddress: "",
    stakeAmountGen: "",
    appealBondAmountGen: "",
    evidenceWindowHours: 72,
    visibility: "public" as "public" | "private",
  });

  // Display-only estimate assuming a matching respondent stake (the usual
  // case) — the contract computes the real figure at appeal time from the
  // actual combined stake, which is authoritative, not this estimate.
  const estimatedAppealBondGen =
    appealBondBps !== null && form.stakeAmountGen
      ? ((Number(form.stakeAmountGen) * 2 * appealBondBps) / 10000).toFixed(4).replace(/\.?0+$/, "")
      : "—";

  const constitutions = constitutionsData?.constitutions ?? [];

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toWei(gen: string): string {
    if (!gen) return "0";
    const [whole, frac = ""] = gen.split(".");
    const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
    try {
      return (BigInt(whole || "0") * BigInt(10) ** BigInt(18) + BigInt(fracPadded || "0")).toString();
    } catch {
      return "0";
    }
  }

  async function handleSubmit() {
    if (!isAuthenticated) {
      toast.error("Sign in with your wallet first.");
      return;
    }
    if (!isAddress(form.respondentAddress)) {
      toast.error("Enter a valid respondent wallet address.");
      return;
    }
    if (address && getAddress(form.respondentAddress) === getAddress(address)) {
      toast.error("The respondent must be a different wallet than yours.");
      return;
    }
    setSubmitting(true);
    try {
      const { case: created } = await casesApi.create({
        title: form.title,
        claimText: form.claimText,
        resolutionRule: form.resolutionRule,
        category: form.category,
        constitutionVersionId: form.constitutionVersionId,
        caseRules: form.caseRulesText.split("\n").map((s) => s.trim()).filter(Boolean),
        respondentAddress: form.respondentAddress,
        stakeAmountWei: toWei(form.stakeAmountGen),
        // Cosmetic/display only — never sent to or checked by the
        // contract, which computes the real bond itself at appeal time.
        // Store the same estimate shown in the wizard so the case detail
        // page doesn't display "0 GEN" for this field.
        appealBondAmountWei: toWei(estimatedAppealBondGen === "—" ? "0" : estimatedAppealBondGen),
        visibility: form.visibility,
        evidenceWindowHours: form.evidenceWindowHours,
      });
      setCreatedCase(created);
      toast.success("Case draft created. Next: publish it on-chain to lock your stake.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create case");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    if (!address || !createdCase) return;
    try {
      await publish(address, createdCase);
      toast.success("Case published on-chain — your stake is locked.");
      router.push(`/cases/${createdCase.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish case on-chain");
    }
  }

  if (createdCase) {
    return (
      <div>
        <AppTopbar title="Create Case" />
        <div className="mx-auto max-w-2xl p-8">
          <Card>
            <CardHeader>
              <CardTitle>Case {createdCase.caseNumber} drafted</CardTitle>
              <CardDescription>
                Your case row is saved as a DRAFT. It only becomes real once you submit the on-chain
                case-creation transaction locking your stake.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isContractDeployed ? (
                <div className="rounded border border-tertiary/40 bg-tertiary/10 p-4 text-body-sm text-tertiary">
                  Contract not yet deployed. NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS is unset, so the on-chain
                  stake transaction cannot be submitted yet. Your draft is saved — return to this case once
                  the VERDICT contract has a live StudioNet deployment.
                </div>
              ) : (
                <>
                  <p className="text-body-sm text-on-surface-variant">
                    This will prompt your wallet to lock {form.stakeAmountGen || "0"} GEN and open the case
                    against respondent {form.respondentAddress}.
                  </p>
                  <Button onClick={handlePublish} disabled={publishState.status === "wallet-confirm" || publishState.status === "pending"}>
                    {publishState.status === "wallet-confirm"
                      ? "Confirm in wallet…"
                      : publishState.status === "pending"
                        ? "Publishing…"
                        : "Publish On-Chain & Lock Stake"}
                  </Button>
                  {publishState.status === "failed" && (
                    <p className="text-body-sm text-error">{publishState.error}</p>
                  )}
                </>
              )}
              <Button variant="ghost" onClick={() => router.push(`/cases/${createdCase.id}`)}>
                Skip for now — go to case
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppTopbar title="Create Case" />
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex-1 rounded-full py-1 text-center font-mono text-label-sm uppercase ${i <= step ? "bg-primary/20 text-primary" : "bg-surface-container-high text-on-surface-variant"}`}>
              {s}
            </div>
          ))}
        </div>

        <Card>
          <CardContent className="space-y-5 p-6">
            {step === 0 && (
              <>
                <Field label="Case Title">
                  <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Freelance milestone was not delivered as agreed" />
                </Field>
                <Field label="Claim">
                  <Textarea value={form.claimText} onChange={(e) => update("claimText", e.target.value)} rows={4} placeholder="Describe your version of events in detail." />
                </Field>
                <Field label="Resolution Rule">
                  <Textarea value={form.resolutionRule} onChange={(e) => update("resolutionRule", e.target.value)} rows={3} placeholder="The claim is TRUE if..." />
                </Field>
                <Field label="Respondent Wallet Address">
                  <Input
                    value={form.respondentAddress}
                    onChange={(e) => update("respondentAddress", e.target.value)}
                    placeholder="0x..."
                  />
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    VERDICT cases are between two named parties — enter the wallet address of the person
                    you&apos;re disputing with. They&apos;ll fund a matching stake to open the case.
                  </p>
                </Field>
              </>
            )}

            {step === 1 && (
              <>
                <Field label="Category">
                  <Select value={form.category} onValueChange={(v) => update("category", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["delivery", "freelance", "refund", "event", "sports", "community", "content", "dao", "commerce", "challenge", "custom"].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Constitution / Resolution Recipe">
                  <Select value={form.constitutionVersionId} onValueChange={(v) => update("constitutionVersionId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select a constitution" /></SelectTrigger>
                    <SelectContent>
                      {constitutions.map((c) => (
                        <SelectItem key={c.id} value={c.currentVersionId ?? ""} disabled={!c.currentVersionId}>
                          {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {constitutions.length === 0 && (
                    <p className="mt-1 text-body-sm text-on-surface-variant">No constitutions available from the API yet.</p>
                  )}
                </Field>
                <Field label="Case-Specific Rules (one per line, optional)">
                  <Textarea value={form.caseRulesText} onChange={(e) => update("caseRulesText", e.target.value)} rows={3} />
                </Field>
              </>
            )}

            {step === 2 && (
              <>
                <Field label="Stake Amount (GEN)">
                  <Input value={form.stakeAmountGen} onChange={(e) => update("stakeAmountGen", e.target.value)} placeholder="10" inputMode="decimal" />
                </Field>
                <Field label="Appeal Bond (protocol-determined)">
                  <div className="rounded border border-outline-variant bg-surface-container-high px-3 py-2 text-body-sm text-on-surface-variant">
                    {estimatedAppealBondGen} GEN (estimated — not set per case)
                  </div>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    The contract computes the actual required bond itself, as a protocol-wide percentage
                    (currently {appealBondBps !== null ? appealBondBps / 100 : "…"}%) of the combined stake at
                    the time an appeal is filed — it is never chosen per case.
                  </p>
                </Field>
                <Field label="Evidence Window (hours)">
                  <Input type="number" value={form.evidenceWindowHours} onChange={(e) => update("evidenceWindowHours", Number(e.target.value))} />
                </Field>
                <Field label="Visibility">
                  <Select value={form.visibility} onValueChange={(v) => update("visibility", v as "public" | "private")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}

            {step === 3 && (
              <div className="space-y-2 text-body-sm">
                <ReviewRow label="Title" value={form.title} />
                <ReviewRow label="Respondent" value={form.respondentAddress || "—"} />
                <ReviewRow label="Category" value={form.category} />
                <ReviewRow label="Stake" value={`${form.stakeAmountGen || "0"} GEN`} />
                <ReviewRow label="Appeal Bond (protocol-determined estimate)" value={`${estimatedAppealBondGen} GEN`} />
                <ReviewRow label="Evidence Window" value={`${form.evidenceWindowHours}h`} />
                <ReviewRow label="Visibility" value={form.visibility} />
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
              ) : (
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Creating…" : "Create Draft Case"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-outline-variant py-2">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-on-surface">{value}</span>
    </div>
  );
}
