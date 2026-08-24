import { Badge } from "@/components/ui/badge";
import type { CaseStatus } from "@/types";

const STATUS_CONFIG: Record<CaseStatus, { label: string; variant: "neutral" | "primary" | "secondary" | "tertiary" | "error" | "appeal" }> = {
  draft: { label: "Draft", variant: "neutral" },
  open: { label: "Open", variant: "primary" },
  awaiting_respondent_stake: { label: "Awaiting Stake", variant: "tertiary" },
  funded: { label: "Funded", variant: "primary" },
  evidence_window: { label: "Evidence Window", variant: "primary" },
  under_investigation: { label: "Under Review", variant: "primary" },
  verdict_rendered: { label: "Verdict Rendered", variant: "secondary" },
  appeal_window: { label: "Appeal Window", variant: "tertiary" },
  appealed: { label: "Appealed", variant: "appeal" },
  re_investigation: { label: "Re-investigation", variant: "appeal" },
  final: { label: "Final", variant: "secondary" },
  settled: { label: "Settled", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "neutral" },
  abandoned: { label: "Abandoned", variant: "error" },
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "neutral" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
