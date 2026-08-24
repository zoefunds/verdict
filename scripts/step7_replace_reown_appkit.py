#!/usr/bin/env python3
"""
step7_replace_reown_appkit.py

Replaces the @reown/appkit / @reown/appkit-adapter-wagmi dependency with
plain wagmi + @wagmi/connectors. The Reown AppKit package tree (941
transitive packages, pulling in unrelated Coinbase Smart Wallet / Safe
Gateway / MetaMask SDK bundles) proved too fragile to build reliably in
this environment (repeated "module not found" errors on optional
sub-dependencies, npm cache corruption on install). Plain wagmi connectors
give the same wallet coverage the user asked for:
  - MetaMask -> injected() connector (also catches any EIP-1193 browser wallet)
  - Rainbow, Zerion, and everything else -> walletConnect() connector
    (Reown's WalletConnect relay, same Project ID, no AppKit UI package
    needed — wagmi's own connector talks to the WalletConnect protocol
    directly)

Usage:
    cd /Users/macbook/verdict
    python3 scripts/step7_replace_reown_appkit.py
"""

from pathlib import Path
import json
import re

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND = PROJECT_ROOT / "frontend"

WAGMI_TS = """\
import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { env } from "./env";

export const reownProjectId = env.reownProjectId;

// Plain wagmi connectors instead of @reown/appkit's modal SDK — see
// scripts/step7_replace_reown_appkit.py for why. Coverage:
//   - injected(): MetaMask and any other EIP-1193 browser extension wallet
//   - walletConnect(): Rainbow, Zerion, and any other WalletConnect-
//     compatible wallet, via the same Reown Project ID
const connectors = [
  injected(),
  ...(reownProjectId
    ? [
        walletConnect({
          projectId: reownProjectId,
          metadata: {
            name: "VERDICT",
            description: "Put money behind your version of reality.",
            url: typeof window !== "undefined" ? window.location.origin : "https://verdict.app",
            icons: ["/icon.svg"],
          },
          showQrModal: true,
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
  connectors,
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});
"""

PROVIDERS_TSX = """\
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { Toaster } from "sonner";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
"""

CONNECT_BUTTON_TSX = """\
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
import { env } from "@/lib/env";

export function ConnectWalletButton() {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { isAuthenticated, isAuthenticating, walletAddress, address, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!env.reownProjectId && connectors.every((c) => c.type === "injected")) {
    // Injected-only fallback still works (MetaMask etc.), so this is a soft
    // notice, not a hard block — but WalletConnect-based wallets (Rainbow,
    // Zerion) won't be offered until the project ID is configured.
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
"""

DROPDOWN_MENU_TSX = """\
"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[10rem] overflow-hidden rounded-sm border border-outline-variant bg-surface-container p-1 text-on-surface shadow-lg",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-surface-variant focus:bg-surface-variant",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
"""


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {path.relative_to(PROJECT_ROOT)}")


def main() -> None:
    print(f"Step 7: replace @reown/appkit with plain wagmi — project root: {PROJECT_ROOT}\n")

    write_file(FRONTEND / "lib" / "wagmi.ts", WAGMI_TS)
    write_file(FRONTEND / "components" / "providers" / "Providers.tsx", PROVIDERS_TSX)
    write_file(FRONTEND / "components" / "ConnectWalletButton.tsx", CONNECT_BUTTON_TSX)
    write_file(FRONTEND / "components" / "ui" / "dropdown-menu.tsx", DROPDOWN_MENU_TSX)

    pkg_path = FRONTEND / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    deps = pkg["dependencies"]
    for dead in ("@reown/appkit", "@reown/appkit-adapter-wagmi"):
        if dead in deps:
            del deps[dead]
            print(f"REMOVED dependency: {dead}")
    deps["@radix-ui/react-dropdown-menu"] = "^2.1.1"
    pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    print(f"PATCHED {pkg_path.relative_to(PROJECT_ROOT)}")

    # next.config.mjs no longer needs the @x402 webpack aliasing workaround.
    config_path = FRONTEND / "next.config.mjs"
    config = config_path.read_text(encoding="utf-8")
    if "@x402" in config:
        config = (
            "/** @type {import('next').NextConfig} */\n"
            "const nextConfig = {\n"
            "  reactStrictMode: true,\n"
            "  eslint: { ignoreDuringBuilds: true },\n"
            "};\n\n"
            "export default nextConfig;\n"
        )
        config_path.write_text(config, encoding="utf-8")
        print(f"SIMPLIFIED {config_path.relative_to(PROJECT_ROOT)} (removed @x402 workaround, no longer needed)")

    print("\nDone. Run: rm -rf node_modules package-lock.json .next && npm install")


if __name__ == "__main__":
    main()
