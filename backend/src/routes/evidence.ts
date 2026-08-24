/**
 * Evidence routes.
 *
 * Every uploaded file or submitted URL/text is content-hashed (SHA-256) at
 * submission time. That hash is what later gets committed on-chain by the
 * frontend's evidence-submission transaction. The contract's verdict-time
 * nondet evaluation independently re-fetches URL evidence and compares
 * hashes — a mismatch is a tamper signal, not something this API silently
 * resolves. This route only stores content and computes the hash; it does
 * NOT decide evidence is "verified" — only the contract can.
 */

import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db/client.js";
import { evidence, caseParticipants } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { saveEvidenceFile } from "../storage/files.js";
import { env } from "../lib/env.js";

const TextEvidenceBody = z.object({
  caseId: z.string().uuid(),
  evidenceType: z.enum(["url", "transaction_record", "text_statement"]),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  sourceUrl: z.string().url().optional(),
  textContent: z.string().max(20000).optional(),
});

async function assertParticipant(caseId: string, userId: string) {
  const rows = await db
    .select()
    .from(caseParticipants)
    .where(and(eq(caseParticipants.caseId, caseId), eq(caseParticipants.userId, userId)));
  if (rows.length === 0) {
    throw new Error("Only case participants may submit evidence");
  }
}

export const evidenceRoutes: FastifyPluginAsync = async (app) => {
  // URL / transaction-record / plain-text evidence — no binary upload.
  app.post("/evidence/text", { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = TextEvidenceBody.parse(req.body);
    const { sub: userId } = req.user as { sub: string };

    try {
      await assertParticipant(body.caseId, userId);
    } catch (err) {
      return reply.code(403).send({ error: (err as Error).message });
    }

    const hashInput = body.sourceUrl ?? body.textContent ?? "";
    if (!hashInput) {
      return reply.code(400).send({ error: "Provide sourceUrl or textContent" });
    }
    const contentHashSha256 = createHash("sha256").update(hashInput, "utf8").digest("hex");

    const [created] = await db
      .insert(evidence)
      .values({
        caseId: body.caseId,
        submittedByUserId: userId,
        evidenceType: body.evidenceType,
        title: body.title,
        description: body.description,
        sourceUrl: body.sourceUrl,
        textContent: body.textContent,
        contentHashSha256,
        provenance: "participant_submitted",
        status: "submitted",
      })
      .returning();

    return reply.code(201).send({ evidence: created });
  });

  // Document/image upload (multipart). Requires @fastify/multipart registered
  // on the app.
  app.post("/evidence/file", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub: userId } = req.user as { sub: string };
    const data = await req.file({ limits: { fileSize: env.EVIDENCE_MAX_FILE_SIZE_MB * 1024 * 1024 } });
    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const fields = data.fields as Record<string, { value?: string }>;
    const caseId = fields.caseId?.value;
    const title = fields.title?.value;
    const evidenceType = (fields.evidenceType?.value ?? "document") as "document" | "image";

    if (!caseId || !title) {
      return reply.code(400).send({ error: "caseId and title fields are required" });
    }

    try {
      await assertParticipant(caseId, userId);
    } catch (err) {
      return reply.code(403).send({ error: (err as Error).message });
    }

    const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    if (!ALLOWED_MIME.has(data.mimetype)) {
      return reply.code(415).send({ error: `Unsupported file type: ${data.mimetype}` });
    }

    const buffer = await data.toBuffer();
    if (buffer.length === 0) {
      return reply.code(400).send({ error: "Empty file" });
    }

    const contentHashSha256 = createHash("sha256").update(buffer).digest("hex");
    const storedPath = await saveEvidenceFile(caseId, data.filename, buffer);

    const [created] = await db
      .insert(evidence)
      .values({
        caseId,
        submittedByUserId: userId,
        evidenceType,
        title,
        fileStoragePath: storedPath,
        fileMimeType: data.mimetype,
        fileSizeBytes: buffer.length,
        contentHashSha256,
        provenance: "participant_submitted",
        status: "submitted",
      })
      .returning();

    return reply.code(201).send({ evidence: created });
  });

  app.get("/cases/:caseId/evidence", async (req) => {
    const { caseId } = req.params as { caseId: string };
    const rows = await db.select().from(evidence).where(eq(evidence.caseId, caseId));
    return { evidence: rows };
  });
};
