"use client";

import { useConstitutionVersion } from "@/hooks/useCases";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function ConstitutionSidebar({ versionId, caseRules }: { versionId: string; caseRules: string[] }) {
  const { data, isLoading, isError } = useConstitutionVersion(versionId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Applicable Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError || !data ? (
          <p className="text-body-sm text-on-surface-variant">Constitution details unavailable.</p>
        ) : (
          <>
            <p className="font-mono text-label-sm text-on-surface-variant">Version {data.version.versionNumber}</p>
            <ul className="space-y-3">
              {data.articles.map((a) => (
                <li key={a.id} className="border-l-2 border-outline-variant pl-3">
                  <div className="flex items-center gap-2">
                    <span className="text-body-sm font-semibold text-on-surface">Art. {a.articleNumber} — {a.title}</span>
                    {a.isImmutableCore && <Badge variant="primary">Core</Badge>}
                  </div>
                  <p className="mt-1 text-body-sm text-on-surface-variant">{a.body}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        {caseRules.length > 0 && (
          <div>
            <p className="font-mono text-label-md uppercase text-on-surface-variant">Case-Specific Rules</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-on-surface-variant">
              {caseRules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
