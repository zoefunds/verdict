"use client";

import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { shortAddress, formatDate } from "@/lib/utils";

export default function ProfilePage() {
  const { isAuthenticated, user, walletAddress } = useAuth();

  return (
    <div>
      <AppTopbar title="Profile" />
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        {!isAuthenticated ? (
          <Card><CardContent className="p-8 text-body-md text-on-surface-variant">Sign in with your wallet to view your profile.</CardContent></Card>
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="h-14 w-14">
                <AvatarFallback>{(walletAddress ?? "?").slice(2, 4).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle>{user?.displayName ?? shortAddress(walletAddress)}</CardTitle>
                <p className="font-mono text-body-sm text-on-surface-variant">{shortAddress(walletAddress)}</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-body-sm text-on-surface-variant">
              <p>Member since: {formatDate(user?.createdAt)}</p>
              <p>Last login: {formatDate(user?.lastLoginAt)}</p>
              {user?.bio ? <p className="text-on-surface">{user.bio}</p> : <p>No bio set.</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
