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
import { useAuth } from "@/hooks/useAuth";
import { useActiveConstitutions } from "@/hooks/useCases";
import { casesApi } from "@/lib/api";
import { isContractDeployed } from "@/lib/env";
import type { Case } from "@/types";

const STEPS = ["Claim", "Rules & Recipe", "Stake & Visibility", "Review"] as const;

export default function CreateCasePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { data: constitutionsData } = useActiveConstitutions();

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
    stakeAmountGen: "",
    appealBondAmountGen: "",
    evidenceWindowHours: 72,
    visibility: "public" as "public" | "private",
  });

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
    setSubmitting(true);
    try {
      const { case: created } = await casesApi.create({
        title: form.title,
        claimText: form.claimText,
        resolutionRule: form.resolutionRule,
        category: form.category,
        constitutionVersionId: form.constitutionVersionId,
        caseRules: form.caseRulesText.split("\n").map((s) => s.trim()).filter(Boolean),
        stakeAmountWei: toWei(form.stakeAmountGen),
        appealBondAmountWei: toWei(form.appealBondAmountGen),
        visibility: form.visibility,
        evidenceWindowHours: form.evidenceWindowHours,
      });
      setCreatedCase(created);
      toast.success("Case draft created. Next: submit your on-chain stake.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create case");
    } finally {
      setSubmitting(false);
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
                <p className="text-body-sm text-on-surface-variant">
                  Ready to submit your on-chain stake for {createdCase.caseNumber}.
                </p>
              )}
              <Button onClick={() => router.push(`/cases/${createdCase.id}`)}>Go to case</Button>
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
                <Field label="Appeal Bond Amount (GEN)">
                  <Input value={form.appealBondAmountGen} onChange={(e) => update("appealBondAmountGen", e.target.value)} placeholder="2" inputMode="decimal" />
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
                <ReviewRow label="Category" value={form.category} />
                <ReviewRow label="Stake" value={`${form.stakeAmountGen || "0"} GEN`} />
                <ReviewRow label="Appeal Bond" value={`${form.appealBondAmountGen || "0"} GEN`} />
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
