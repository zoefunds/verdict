"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTransaction } from "@/hooks/useTransaction";
import { genlayerContract } from "@/lib/genlayer";
import { formatDateTime } from "@/lib/utils";
import type { Case } from "@/types";

/**
 * The adjudication pipeline, as an explicit sequence of separate on-chain
 * steps (matching contracts/verdict_contract.py's own design — kept
 * deterministic/nondeterministic concerns split apart):
 *
 *   EVIDENCE_WINDOW --[close_evidence_window_early, both sides]--> (deadline collapses to now)
 *   EVIDENCE_WINDOW --[evidence_deadline passes naturally]-------> also ready
 *   ready + request_investigation (either party) -> UNDER_INVESTIGATION
 *   UNDER_INVESTIGATION + render_verdict (either party) -> APPEAL_WINDOW (verdict recorded)
 *   APPEAL_WINDOW + appeal_deadline passed + settle_case (either party) -> FINAL, funds paid out
 *
 * "Request adjudication" in product terms is request_investigation +
 * render_verdict together — the former just changes state, the latter is
 * what actually invokes GenLayer's LLM+web-fetch evaluation.
 */
export function CaseLifecycleActions({
  c,
  onChainCase,
}: {
  c: Case;
  onChainCase: Record<string, unknown> | undefined;
}) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { state, run } = useTransaction();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  if (!genlayerContract.isDeployed || !c.contractCaseId || !onChainCase) return null;

  const contractCaseId = Number(c.contractCaseId);
  const nowSec = Math.floor(Date.now() / 1000);
  const evidenceDeadline = Number(onChainCase.evidence_deadline ?? 0);
  const appealDeadline = Number(onChainCase.appeal_deadline ?? 0);
  const evidenceWindowOpen = c.status === "evidence_window";
  const evidenceWindowClosed = evidenceWindowOpen && nowSec >= evidenceDeadline && evidenceDeadline > 0;

  async function act(label: string, fn: () => Promise<{ txHash: string }>) {
    if (!address) {
      toast.error("Connect your wallet first.");
      return;
    }
    setBusyAction(label);
    try {
      await run(() => fn().then((r) => r.txHash));
      toast.success(`${label} submitted.`);
      queryClient.invalidateQueries({ queryKey: ["case", c.id] });
      queryClient.invalidateQueries({ queryKey: ["contract-case", c.contractCaseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to submit ${label.toLowerCase()}`);
    } finally {
      setBusyAction(null);
    }
  }

  const busy = state.status === "wallet-confirm" || state.status === "pending";

  if (evidenceWindowOpen && !evidenceWindowClosed) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-body-sm text-on-surface-variant">
            Evidence window closes {formatDateTime(new Date(evidenceDeadline * 1000).toISOString())}. If both
            parties are ready sooner, either side can signal readiness to close it early — once both have,
            the window closes immediately for both.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act("Signal ready to close evidence window", () =>
                genlayerContract.closeEvidenceWindowEarly({ account: address!, contractCaseId }),
              )
            }
          >
            {busyAction === "Signal ready to close evidence window" && busy ? "Confirm in wallet…" : "Signal Ready to Close Early"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (evidenceWindowClosed) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-body-sm text-on-surface-variant">
            The evidence window has closed. Either party can now request adjudication — this moves the case
            to investigation, then triggers GenLayer&apos;s evidence evaluation.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act("Request investigation", () =>
                genlayerContract.requestInvestigation({ account: address!, contractCaseId }),
              )
            }
          >
            {busyAction === "Request investigation" && busy ? "Confirm in wallet…" : "Request Investigation"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (c.status === "under_investigation") {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-body-sm text-on-surface-variant">
            This case is under investigation. Rendering the verdict triggers GenLayer&apos;s LLM + web-fetch
            evidence evaluation across validators — this is the actual adjudication step and may take a
            little time to reach consensus.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act("Render verdict", () => genlayerContract.renderVerdict({ account: address!, contractCaseId }))
            }
          >
            {busyAction === "Render verdict" && busy ? "Confirm in wallet…" : "Render Verdict"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (c.status === "appeal_window") {
    const appealWindowOpen = appealDeadline > 0 && nowSec < appealDeadline;
    if (appealWindowOpen) {
      return (
        <Card>
          <CardContent className="p-6 text-body-sm text-on-surface-variant">
            Verdict rendered — appeal window open until {formatDateTime(new Date(appealDeadline * 1000).toISOString())}.
            Either party may file one appeal above, or wait for the window to close and settle the case.
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-body-sm text-on-surface-variant">
            The appeal window has closed with no appeal filed. Either party can now settle the case to
            release the escrowed GEN according to the verdict.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act("Settle case", () => genlayerContract.settleCase({ account: address!, contractCaseId }))
            }
          >
            {busyAction === "Settle case" && busy ? "Confirm in wallet…" : "Settle Case"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (c.status === "final") {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-body-sm text-on-surface-variant">
            Case is final and ready to settle — this releases the escrowed GEN according to the verdict.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act("Settle case", () => genlayerContract.settleCase({ account: address!, contractCaseId }))
            }
          >
            {busyAction === "Settle case" && busy ? "Confirm in wallet…" : "Settle Case"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
