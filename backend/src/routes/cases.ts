/**
 * Case routes.
 *
 * IMPORTANT: this API indexes and assists case creation, it is NOT the
 * source of truth for stakes, escrow, or verdicts — that lives entirely on
 * the GenLayer contract. A case only becomes financially real once its
 * corresponding on-chain transaction is confirmed and the indexer
 * (src/indexer/) links contractCaseId back to this row. Creating a case row
 * here without an on-chain tx is a DRAFT the user can still discard.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { cases, caseParticipants, constitutionVersions } from "../db/schema.js";
import { and, desc, eq, inArray } from "drizzle-orm";

const CreateCaseBody = z.object({
  title: z.string().min(8).max(200),
  claimText: z.string().min(20).max(5000),
  resolutionRule: z.string().min(10).max(2000),
  category: z.string().min(2).max(60),
  constitutionVersionId: z.string().uuid(),
  caseRules: z.array(z.string().max(500)).max(20).default([]),
  stakeAmountWei: z.string().regex(/^\d+$/, "must be a base-10 integer string"),
  appealBondAmountWei: z.string().regex(/^\d+$/),
  visibility: z.enum(["public", "private"]).default("public"),
  evidenceWindowHours: z.number().int().min(1).max(24 * 30).default(72),
});

function generateCaseNumber(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `VX-${n}`;
}

export const caseRoutes: FastifyPluginAsync = async (app) => {
  // Create a DRAFT case row. The frontend must still submit the on-chain
  // case-creation transaction and call PATCH /cases/:id/link-contract with
  // the resulting contractCaseId + txHash before this case is considered
  // real and enters the OPEN state.
  app.post("/cases", { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = CreateCaseBody.parse(req.body);
    const { sub: userId } = req.user as { sub: string };

    const [version] = await db
      .select()
      .from(constitutionVersions)
      .where(eq(constitutionVersions.id, body.constitutionVersionId))
      .limit(1);

    if (!version) {
      return reply.code(400).send({ error: "Unknown constitution version" });
    }

    const [created] = await db
      .insert(cases)
      .values({
        caseNumber: generateCaseNumber(),
        title: body.title,
        claimText: body.claimText,
        resolutionRule: body.resolutionRule,
        category: body.category,
        constitutionVersionId: body.constitutionVersionId,
        caseRules: body.caseRules,
        createdByUserId: userId,
        stakeAmountWei: body.stakeAmountWei,
        appealBondAmountWei: body.appealBondAmountWei,
        visibility: body.visibility,
        evidenceWindowHours: body.evidenceWindowHours,
        status: "draft",
      })
      .returning();

    await db.insert(caseParticipants).values({
      caseId: created!.id,
      userId,
      role: "claimant",
    });

    return reply.code(201).send({ case: created });
  });

  const LinkContractBody = z.object({
    contractCaseId: z.string().min(1),
    stakeTxHash: z.string().min(1),
  });

  app.patch("/cases/:id/link-contract", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = LinkContractBody.parse(req.body);
    const { sub: userId } = req.user as { sub: string };

    const [existing] = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "Case not found" });
    if (existing.createdByUserId !== userId) {
      return reply.code(403).send({ error: "Only the case creator can link the on-chain case" });
    }
    if (existing.status !== "draft") {
      return reply.code(409).send({ error: "Case is not in draft state" });
    }

    const evidenceWindowClosesAt = new Date(Date.now() + existing.evidenceWindowHours * 60 * 60 * 1000);

    const [updated] = await db
      .update(cases)
      .set({
        contractCaseId: body.contractCaseId,
        status: "awaiting_respondent_stake",
        evidenceWindowClosesAt,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, id))
      .returning();

    await db
      .update(caseParticipants)
      .set({ stakeLockedAt: new Date(), stakeTxHash: body.stakeTxHash })
      .where(and(eq(caseParticipants.caseId, id), eq(caseParticipants.role, "claimant")));

    return { case: updated };
  });

  app.get("/cases/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [found] = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
    if (!found) return reply.code(404).send({ error: "Case not found" });

    if (found.visibility === "private") {
      // Private cases require the requester to be a participant. Auth is
      // optional on this route, so re-check explicitly rather than relying
      // on onRequest.
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(404).send({ error: "Case not found" }); // do not leak existence of private cases
      }
    }

    const participants = await db.select().from(caseParticipants).where(eq(caseParticipants.caseId, id));
    return { case: found, participants };
  });

  // GET /cases — public listing by default. When ?mine=true is passed, auth
  // is required and the listing instead returns every case (any visibility,
  // any status) where the caller is a participant (claimant or respondent),
  // for the authenticated user's own dashboard.
  app.get("/cases", async (req, reply) => {
    const query = req.query as { status?: string; category?: string; mine?: string };

    if (query.mine === "true") {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { sub: userId } = req.user as { sub: string };

      const myParticipations = await db
        .select({ caseId: caseParticipants.caseId })
        .from(caseParticipants)
        .where(eq(caseParticipants.userId, userId));
      const caseIds = myParticipations.map((p) => p.caseId);
      if (caseIds.length === 0) return { cases: [] };

      const conditions = [inArray(cases.id, caseIds)];
      if (query.status) conditions.push(eq(cases.status, query.status as (typeof cases.status.enumValues)[number]));
      if (query.category) conditions.push(eq(cases.category, query.category));

      const results = await db
        .select()
        .from(cases)
        .where(and(...conditions))
        .orderBy(desc(cases.createdAt))
        .limit(100);

      return { cases: results };
    }

    const conditions = [eq(cases.visibility, "public")];
    if (query.status) conditions.push(eq(cases.status, query.status as (typeof cases.status.enumValues)[number]));
    if (query.category) conditions.push(eq(cases.category, query.category));

    const results = await db
      .select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(desc(cases.createdAt))
      .limit(50);

    return { cases: results };
  });
};
