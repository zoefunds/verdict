"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { shortAddress } from "@/lib/utils";

export function ConnectWalletButton() {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { isAuthenticated, isAuthenticating, walletAddress, address, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // If no Reown project ID is configured, only the injected() connector
  // (MetaMask and similar browser wallets) is offered — WalletConnect-based
  // wallets (Rainbow, Zerion) require NEXT_PUBLIC_REOWN_PROJECT_ID to be set.

  if (isAuthenticated) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void logout();
          disconnect();
        }}
      >
        {shortAddress(walletAddress ?? address)} · Sign out
      </Button>
    );
  }

  if (isConnected) {
    return (
      <Button size="sm" onClick={() => void login()} disabled={isAuthenticating}>
        {isAuthenticating ? "Signing…" : "Sign in with wallet"}
      </Button>
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={isConnecting}>
          {isConnecting ? "Connecting…" : "Connect Wallet"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {connectors.map((connector) => (
          <DropdownMenuItem
            key={connector.uid}
            onClick={() => {
              connect({ connector });
              setMenuOpen(false);
            }}
          >
            {connector.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
