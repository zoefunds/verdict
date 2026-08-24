/**
 * Public Casebook — the social discovery layer over resolved cases.
 * Only ever surfaces cases with visibility = 'public' and status in a
 * resolved-ish state (verdict_rendered, final, settled). Never exposes
 * private cases, regardless of caller auth state.
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/client.js";
import { cases } from "../db/schema.js";
import { and, desc, eq, inArray } from "drizzle-orm";

const RESOLVED_STATUSES = ["verdict_rendered", "appeal_window", "appealed", "final", "settled"] as const;

export const casebookRoutes: FastifyPluginAsync = async (app) => {
  app.get("/casebook", async (req) => {
    const query = req.query as { category?: string; sort?: "recent" | "highest_stake" | "most_appealed" };
    const conditions = [eq(cases.visibility, "public"), inArray(cases.status, [...RESOLVED_STATUSES])];
    if (query.category) conditions.push(eq(cases.category, query.category));

    const results = await db
      .select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(desc(cases.settledAt), desc(cases.createdAt))
      .limit(50);

    return { cases: results };
  });
};
