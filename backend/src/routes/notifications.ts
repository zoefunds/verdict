import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { notifications } from "../db/schema.js";
import { and, desc, eq, isNull } from "drizzle-orm";

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/notifications", { onRequest: [app.authenticate] }, async (req) => {
    const { sub: userId } = req.user as { sub: string };
    const query = req.query as { unreadOnly?: string };

    const conditions = [eq(notifications.userId, userId)];
    if (query.unreadOnly === "true") conditions.push(isNull(notifications.readAt));

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(100);

    return { notifications: rows };
  });

  const MarkReadBody = z.object({}).optional();

  app.patch("/notifications/:id/read", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { sub: userId } = req.user as { sub: string };
    MarkReadBody.parse(req.body);

    const [existing] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "Notification not found" });
    if (existing.userId !== userId) return reply.code(403).send({ error: "Not your notification" });

    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();

    return { notification: updated };
  });
};
