"use client";

import Link from "next/link";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/case/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useMyCases, useProtocolMetrics } from "@/hooks/useCases";
import { formatWei, formatDate } from "@/lib/utils";
import { PlusCircle } from "lucide-react";

export default function DashboardPage() {
  const { isAuthenticated } = useAuth();
  const { data, isLoading, isError } = useMyCases();
  const { data: metrics } = useProtocolMetrics();
  const cases = data?.cases ?? [];

  const activeCount = cases.filter((c) => !["settled", "cancelled", "abandoned"].includes(c.status)).length;
  const resolvedCount = cases.filter((c) => ["final", "settled"].includes(c.status)).length;
  const totalStaked = cases.reduce((sum, c) => sum + BigInt(c.stakeAmountWei || "0"), BigInt(0));

  return (
    <div>
      <AppTopbar title="Dashboard" />
      <div className="space-y-8 p-8">
        {!isAuthenticated ? (
          <Card>
            <CardContent className="p-8 text-center text-body-md text-on-surface-variant">
              Connect and sign in with your wallet to see your cases.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label="Active Cases" value={isLoading ? null : String(activeCount)} />
              <StatCard label="Resolved Cases" value={isLoading ? null : String(resolvedCount)} />
              <StatCard label="Total Collateral Locked" value={isLoading ? null : `${formatWei(totalStaked.toString())} GEN`} />
            </div>

            {metrics && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Protocol Cases" value={String(metrics.case_count ?? "—")} small />
                <StatCard label="Protocol Evidence" value={String(metrics.evidence_count ?? "—")} small />
                <StatCard label="Protocol Appeals" value={String(metrics.total_appeals ?? "—")} small />
                <StatCard
                  label="Protocol Volume"
                  value={`${formatWei(String(metrics.total_volume_wei ?? "0"))} GEN`}
                  small
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-headline-sm text-on-surface">Your Cases</h2>
              <Button size="sm" asChild>
                <Link href="/cases/new">
                  <PlusCircle className="mr-2 h-4 w-4" /> Create New Case
                </Link>
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="space-y-2 p-6">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : isError ? (
                  <p className="p-6 text-body-sm text-error">Could not load your cases from the API.</p>
                ) : cases.length === 0 ? (
                  <p className="p-6 text-body-sm text-on-surface-variant">
                    You haven&apos;t opened or joined any cases yet.
                  </p>
                ) : (
                  <table className="w-full text-left text-body-sm">
                    <thead className="sticky top-0 bg-surface-container-high text-label-md font-mono uppercase text-on-surface-variant">
                      <tr>
                        <th className="px-6 py-3">Case</th>
                        <th className="px-6 py-3">Category</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">Stake</th>
                        <th className="px-6 py-3">Opened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cases.map((c) => (
                        <tr key={c.id} className="border-t border-outline-variant transition-colors hover:border-l-4 hover:border-l-primary hover:bg-surface-container">
                          <td className="px-6 py-3">
                            <Link href={`/cases/${c.id}`} className="font-medium text-on-surface hover:text-primary">
                              {c.caseNumber} — {c.title}
                            </Link>
                          </td>
                          <td className="px-6 py-3 text-on-surface-variant">{c.category}</td>
                          <td className="px-6 py-3">
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="px-6 py-3 font-mono text-on-surface-variant">{formatWei(c.stakeAmountWei)} GEN</td>
                          <td className="px-6 py-3 text-on-surface-variant">{formatDate(c.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="text-body-sm text-on-surface-variant">
                Activity feed is not yet implemented — the backend does not currently expose a per-user event
                feed endpoint. Case status changes are visible in the table above and on each case&apos;s
                timeline.
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, small = false }: { label: string; value: string | null; small?: boolean }) {
  return (
    <Card>
      <CardContent className={small ? "p-4" : "p-6"}>
        <p className="font-mono text-label-sm uppercase tracking-wide text-on-surface-variant">{label}</p>
        <p className={small ? "mt-1 text-headline-sm text-on-surface" : "mt-2 text-headline-lg text-on-surface"}>
          {value ?? <Skeleton className="h-9 w-20" />}
        </p>
      </CardContent>
    </Card>
  );
}
