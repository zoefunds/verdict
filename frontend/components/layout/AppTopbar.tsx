"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { useAuth } from "@/hooks/useAuth";
import { notificationsApi } from "@/lib/api";

export function AppTopbar({ title }: { title?: string }) {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => notificationsApi.list(true),
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });
  const unreadCount = data?.notifications.length ?? 0;

  return (
    <div className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-outline-variant bg-surface/90 px-8 backdrop-blur-glass">
      <h1 className="text-headline-sm font-semibold text-on-surface">{title}</h1>
      <div className="flex items-center gap-4">
        <Link href="/notifications" className="relative text-on-surface-variant transition-colors hover:text-primary">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Link>
        <ConnectWalletButton />
      </div>
    </div>
  );
}
