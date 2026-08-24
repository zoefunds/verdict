"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { shortAddress } from "@/lib/utils";
import { genlayerStudionet } from "@/lib/wagmi";

export function ConnectWalletButton() {
  const { isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { isAuthenticated, isAuthenticating, walletAddress, address, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // If no Reown project ID is configured, only the injected() connector
  // (MetaMask and similar browser wallets) is offered — WalletConnect-based
  // wallets (Rainbow, Zerion) require NEXT_PUBLIC_REOWN_PROJECT_ID to be set.

  const isWrongNetwork = isConnected && chainId !== genlayerStudionet.id;

  // A connected wallet on any chain other than GenLayer StudioNet can't
  // actually interact with the VERDICT contract — every write would either
  // be rejected by the wallet or silently sent to the wrong network. Force
  // a switch prompt before anything else (including sign-in) proceeds.
  if (isWrongNetwork) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => switchChain({ chainId: genlayerStudionet.id })}
        disabled={isSwitching}
      >
        {isSwitching ? "Switching…" : "Switch to GenLayer StudioNet"}
      </Button>
    );
  }

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
              connect({ connector, chainId: genlayerStudionet.id });
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
