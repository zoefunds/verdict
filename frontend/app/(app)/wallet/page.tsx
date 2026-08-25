"use client";

import Link from "next/link";
import { useAccount, useBalance } from "wagmi";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/case/StatusBadge";
import { shortAddress, formatWei } from "@/lib/utils";
import { isContractDeployed } from "@/lib/env";
import { useMyCases } from "@/hooks/useCases";
import { useAuth } from "@/hooks/useAuth";

export default function WalletPage() {
  const { address, isConnected, chain } = useAccount();
  const { data: balance } = useBalance({ address });
  const { isAuthenticated } = useAuth();
  const { data: casesData, isLoading: casesLoading } = useMyCases();
  const cases = casesData?.cases ?? [];

  // A stake is actually locked (real GEN sitting in the contract) once the
  // case has left DRAFT — draft cases haven't submitted the on-chain
  // transaction yet, so their stakeAmountWei is a planned figure, not
  // locked collateral. Never conflate the two.
  const lockedCases = cases.filter((c) => c.status !== "draft" && c.status !== "cancelled");
  const totalLockedWei = lockedCases.reduce((sum, c) => sum + BigInt(c.stakeAmountWei || "0"), BigInt(0));

  return (
    <div>
      <AppTopbar title="Wallet" />
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        <Card>
          <CardHeader>
            <CardTitle>Connected Wallet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-body-sm">
            {!isConnected ? (
              <p className="text-on-surface-variant">No wallet connected. Use the connect button in the top bar.</p>
            ) : (
              <>
                <p><span className="text-on-surface-variant">Address:</span> <span className="font-mono text-on-surface">{shortAddress(address)}</span></p>
                <p><span className="text-on-surface-variant">Network:</span> <span className="text-on-surface">{chain?.name ?? "Unknown"}</span></p>
                <p><span className="text-on-surface-variant">Balance:</span> <span className="font-mono text-on-surface">{balance ? `${balance.formatted} ${balance.symbol}` : "—"}</span></p>
              </>
            )}
          </CardContent>
        </Card>

        {!isContractDeployed ? (
          <Card>
            <CardHeader>
              <CardTitle>GenLayer Collateral</CardTitle>
              <CardDescription>
                The VERDICT contract is not yet deployed on StudioNet, so on-chain GEN collateral balances
                cannot be shown here yet.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : !isAuthenticated ? (
          <Card>
            <CardContent className="p-6 text-body-sm text-on-surface-variant">
              Sign in with your wallet to see your case collateral.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Case Collateral</CardTitle>
              <CardDescription>
                Combined stake terms (both sides) across every non-draft case you&apos;re a party to — the
                per-side amount actually locked in escrow may be less if the other party hasn&apos;t funded
                yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {casesLoading ? (
                <Skeleton className="h-8 w-40" />
              ) : (
                <p className="font-mono text-headline-sm text-on-surface">{formatWei(totalLockedWei.toString())} GEN</p>
              )}
              {lockedCases.length > 0 && (
                <ul className="space-y-1">
                  {lockedCases.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-body-sm">
                      <Link href={`/cases/${c.id}`} className="text-on-surface hover:text-primary">
                        {c.caseNumber}
                      </Link>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={c.status} />
                        <span className="font-mono text-on-surface-variant">{formatWei(c.stakeAmountWei)} GEN</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>
              Coming soon — the backend does not yet expose a per-user transaction history endpoint (stake
              locks, settlements, appeal bonds as a flat list). Case-level transaction outcomes are visible
              on each case&apos;s own page above in the meantime.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
