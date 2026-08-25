"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/lib/auth-store";
import { authApi } from "@/lib/api";
import { shortAddress, formatDate } from "@/lib/utils";

export default function ProfilePage() {
  const { isAuthenticated, user, walletAddress } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setDisplayName(user?.displayName ?? "");
    setBio(user?.bio ?? "");
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { user: updated } = await authApi.updateMe({ displayName, bio });
      setUser(updated);
      toast.success("Profile updated.");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

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
            <CardContent className="space-y-4 text-body-sm text-on-surface-variant">
              <p>Member since: {formatDate(user?.createdAt)}</p>
              <p>Last login: {formatDate(user?.lastLoginAt)}</p>

              {editing ? (
                <div className="space-y-4">
                  <div>
                    <Label className="mb-1.5 block" htmlFor="display-name">Display Name</Label>
                    <Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
                  </div>
                  <div>
                    <Label className="mb-1.5 block" htmlFor="bio">Bio</Label>
                    <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                    <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {user?.bio ? <p className="text-on-surface">{user.bio}</p> : <p>No bio set.</p>}
                  <Button variant="outline" size="sm" onClick={startEditing}>Edit Profile</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
