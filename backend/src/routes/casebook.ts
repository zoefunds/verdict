/**
 * Public Casebook — the social discovery layer over resolved cases.
 * Only ever surfaces cases with visibility = 'public' and status in a
 * resolved-ish state (verdict_rendered, final, settled). Never exposes
 * private cases, regardless of caller auth state.
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/client.js";
import { cases, appeals } from "../db/schema.js";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

const RESOLVED_STATUSES = ["verdict_rendered", "appeal_window", "appealed", "final", "settled"] as const;

export const casebookRoutes: FastifyPluginAsync = async (app) => {
  app.get("/casebook", async (req) => {
    const query = req.query as { category?: string; sort?: "recent" | "highest_stake" | "most_appealed" };
    const conditions = [eq(cases.visibility, "public"), inArray(cases.status, [...RESOLVED_STATUSES])];
    if (query.category) conditions.push(eq(cases.category, query.category));

    if (query.sort === "highest_stake") {
      const results = await db
        .select()
        .from(cases)
        .where(and(...conditions))
        .orderBy(desc(sql`${cases.stakeAmountWei}::numeric`))
        .limit(50);
      return { cases: results };
    }

    if (query.sort === "most_appealed") {
      // Note: this counts rows in the local `appeals` table, which the
      // indexer does not yet populate (it only mirrors case status, not
      // appeal events) — so this sort is correctly implemented but will
      // return the same order as "recent" until appeal-event indexing
      // exists. Not faking a count, just honestly not yet fed.
      const rows = await db
        .select({ case: cases, appealCount: count(appeals.id) })
        .from(cases)
        .leftJoin(appeals, eq(appeals.caseId, cases.id))
        .where(and(...conditions))
        .groupBy(cases.id)
        .orderBy(desc(count(appeals.id)), desc(cases.settledAt))
        .limit(50);
      return { cases: rows.map((r) => r.case) };
    }

    const results = await db
      .select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(desc(cases.settledAt), desc(cases.createdAt))
      .limit(50);

    return { cases: results };
  });
};
