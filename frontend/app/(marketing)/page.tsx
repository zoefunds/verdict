import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/case/StatusBadge";
import { casebookApi } from "@/lib/api";
import { formatWei } from "@/lib/utils";
import { ShieldCheck, FileSearch, Scale, GitBranch, Landmark, TrendingUp } from "lucide-react";

const STEPS = [
  { n: "01", title: "File a Claim", body: "State your version of events and the resolution rule that decides who is right." },
  { n: "02", title: "Lock Collateral", body: "Both claimant and respondent lock matching GEN collateral into on-chain escrow." },
  { n: "03", title: "Submit Evidence", body: "Documents, URLs, transaction records, and statements are hashed and timestamped." },
  { n: "04", title: "Independent Investigation", body: "GenLayer's Optimistic Democracy re-fetches and re-verifies evidence — never trusting a cached snapshot." },
  { n: "05", title: "Verdict Rendered", body: "A structured, constitution-grounded verdict is produced and posted on-chain." },
  { n: "06", title: "Settlement or Appeal", body: "The pot settles automatically, or either party may appeal once within 7 days." },
];

export default async function LandingPage() {
  let cases: Awaited<ReturnType<typeof casebookApi.list>>["cases"] = [];
  try {
    const res = await casebookApi.list({ sort: "recent" });
    cases = res.cases.slice(0, 3);
  } catch {
    cases = [];
  }

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-outline-variant">
        <div className="mx-auto max-w-7xl px-6 py-24 md:py-32">
          <Badge variant="primary" className="mb-6">Built on GenLayer Intelligent Contracts</Badge>
          <h1 className="max-w-3xl text-display-lg text-on-surface">
            Put money behind your version of reality.
          </h1>
          <p className="mt-6 max-w-2xl text-body-lg text-on-surface-variant">
            VERDICT is a collateralized, evidence-based dispute-resolution platform. Two parties lock real
            collateral, submit evidence, and an independent, constitution-grounded process renders a binding
            verdict. This is not gambling and not a prediction market — every case starts from a real
            disagreement between two people who already have a stake in the truth.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Button size="lg" asChild>
              <Link href="/cases/new">Open a Case</Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link href="/casebook">Browse the Casebook</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-b border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="text-headline-lg text-on-surface">Procedural Rigor</h2>
          <p className="mt-3 max-w-2xl text-body-md text-on-surface-variant">
            Every case follows the same six-step process, enforced by the contract's state machine — no
            shortcuts, no discretionary overrides.
          </p>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step) => (
              <Card key={step.n}>
                <CardHeader>
                  <span className="font-mono text-label-md text-primary">{step.n}</span>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Why evidence matters / GenLayer */}
      <section className="border-b border-outline-variant">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-6 py-24 md:grid-cols-2">
          <div>
            <FileSearch className="h-8 w-8 text-primary" />
            <h3 className="mt-4 text-headline-md text-on-surface">Why evidence matters</h3>
            <p className="mt-3 text-body-md text-on-surface-variant">
              Every claim is decided on submitted or independently re-verified evidence — never on stake size,
              popularity, or sentiment. URL evidence is re-fetched live at verdict time by every validator, so
              tampering after submission is detectable, not exploitable.
            </p>
          </div>
          <div>
            <GitBranch className="h-8 w-8 text-primary" />
            <h3 className="mt-4 text-headline-md text-on-surface">How GenLayer is used</h3>
            <p className="mt-3 text-body-md text-on-surface-variant">
              The verdict logic runs as a GenLayer Intelligent Contract. Its non-deterministic, LLM-backed
              evaluation reaches consensus through Optimistic Democracy — independent validators compare
              structured verdict fields, not raw prose, before a result is finalized on-chain.
            </p>
          </div>
          <div>
            <Landmark className="h-8 w-8 text-secondary" />
            <h3 className="mt-4 text-headline-md text-on-surface">Constitutional evolution</h3>
            <p className="mt-3 text-body-md text-on-surface-variant">
              Every case freezes the constitution version active at its own creation — amendments publish new
              versions and are never retroactive. You always know exactly which rules governed your case.
            </p>
          </div>
          <div>
            <Scale className="h-8 w-8 text-appeal" />
            <h3 className="mt-4 text-headline-md text-on-surface">Appeals</h3>
            <p className="mt-3 text-body-md text-on-surface-variant">
              Either party may appeal once, within a 7-day window, by posting an appeal bond and new evidence.
              The second, independent verdict is final.
            </p>
          </div>
        </div>
      </section>

      {/* Resolution recipes */}
      <section id="recipes" className="border-b border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="text-headline-lg text-on-surface">Resolution Recipes</h2>
          <p className="mt-3 max-w-2xl text-body-md text-on-surface-variant">
            Reusable constitution templates for common disputes — Delivery, Freelance, Refund, Event,
            Commerce, and more — so you never have to write a rulebook from scratch.
          </p>
          <div className="mt-8">
            <Button variant="outline" asChild>
              <Link href="/cases/new">Start from a recipe</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Casebook preview */}
      <section className="border-b border-outline-variant">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-lg text-on-surface">From the Casebook</h2>
            <Link href="/casebook" className="text-body-sm text-primary hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            {cases.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                No public cases have resolved yet — check back soon, or be the first to open one.
              </p>
            ) : (
              cases.map((c) => (
                <Link key={c.id} href={`/casebook/${c.id}`}>
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-label-sm text-on-surface-variant">{c.caseNumber}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <CardTitle className="line-clamp-2">{c.title}</CardTitle>
                      <CardDescription className="line-clamp-2">{c.claimText}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between text-body-sm text-on-surface-variant">
                      <span>{c.category}</span>
                      <span className="font-mono">{formatWei(c.stakeAmountWei)} GEN</span>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Trust & security */}
      <section id="trust" className="border-b border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-secondary" />
          <h2 className="mt-4 text-headline-lg text-on-surface">Trust & security</h2>
          <p className="mx-auto mt-3 max-w-2xl text-body-md text-on-surface-variant">
            Collateral is held in a GenLayer Intelligent Contract, never by VERDICT. Every evidence submission
            is content-hashed at intake and independently re-verified at verdict time. Nothing here is
            gambling — both parties already disagree about something real before a case ever opens.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto flex max-w-7xl flex-col items-center px-6 py-24 text-center">
          <TrendingUp className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-headline-lg text-on-surface">Ready to resolve your dispute?</h2>
          <div className="mt-8 flex gap-4">
            <Button size="lg" asChild>
              <Link href="/cases/new">Open a Case</Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
