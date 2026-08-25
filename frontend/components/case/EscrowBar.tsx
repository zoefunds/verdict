import { Lock } from "lucide-react";
import { formatWei, shortAddress } from "@/lib/utils";
import type { CaseParticipant } from "@/types";

export function EscrowBar({
  stakeAmountWei,
  participants,
  respondentAddress,
}: {
  stakeAmountWei: string;
  participants: CaseParticipant[];
  respondentAddress?: string | null;
}) {
  const claimant = participants.find((p) => p.role === "claimant");
  const respondent = participants.find((p) => p.role === "respondent");
  const claimantLocked = Boolean(claimant?.stakeLockedAt);
  const respondentLocked = Boolean(respondent?.stakeLockedAt);

  return (
    <div className="rounded-md border border-outline-variant bg-surface-container-low p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-label-md uppercase tracking-wide text-on-surface-variant">Escrow</span>
        <Lock className="h-4 w-4 text-on-surface-variant" />
      </div>
      <div className="flex items-center gap-4">
        <Side label="Claimant" locked={claimantLocked} amount={stakeAmountWei} />
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high">
          <div className={`h-full flex-1 ${claimantLocked ? "bg-primary" : "bg-transparent"}`} />
          <div className={`h-full flex-1 ${respondentLocked ? "bg-primary" : "bg-transparent"}`} />
        </div>
        <Side
          label="Respondent"
          locked={respondentLocked}
          amount={stakeAmountWei}
          align="right"
          address={respondentAddress}
        />
      </div>
      <p className="mt-4 text-body-sm text-on-surface-variant">
        Total collateral in escrow: <span className="font-mono text-on-surface">{formatWei((BigInt(stakeAmountWei || "0") * BigInt(claimantLocked ? 1 : 0) + BigInt(stakeAmountWei || "0") * BigInt(respondentLocked ? 1 : 0)).toString())} GEN</span>
      </p>
    </div>
  );
}

function Side({
  label,
  locked,
  amount,
  align = "left",
  address,
}: {
  label: string;
  locked: boolean;
  amount: string;
  align?: "left" | "right";
  address?: string | null;
}) {
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <p className="font-mono text-label-sm uppercase text-on-surface-variant">{label}</p>
      {address && <p className="font-mono text-label-sm text-on-surface-variant">{shortAddress(address)}</p>}
      <p className="text-body-sm text-on-surface">{formatWei(amount)} GEN</p>
      <p className={`text-label-sm ${locked ? "text-secondary" : "text-on-surface-variant"}`}>{locked ? "Locked" : "Pending"}</p>
    </div>
  );
}
