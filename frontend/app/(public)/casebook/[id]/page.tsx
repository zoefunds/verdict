"use client";

import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/case/StatusBadge";
import { EscrowBar } from "@/components/case/EscrowBar";
import { EvidenceTimeline } from "@/components/case/EvidenceTimeline";
import { ConstitutionSidebar } from "@/components/case/ConstitutionSidebar";
import { useCase, useCaseEvidence } from "@/hooks/useCases";
import { formatDateTime } from "@/lib/utils";

export default function PublicCaseDetailsPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = useCase(params.id);
  const { data: evidenceData } = useCaseEvidence(params.id);

  if (isLoading) return <div className="mx-auto max-w-5xl space-y-4 px-6 py-12"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (isError || !data) return <div className="mx-auto max-w-5xl px-6 py-12 text-error">This case is not public, or does not exist.</div>;

  const { case: c, participants } = data;
  const evidence = evidenceData?.evidence ?? [];

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-12 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <span className="font-mono text-label-sm text-on-surface-variant">{c.caseNumber} · {c.category}</span>
              <StatusBadge status={c.status} />
            </div>
            <CardTitle>{c.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-body-sm text-on-surface-variant">
            Settled: {formatDateTime(c.settledAt)}
          </CardContent>
        </Card>

        <EscrowBar stakeAmountWei={c.stakeAmountWei} participants={participants} />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Claim</CardTitle></CardHeader>
            <CardContent className="text-body-sm text-on-surface-variant">{c.claimText}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Resolution Rule</CardTitle></CardHeader>
            <CardContent className="text-body-sm text-on-surface-variant">{c.resolutionRule}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Evidence Timeline</CardTitle></CardHeader>
          <CardContent><EvidenceTimeline evidence={evidence} /></CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <ConstitutionSidebar versionId={c.constitutionVersionId} caseRules={c.caseRules} />
      </div>
    </div>
  );
}
