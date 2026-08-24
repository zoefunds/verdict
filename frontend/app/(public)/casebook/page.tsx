"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/case/StatusBadge";
import { useCasebook } from "@/hooks/useCases";
import { formatWei, formatDate } from "@/lib/utils";

const CATEGORIES = ["all", "delivery", "freelance", "refund", "event", "sports", "community", "content", "dao", "commerce", "challenge"];

export default function CasebookPage() {
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<"recent" | "highest_stake" | "most_appealed">("recent");
  const { data, isLoading, isError } = useCasebook({ category: category === "all" ? undefined : category, sort });
  const cases = data?.cases ?? [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-headline-lg text-on-surface">Casebook</h1>
      <p className="mt-2 max-w-2xl text-body-md text-on-surface-variant">
        A public record of resolved VERDICT cases — every verdict grounded in evidence and a versioned
        constitution.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-4">
        <aside className="space-y-6 lg:col-span-1">
          <div>
            <p className="font-mono text-label-md uppercase text-on-surface-variant">Category</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`rounded-full border px-3 py-1 text-body-sm ${category === cat ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant"}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-mono text-label-md uppercase text-on-surface-variant">Sort</p>
            <div className="mt-2 flex flex-col gap-2">
              {[
                { v: "recent", l: "Most recent" },
                { v: "highest_stake", l: "Highest stake" },
                { v: "most_appealed", l: "Most appealed" },
              ].map((s) => (
                <Button key={s.v} variant={sort === s.v ? "default" : "ghost"} size="sm" onClick={() => setSort(s.v as typeof sort)}>
                  {s.l}
                </Button>
              ))}
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-headline-sm">Constitutional Integrity</CardTitle>
              <CardDescription>
                Every resolved case links its frozen constitution version. Amendments never retroactively
                change a completed verdict.
              </CardDescription>
            </CardHeader>
          </Card>
        </aside>

        <div className="lg:col-span-3">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : isError ? (
            <p className="text-body-sm text-error">Could not load the casebook from the API.</p>
          ) : cases.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No resolved public cases match these filters yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {cases.map((c) => (
                <Link key={c.id} href={`/casebook/${c.id}`} className="group">
                  <Card className="h-full transition-colors group-hover:border-primary/50">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-label-sm text-on-surface-variant">{c.caseNumber}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <CardTitle className="line-clamp-2">{c.title}</CardTitle>
                      <CardDescription className="line-clamp-3">{c.claimText}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between text-body-sm text-on-surface-variant">
                      <span>{c.category}</span>
                      <span className="font-mono">{formatWei(c.stakeAmountWei)} GEN</span>
                    </CardContent>
                    <CardContent className="pt-0 text-body-sm text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100">
                      Settled {formatDate(c.settledAt)}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
