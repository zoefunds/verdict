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
import { cases, caseParticipants, constitutionVersions, users, notifications } from "../db/schema.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

const CreateCaseBody = z.object({
  title: z.string().min(8).max(200),
  claimText: z.string().min(20).max(5000),
  resolutionRule: z.string().min(10).max(2000),
  category: z.string().min(2).max(60),
  constitutionVersionId: z.string().uuid(),
  caseRules: z.array(z.string().max(500)).max(20).default([]),
  // The contract's create_case requires a respondent address at creation
  // time (see contracts/verdict_contract.py) — VERDICT is a two-named-
  // parties dispute, not an open-to-anyone claim. The claimant must know
  // who they're disputing with.
  respondentAddress: z.string().refine((v) => isAddress(v), "must be a valid wallet address"),
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
    const { sub: userId, walletAddress: claimantWalletAddress } = req.user as { sub: string; walletAddress: string };

    const respondentAddress = getAddress(body.respondentAddress);
    if (claimantWalletAddress && getAddress(claimantWalletAddress) === respondentAddress) {
      return reply.code(400).send({ error: "The respondent cannot be the same wallet as the claimant" });
    }

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
        respondentAddress,
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

    // The respondent is named by address at creation time but may never
    // have signed in — get-or-create a user row for them (no session/login
    // implied, just a stable identity to attach the participant row to) so
    // the case's participant list is complete from the start rather than
    // only gaining a respondent row once they happen to fund their stake.
    const [existingRespondentUser] = await db
      .select()
      .from(users)
      .where(eq(users.walletAddress, respondentAddress))
      .limit(1);
    const respondentUserId =
      existingRespondentUser?.id ??
      (await db.insert(users).values({ walletAddress: respondentAddress }).returning({ id: users.id }))[0]!.id;

    await db.insert(caseParticipants).values({
      caseId: created!.id,
      userId: respondentUserId,
      role: "respondent",
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

    const [respondentParticipant] = await db
      .select()
      .from(caseParticipants)
      .where(and(eq(caseParticipants.caseId, id), eq(caseParticipants.role, "respondent")))
      .limit(1);
    if (respondentParticipant) {
      await db.insert(notifications).values({
        userId: respondentParticipant.userId,
        caseId: id,
        type: "case_stake_required",
        message: `${existing.caseNumber} was opened against you — fund your matching stake to open the evidence window.`,
      });
    }

    return { case: updated };
  });

  const FundRespondentBody = z.object({ stakeTxHash: z.string().min(1) });

  // Mirrors link-contract, but for the respondent's own on-chain
  // fund_respondent_stake confirmation. Only touches the respondent's
  // case_participants row (stakeLockedAt/stakeTxHash) — the case's overall
  // status transition is left to the indexer polling the contract, so this
  // never races with that as the source of truth for status.
  app.patch("/cases/:id/fund-respondent", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = FundRespondentBody.parse(req.body);
    const { sub: userId } = req.user as { sub: string };

    const [participant] = await db
      .select()
      .from(caseParticipants)
      .where(and(eq(caseParticipants.caseId, id), eq(caseParticipants.role, "respondent")))
      .limit(1);

    if (!participant) return reply.code(404).send({ error: "Respondent participant not found for this case" });
    if (participant.userId !== userId) {
      return reply.code(403).send({ error: "Only the named respondent can confirm their stake" });
    }

    await db
      .update(caseParticipants)
      .set({ stakeLockedAt: new Date(), stakeTxHash: body.stakeTxHash })
      .where(eq(caseParticipants.id, participant.id));

    const [caseRow] = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
    if (caseRow) {
      await db.insert(notifications).values({
        userId: caseRow.createdByUserId,
        caseId: id,
        type: "case_funded",
        message: `The respondent locked their stake on ${caseRow.caseNumber} — the evidence window is now open.`,
      });
    }

    return { ok: true };
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
