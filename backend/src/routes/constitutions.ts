/**
 * Constitution routes — public, read-only. Lets the frontend show the
 * "Applicable Rules" panel on a case (fetch by frozen constitutionVersionId)
 * and populate the constitution/resolution-recipe picker on case creation.
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/client.js";
import { constitutions, constitutionVersions, constitutionArticles } from "../db/schema.js";
import { and, asc, desc, eq } from "drizzle-orm";

export const constitutionRoutes: FastifyPluginAsync = async (app) => {
  // List active constitutions with their current version id, for the case
  // creation flow's constitution/resolution-recipe picker.
  app.get("/constitutions", async () => {
    const activeConstitutions = await db
      .select()
      .from(constitutions)
      .where(eq(constitutions.status, "active"));

    const results = await Promise.all(
      activeConstitutions.map(async (c) => {
        const [currentVersion] = await db
          .select()
          .from(constitutionVersions)
          .where(and(eq(constitutionVersions.constitutionId, c.id), eq(constitutionVersions.isCurrent, true)))
          .orderBy(desc(constitutionVersions.versionNumber))
          .limit(1);
        return {
          id: c.id,
          slug: c.slug,
          title: c.title,
          category: c.category,
          description: c.description,
          currentVersionId: currentVersion?.id ?? null,
        };
      }),
    );

    return { constitutions: results };
  });

  // A specific version's articles — this is what a case actually froze at
  // creation time, so cases must fetch by versionId, never "current".
  app.get("/constitutions/:versionId", async (req, reply) => {
    const { versionId } = req.params as { versionId: string };

    const [version] = await db
      .select()
      .from(constitutionVersions)
      .where(eq(constitutionVersions.id, versionId))
      .limit(1);

    if (!version) return reply.code(404).send({ error: "Constitution version not found" });

    const articles = await db
      .select()
      .from(constitutionArticles)
      .where(eq(constitutionArticles.constitutionVersionId, versionId))
      .orderBy(asc(constitutionArticles.displayOrder), asc(constitutionArticles.articleNumber));

    return { version, articles };
  });
};
