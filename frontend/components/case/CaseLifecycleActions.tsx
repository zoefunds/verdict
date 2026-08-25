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

// Matches contracts/verdict_contract.py's ABANDONMENT_GRACE_SECONDS.
const ABANDONMENT_GRACE_SECONDS = 14 * 24 * 60 * 60;

/**
 * The full case lifecycle as an explicit sequence of separate on-chain
 * steps (matching the contract's own design — kept deterministic/
 * nondeterministic concerns split apart):
 *
 *   DRAFT/AWAITING_RESPONDENT_STAKE --[cancel_case, claimant only]--> CANCELLED (full refund)
 *   EVIDENCE_WINDOW --[close_evidence_window_early, both sides]-----> deadline collapses to now
 *   EVIDENCE_WINDOW --[evidence_deadline passes naturally]----------> also ready
 *   ready + request_investigation (either party) -> UNDER_INVESTIGATION
 *   UNDER_INVESTIGATION + render_verdict (either party) -> APPEAL_WINDOW (verdict recorded)
 *   APPEAL_WINDOW + file_appeal (either party, once) -> APPEALED
 *   APPEALED + open_appeal_evidence_window (either party) -> RE_INVESTIGATION
 *   RE_INVESTIGATION + evidence deadline passed + resolve_appeal -> FINAL (second, final verdict)
 *   APPEAL_WINDOW (no appeal, deadline passed) + settle_case -> FINAL, funds paid out
 *   FINAL + settle_case -> funds paid out
 *
 * At every stage past AWAITING_RESPONDENT_STAKE, if the current stage's
 * deadline + a 14-day grace period has passed and nobody moved the case
 * forward, any party may reclaim their OWN deposited stake via
 * claim_case_abandonment — shown as a secondary option alongside the
 * normal action so a stalled case never permanently locks funds.
 *
 * "Request adjudication" in product terms is request_investigation +
 * render_verdict together — the former just changes state, the latter is
 * what actually invokes GenLayer's LLM+web-fetch evaluation. resolve_appeal
 * is the second, final adjudication after an appeal.
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

  const isClaimantWallet = Boolean(
    address && onChainCase && String(onChainCase.claimant ?? "").toLowerCase() === address.toLowerCase(),
  );

  if (!genlayerContract.isDeployed || !c.contractCaseId) return null;

  const contractCaseId = Number(c.contractCaseId);
  const nowSec = Math.floor(Date.now() / 1000);

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
  const btnLabel = (label: string, fallback: string) => (busyAction === label && busy ? "Confirm in wallet…" : fallback);

  const abandonmentButton = (deadline: number, reason: string) => {
    const eligible = deadline > 0 && nowSec > deadline + ABANDONMENT_GRACE_SECONDS;
    if (!eligible) return null;
    return (
      <div className="mt-2 border-t border-outline-variant pt-3">
        <p className="mb-2 text-body-sm text-tertiary">
          This case has stalled well past its deadline ({reason}) — you can reclaim your own deposited stake
          instead of waiting further.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            act("Claim abandonment", () => genlayerContract.claimCaseAbandonment({ account: address!, contractCaseId }))
          }
        >
          {btnLabel("Claim abandonment", "Reclaim My Stake (Abandonment)")}
        </Button>
      </div>
    );
  };

  if (!onChainCase) return null;

  const evidenceDeadline = Number(onChainCase.evidence_deadline ?? 0);
  const appealDeadline = Number(onChainCase.appeal_deadline ?? 0);
  const respondentJoinDeadline = Number(onChainCase.respondent_join_deadline ?? 0);

  if (c.status === "awaiting_respondent_stake") {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          {isClaimantWallet && (
            <>
              <p className="text-body-sm text-on-surface-variant">
                You may cancel this case for a full refund of your own stake as long as the respondent hasn&apos;t
                funded yet.
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act("Cancel case", () => genlayerContract.cancelCase({ account: address!, contractCaseId }))}
              >
                {btnLabel("Cancel case", "Cancel Case & Reclaim My Stake")}
              </Button>
            </>
          )}
          {abandonmentButton(respondentJoinDeadline, "respondent never funded")}
        </CardContent>
      </Card>
    );
  }

  const evidenceWindowOpen = c.status === "evidence_window";
  const evidenceWindowClosed = evidenceWindowOpen && nowSec >= evidenceDeadline && evidenceDeadline > 0;

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
            {btnLabel("Signal ready to close evidence window", "Signal Ready to Close Early")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (evidenceWindowClosed || c.status === "under_investigation") {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          {evidenceWindowClosed ? (
            <>
              <p className="text-body-sm text-on-surface-variant">
                The evidence window has closed. Either party can now request adjudication — this moves the
                case to investigation, then triggers GenLayer&apos;s evidence evaluation.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  act("Request investigation", () =>
                    genlayerContract.requestInvestigation({ account: address!, contractCaseId }),
                  )
                }
              >
                {btnLabel("Request investigation", "Request Investigation")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-body-sm text-on-surface-variant">
                This case is under investigation. Rendering the verdict triggers GenLayer&apos;s LLM +
                web-fetch evidence evaluation across validators — this is the actual adjudication step and
                may take a little time to reach consensus.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  act("Render verdict", () => genlayerContract.renderVerdict({ account: address!, contractCaseId }))
                }
              >
                {btnLabel("Render verdict", "Render Verdict")}
              </Button>
            </>
          )}
          {abandonmentButton(evidenceDeadline, "verdict never rendered")}
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
            onClick={() => act("Settle case", () => genlayerContract.settleCase({ account: address!, contractCaseId }))}
          >
            {btnLabel("Settle case", "Settle Case")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (c.status === "appealed") {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-body-sm text-on-surface-variant">
            An appeal has been filed. Either party can now open the post-appeal evidence window so the new
            evidence cited in the appeal can be submitted before re-evaluation.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act("Open appeal evidence window", () =>
                genlayerContract.openAppealEvidenceWindow({ account: address!, contractCaseId }),
              )
            }
          >
            {btnLabel("Open appeal evidence window", "Open Appeal Evidence Window")}
          </Button>
          {abandonmentButton(evidenceDeadline, "appeal evidence window never opened")}
        </CardContent>
      </Card>
    );
  }

  if (c.status === "re_investigation") {
    const postAppealWindowOpen = evidenceDeadline > 0 && nowSec < evidenceDeadline;
    if (postAppealWindowOpen) {
      return (
        <Card>
          <CardContent className="p-6 text-body-sm text-on-surface-variant">
            Post-appeal evidence window open until {formatDateTime(new Date(evidenceDeadline * 1000).toISOString())}.
            Submit new evidence above — the appeal will be resolved once this window closes.
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-body-sm text-on-surface-variant">
            The post-appeal evidence window has closed. Either party can now resolve the appeal — this
            triggers the second, final GenLayer evaluation. The appeal bond is returned to the appellant if
            the appeal succeeds, otherwise it&apos;s forfeited to the protocol treasury.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act("Resolve appeal", () => genlayerContract.resolveAppeal({ account: address!, contractCaseId }))
            }
          >
            {btnLabel("Resolve appeal", "Resolve Appeal")}
          </Button>
          {abandonmentButton(evidenceDeadline, "appeal never resolved")}
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
            onClick={() => act("Settle case", () => genlayerContract.settleCase({ account: address!, contractCaseId }))}
          >
            {btnLabel("Settle case", "Settle Case")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
