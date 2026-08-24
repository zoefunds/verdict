"use client";

import { useAccount, useBalance } from "wagmi";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { shortAddress } from "@/lib/utils";
import { isContractDeployed } from "@/lib/env";

export default function WalletPage() {
  const { address, isConnected, chain } = useAccount();
  const { data: balance } = useBalance({ address });

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

        {!isContractDeployed && (
          <Card>
            <CardHeader>
              <CardTitle>GenLayer Collateral</CardTitle>
              <CardDescription>
                The VERDICT contract is not yet deployed on StudioNet, so on-chain GEN collateral balances
                cannot be shown here yet.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>
              Coming soon — the backend does not yet expose a per-user transaction history endpoint. This
              section is intentionally left as a stub rather than showing fabricated data.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
