import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

const OUTCOME_LABELS: Record<string, string> = {
  CLAIMANT: "Claimant Wins",
  RESPONDENT: "Respondent Wins",
  PARTIAL: "Partial — Proportional Split",
  INCONCLUSIVE: "Inconclusive — Stakes Refunded",
};

/**
 * Shows the actual rendered verdict, read directly from the on-chain case
 * record (contracts/verdict_contract.py `_case_dict`) — outcome, split,
 * confidence, and the LLM's structured reasoning summary. Not shown until
 * `verdict_count` > 0 (i.e. GenLayer has actually rendered a verdict).
 */
export function VerdictCard({ onChainCase }: { onChainCase: Record<string, unknown> | undefined }) {
  if (!onChainCase || Number(onChainCase.verdict_count ?? 0) === 0) return null;

  const outcome = String(onChainCase.outcome ?? "");
  const splitBps = Number(onChainCase.verdict_split_bps ?? 0);
  const confidenceBps = Number(onChainCase.confidence_bps ?? 0);
  const reasoning = String(onChainCase.reasoning_summary ?? "");
  const renderedAt = Number(onChainCase.verdict_rendered_at ?? 0);

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Verdict</CardTitle>
          {renderedAt > 0 && (
            <span className="font-mono text-label-sm text-on-surface-variant">
              {formatDateTime(new Date(renderedAt * 1000).toISOString())}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-headline-sm text-primary">{OUTCOME_LABELS[outcome] ?? outcome}</p>
        {outcome === "PARTIAL" && (
          <p className="text-body-sm text-on-surface-variant">
            Claimant receives {(splitBps / 100).toFixed(1)}% of the combined stake; respondent receives the
            remainder.
          </p>
        )}
        <p className="text-body-sm text-on-surface-variant">Confidence: {(confidenceBps / 100).toFixed(1)}%</p>
        {reasoning && (
          <div>
            <p className="mb-1 font-mono text-label-sm uppercase tracking-wide text-on-surface-variant">
              Reasoning
            </p>
            <p className="text-body-sm text-on-surface">{reasoning}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
