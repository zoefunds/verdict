"use client";

import { AppTopbar } from "@/components/layout/AppTopbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function NotificationsPage() {
  return (
    <div>
      <AppTopbar title="Notifications" />
      <div className="mx-auto max-w-2xl p-8">
        <Card>
          <CardHeader>
            <CardTitle>Not yet implemented</CardTitle>
            <CardDescription>
              The backend has a `notifications` table in its schema but does not yet expose a REST endpoint to
              read or mark them. This page is a placeholder rather than showing fabricated notifications —
              wire it up once GET /notifications exists.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </div>
  );
}
