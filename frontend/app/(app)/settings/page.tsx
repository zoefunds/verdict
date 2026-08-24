"use client";

import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

export default function SettingsPage() {
  const { isAuthenticated, logout } = useAuth();

  return (
    <div>
      <AppTopbar title="Settings" />
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Sign out of your current wallet session.</CardDescription>
          </CardHeader>
          <CardContent>
            <button
              onClick={() => void logout()}
              disabled={!isAuthenticated}
              className="rounded border border-outline-variant px-4 py-2 text-body-sm text-on-surface hover:bg-surface-container disabled:opacity-50"
            >
              Sign out
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>
              Not yet implemented — the backend's users table supports displayName/bio/avatarUrl, but no
              PATCH /auth/me (or similar) endpoint exists yet to persist edits. Rather than fake a working
              save button, this section is left as an honest stub.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
            <CardDescription>Not yet implemented — no backend endpoint exists for this yet.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
