"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceSubmitForm } from "@/components/case/EvidenceSubmitForm";
import { useCase, useContractCase } from "@/hooks/useCases";
import { useTransaction } from "@/hooks/useTransaction";
import { genlayerContract } from "@/lib/genlayer";
import { fetchProtocolConfig } from "@/lib/genlayer-proxy";
import { env } from "@/lib/env";
import { formatWei } from "@/lib/utils";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";

export default function AppealPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useCase(params.id);
  const { data: onChainCase, isLoading: onChainLoading } = useContractCase(data?.case.contractCaseId);
  const { data: protocolConfig } = useQuery({
    queryKey: ["protocol-config"],
    queryFn: () => fetchProtocolConfig(env.apiBaseUrl),
    enabled: genlayerContract.isDeployed,
  });
  const { state, run } = useTransaction();
  const { address } = useAccount();
  const [note, setNote] = useState("");

  if (isLoading) return <Skeleton className="m-8 h-64" />;
  if (!data) return <div className="p-8 text-error">Case not found.</div>;
  const { case: c } = data;

  // The appeal bond is NOT the per-case "appealBondAmountWei" the claimant
  // typed in at case creation — that field is never sent to the contract
  // at all (create_case has no appeal-bond parameter). The contract
  // computes the required bond itself, independently, from the PROTOCOL-
  // WIDE appeal_bond_bps applied to the combined stake pool
  // (contracts/verdict_contract.py file_appeal:
  // `required_bond = (total_pot * appeal_bond_bps) // 10000`). Sending
  // any other amount reverts with "attached GEN must exactly equal the
  // required appeal bond" — so this must be computed the same way here.
  let requiredBondWei: bigint | null = null;
  if (onChainCase && protocolConfig) {
    const totalPot = BigInt(String(onChainCase.claimant_stake_wei ?? "0")) + BigInt(String(onChainCase.respondent_stake_wei ?? "0"));
    const bps = BigInt(String(protocolConfig.appeal_bond_bps ?? "0"));
    requiredBondWei = (totalPot * bps) / BigInt(10000);
  }

  async function handleFileAppeal() {
    if (!address) {
      toast.error("Connect your wallet first.");
      return;
    }
    if (!requiredBondWei) {
      toast.error("Still loading the required appeal bond — try again in a moment.");
      return;
    }
    try {
      await run(async () => {
        const result = await genlayerContract.fileAppeal({
          account: address,
          contractCaseId: Number(c.contractCaseId ?? 0),
          bondWei: requiredBondWei!,
          note,
        });
        return result.txHash;
      });
      toast.success("Appeal bond transaction submitted.");
      router.push(`/cases/${c.id}`);
    } catch {
      if (!genlayerContract.isDeployed) {
        toast.error("Contract not yet deployed — the appeal bond transaction cannot be submitted yet.");
      }
    }
  }

  return (
    <div>
      <AppTopbar title="File Appeal" />
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        <Card>
          <CardHeader>
            <CardTitle>Appeal {c.caseNumber}</CardTitle>
            <CardDescription>
              Filing an appeal requires posting an appeal bond and new evidence. The bond is set
              protocol-wide as a percentage of the combined stake, not chosen per case
              {requiredBondWei !== null && (
                <>
                  {" "}
                  — for this case that&apos;s <strong>{formatWei(requiredBondWei.toString())} GEN</strong>
                </>
              )}
              . This may only be done once per case, within the 7-day appeal window.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-1.5 block" htmlFor="appeal-note">Grounds for appeal</Label>
              <Textarea id="appeal-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} required />
            </div>
            {!genlayerContract.isDeployed ? (
              <div className="rounded border border-tertiary/40 bg-tertiary/10 p-4 text-body-sm text-tertiary">
                Contract not yet deployed — the on-chain appeal bond transaction cannot be submitted until
                NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS is configured.
              </div>
            ) : (
              <Button
                onClick={handleFileAppeal}
                disabled={!note || state.status === "wallet-confirm" || onChainLoading || requiredBondWei === null}
              >
                {onChainLoading || requiredBondWei === null ? "Loading bond amount…" : "Post Appeal Bond & File"}
              </Button>
            )}
          </CardContent>
        </Card>

        <EvidenceSubmitForm
          caseId={c.id}
          contractCaseId={c.contractCaseId}
          isAppeal
          canCommitOnChain={c.status === "re_investigation"}
        />
      </div>
    </div>
  );
}
