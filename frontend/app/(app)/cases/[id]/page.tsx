"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/case/StatusBadge";
import { EscrowBar } from "@/components/case/EscrowBar";
import { EvidenceTimeline } from "@/components/case/EvidenceTimeline";
import { ConstitutionSidebar } from "@/components/case/ConstitutionSidebar";
import { EvidenceSubmitForm } from "@/components/case/EvidenceSubmitForm";
import { VerdictCard } from "@/components/case/VerdictCard";
import { CaseLifecycleActions } from "@/components/case/CaseLifecycleActions";
import { useCase, useCaseEvidence, useContractCase } from "@/hooks/useCases";
import { useTransaction } from "@/hooks/useTransaction";
import { usePublishCaseOnChain } from "@/hooks/usePublishCaseOnChain";
import { genlayerContract } from "@/lib/genlayer";
import { casesApi } from "@/lib/api";
import { formatWei, formatDateTime } from "@/lib/utils";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

export default function CaseDetailsPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = useCase(params.id);
  const { data: evidenceData } = useCaseEvidence(params.id);
  const { data: onChainCase } = useContractCase(data?.case.contractCaseId);
  const { state, run } = useTransaction();
  const { state: publishState, publish } = usePublishCaseOnChain();
  const { address } = useAccount();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <div>
        <AppTopbar title="Case" />
        <div className="space-y-4 p-8">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <AppTopbar title="Case" />
        <div className="p-8 text-body-md text-error">Case not found, or you don&apos;t have access to it.</div>
      </div>
    );
  }

  const { case: c, participants } = data;
  const inAppealWindow = c.status === "appeal_window";
  const isRespondent = Boolean(
    address && c.respondentAddress && address.toLowerCase() === c.respondentAddress.toLowerCase(),
  );
  const isClaimant = Boolean(user && user.id === c.createdByUserId);
  const evidence = evidenceData?.evidence ?? [];

  async function handleFundStake() {
    if (!address) {
      toast.error("Connect your wallet first.");
      return;
    }
    try {
      await run(async () => {
        const result = await genlayerContract.fundRespondentStake({
          account: address,
          contractCaseId: Number(c.contractCaseId ?? 0),
          valueWei: BigInt(c.stakeAmountWei),
        });
        // Confirm with the backend so the respondent's case_participants
        // row reflects the lock (the indexer separately updates the
        // overall case status by polling the contract, but only this
        // confirms the per-participant lock timestamp shown in EscrowBar).
        await casesApi.fundRespondentConfirm(c.id, result.txHash);
        queryClient.invalidateQueries({ queryKey: ["case", c.id] });
        return result.txHash;
      });
    } catch {
      // state already reflects the failure; surface a toast too
      if (!genlayerContract.isDeployed) {
        toast.error("Contract not yet deployed — cannot submit an on-chain stake transaction yet.");
      }
    }
  }

  async function handlePublish() {
    if (!address) {
      toast.error("Connect your wallet first.");
      return;
    }
    try {
      await publish(address, c);
      toast.success("Case published on-chain — your stake is locked.");
      queryClient.invalidateQueries({ queryKey: ["case", c.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish case on-chain");
    }
  }

  return (
    <div>
      <AppTopbar title={`${c.caseNumber}`} />
      <div className="grid grid-cols-1 gap-8 p-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="font-mono text-label-sm text-on-surface-variant">{c.caseNumber} · {c.category}</span>
                <StatusBadge status={c.status} />
              </div>
              <CardTitle>{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-body-sm text-on-surface-variant">
                Evidence window closes: {formatDateTime(c.evidenceWindowClosesAt)}
                {c.appealWindowClosesAt && <> · Appeal window closes: {formatDateTime(c.appealWindowClosesAt)}</>}
              </p>
            </CardContent>
          </Card>

          <VerdictCard onChainCase={onChainCase as Record<string, unknown> | undefined} />

          <CaseLifecycleActions c={c} onChainCase={onChainCase as Record<string, unknown> | undefined} />

          <EscrowBar stakeAmountWei={c.stakeAmountWei} participants={participants} respondentAddress={c.respondentAddress} />

          {c.status === "draft" && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <p className="text-body-sm text-on-surface-variant">
                  This case is a draft — it isn&apos;t real until you publish it on-chain and lock your
                  stake. Respondent: <span className="font-mono text-on-surface">{c.respondentAddress ?? "not set"}</span>
                </p>
                {!genlayerContract.isDeployed ? (
                  <div className="rounded border border-tertiary/40 bg-tertiary/10 p-4 text-body-sm text-tertiary">
                    Contract not yet deployed — the on-chain case-creation transaction cannot be submitted
                    until NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS is configured.
                  </div>
                ) : (
                  <Button
                    onClick={handlePublish}
                    disabled={publishState.status === "wallet-confirm" || publishState.status === "pending"}
                  >
                    {publishState.status === "wallet-confirm"
                      ? "Confirm in wallet…"
                      : publishState.status === "pending"
                        ? "Publishing…"
                        : `Publish On-Chain & Lock Stake (${formatWei(c.stakeAmountWei)} GEN)`}
                  </Button>
                )}
                {publishState.status === "failed" && <p className="text-body-sm text-error">{publishState.error}</p>}
                <TxStateNote state={publishState.status} />
              </CardContent>
            </Card>
          )}

          {c.status === "awaiting_respondent_stake" && (
            <Card>
              <CardContent className="space-y-3 p-6">
                {isRespondent ? (
                  <>
                    <p className="text-body-sm text-on-surface-variant">
                      This case was opened against you. Fund your matching collateral to open the evidence
                      window.
                    </p>
                    {!genlayerContract.isDeployed ? (
                      <div className="rounded border border-tertiary/40 bg-tertiary/10 p-4 text-body-sm text-tertiary">
                        Contract not yet deployed — the on-chain stake transaction cannot be submitted until
                        NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS is configured.
                      </div>
                    ) : (
                      <Button onClick={handleFundStake} disabled={state.status === "wallet-confirm" || state.status === "pending"}>
                        Fund Respondent Stake ({formatWei(c.stakeAmountWei)} GEN)
                      </Button>
                    )}
                    <TxStateNote state={state.status} />
                  </>
                ) : (
                  <p className="text-body-sm text-on-surface-variant">
                    Waiting on the respondent (
                    <span className="font-mono text-on-surface">{c.respondentAddress}</span>) to fund their
                    matching collateral before the evidence window opens.
                    {isClaimant && " Only they can complete this step — your stake is already locked."}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

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
            <CardContent>
              <EvidenceTimeline
                evidence={evidence}
                caseId={c.id}
                contractCaseId={c.contractCaseId}
                canCommitOnChain={c.status === "evidence_window" || c.status === "re_investigation"}
              />
            </CardContent>
          </Card>

          {c.status === "evidence_window" || c.status === "re_investigation" ? (
            <EvidenceSubmitForm caseId={c.id} contractCaseId={c.contractCaseId} />
          ) : (
            <Card>
              <CardContent className="p-6 text-body-sm text-on-surface-variant">
                Evidence can only be submitted while the case is in its evidence window (current status:{" "}
                <span className="font-mono text-on-surface">{c.status}</span>). This matches the contract&apos;s
                own rule — <code className="font-mono">submit_evidence</code> only accepts calls during{" "}
                <code className="font-mono">EVIDENCE_WINDOW</code> or <code className="font-mono">RE_INVESTIGATION</code>.
              </CardContent>
            </Card>
          )}

          {inAppealWindow && (
            <Card>
              <CardContent className="flex items-center justify-between p-6">
                <p className="text-body-sm text-on-surface-variant">
                  The appeal window is open. Either party may file one appeal with new evidence and a bond.
                </p>
                <Button variant="outline" asChild>
                  <Link href={`/cases/${c.id}/appeal`}>File Appeal</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <ConstitutionSidebar versionId={c.constitutionVersionId} caseRules={c.caseRules} />
        </div>
      </div>
    </div>
  );
}

function TxStateNote({ state }: { state: string }) {
  const messages: Record<string, string> = {
    "wallet-confirm": "Confirm the transaction in your wallet…",
    submitted: "Transaction submitted, waiting for confirmation…",
    pending: "Transaction pending…",
    confirmed: "Transaction confirmed.",
    failed: "Transaction failed.",
    rejected: "Transaction was rejected in your wallet.",
    "wrong-network": "Switch your wallet to the correct network.",
    "insufficient-funds": "Insufficient funds for this transaction.",
    "wallet-disconnected": "Your wallet is disconnected.",
    "contract-not-deployed": "Contract not yet deployed.",
  };
  if (state === "idle" || !messages[state]) return null;
  return <p className="text-body-sm text-on-surface-variant">{messages[state]}</p>;
}
