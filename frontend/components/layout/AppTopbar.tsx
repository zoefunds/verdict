"use client";

import { ConnectWalletButton } from "@/components/ConnectWalletButton";

export function AppTopbar({ title }: { title?: string }) {
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-outline-variant bg-surface/90 px-8 backdrop-blur-glass">
      <h1 className="text-headline-sm font-semibold text-on-surface">{title}</h1>
      <ConnectWalletButton />
    </div>
  );
}
