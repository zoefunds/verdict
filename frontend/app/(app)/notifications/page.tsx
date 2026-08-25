"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { notificationsApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

export default function NotificationsPage() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(),
    enabled: isAuthenticated,
  });
  const items = data?.notifications ?? [];

  async function markRead(id: string) {
    await notificationsApi.markRead(id);
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <div>
      <AppTopbar title="Notifications" />
      <div className="mx-auto max-w-2xl space-y-3 p-8">
        {!isAuthenticated ? (
          <Card><CardContent className="p-6 text-body-sm text-on-surface-variant">Sign in with your wallet to see your notifications.</CardContent></Card>
        ) : isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-body-sm text-on-surface-variant">
              No notifications yet. You&apos;ll see updates here when a case you&apos;re part of changes —
              a respondent funding their stake, evidence submitted, a verdict rendered, or an appeal filed.
            </CardContent>
          </Card>
        ) : (
          items.map((n) => (
            <Card key={n.id} className={n.readAt ? "opacity-60" : "border-primary/40"}>
              <CardContent className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="text-body-sm text-on-surface">
                    {n.caseId ? (
                      <Link href={`/cases/${n.caseId}`} className="hover:text-primary">
                        {n.message}
                      </Link>
                    ) : (
                      n.message
                    )}
                  </p>
                  <p className="mt-1 font-mono text-label-sm text-on-surface-variant">{formatDateTime(n.createdAt)}</p>
                </div>
                {!n.readAt && (
                  <Button variant="ghost" size="sm" onClick={() => void markRead(n.id)}>
                    Mark read
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
