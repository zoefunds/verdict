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
import { useCase } from "@/hooks/useCases";
import { useTransaction } from "@/hooks/useTransaction";
import { genlayerContract } from "@/lib/genlayer";
import { formatWei } from "@/lib/utils";
import { useAccount } from "wagmi";

export default function AppealPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useCase(params.id);
  const { state, run } = useTransaction();
  const { address } = useAccount();
  const [note, setNote] = useState("");

  if (isLoading) return <Skeleton className="m-8 h-64" />;
  if (!data) return <div className="p-8 text-error">Case not found.</div>;
  const { case: c } = data;

  async function handleFileAppeal() {
    if (!address) {
      toast.error("Connect your wallet first.");
      return;
    }
    try {
      await run(async () => {
        const result = await genlayerContract.fileAppeal({
          account: address,
          contractCaseId: Number(c.contractCaseId ?? 0),
          bondWei: BigInt(c.appealBondAmountWei),
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
              Filing an appeal requires posting an appeal bond of {formatWei(c.appealBondAmountWei)} GEN and new
              evidence. This may only be done once per case, within the 7-day appeal window.
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
              <Button onClick={handleFileAppeal} disabled={!note || state.status === "wallet-confirm"}>
                Post Appeal Bond & File
              </Button>
            )}
          </CardContent>
        </Card>

        <EvidenceSubmitForm caseId={c.id} isAppeal />
      </div>
    </div>
  );
}
