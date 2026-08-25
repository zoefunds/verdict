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
 *
 * AUDIT FIX (external review, 2026-08-25): URL evidence previously hashed
 * the URL STRING itself, not the page content it points to — meaning the
 * "on-chain content-hash commitment" claim was false; the hash committed
 * couldn't detect any tampering at all, since a tampered page and an
 * untampered page produce the exact same hash of their shared URL. Fixed
 * by actually fetching the URL server-side (see lib/safe-fetch.ts for the
 * SSRF-guarded fetch) and hashing the real response body.
 */

import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db/client.js";
import { evidence, caseParticipants, cases } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { saveEvidenceFile } from "../storage/files.js";
import { env } from "../lib/env.js";
import { safeFetchText, truncateForHash, UnsafeUrlError } from "../lib/safe-fetch.js";
import { getEvidence as getOnChainEvidence, isContractConfigured } from "../lib/genlayer-client.js";

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

    if (!body.sourceUrl && !body.textContent) {
      return reply.code(400).send({ error: "Provide sourceUrl or textContent" });
    }

    let contentHashSha256: string;
    if (body.evidenceType === "url" && body.sourceUrl) {
      // Hash the ACTUAL fetched page content, not the URL string — see
      // the module-level AUDIT FIX comment above.
      let fetchedText: string;
      try {
        fetchedText = await safeFetchText(body.sourceUrl);
      } catch (err) {
        const message = err instanceof UnsafeUrlError ? err.message : "Failed to fetch URL for content hashing";
        return reply.code(422).send({ error: `Could not verify this URL's content: ${message}` });
      }
      // AUDIT FIX (re-audit, 2026-08-25): must hash the SAME canonical
      // byte-truncated content the contract hashes at verdict time — see
      // truncateForHash / EVIDENCE_HASH_TRUNCATION_BYTES in safe-fetch.ts.
      // Previously this hashed the full fetched text (up to 2MB), while
      // the contract only ever hashed its first 1200 chars, so any normal
      // page reported a false mismatch.
      contentHashSha256 = createHash("sha256").update(truncateForHash(fetchedText)).digest("hex");
    } else {
      contentHashSha256 = createHash("sha256").update(body.textContent ?? "", "utf8").digest("hex");
    }

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

  const LinkEvidenceBody = z.object({ contractEvidenceId: z.string().min(1) });

  function toContractKind(kind: string): string {
    if (kind === "url") return "URL";
    if (kind === "transaction_record") return "TX_RECORD";
    if (kind === "document" || kind === "image") return "DOCUMENT_HASH";
    return "TEXT_STATEMENT";
  }

  // Records the on-chain evidence id once the frontend's submit_evidence
  // write confirms.
  //
  // AUDIT FIX (re-audit, 2026-08-25): this previously trusted whatever
  // `contractEvidenceId` the client claimed, with no verification against
  // the contract at all — any authenticated submitter could link ANY id to
  // their row (their own unrelated evidence, another case's evidence id,
  // or a number that doesn't exist), and the UI would display a
  // misleading "on-chain" status for evidence that was never actually
  // committed as claimed. Fixed: reads the claimed id back from the
  // contract itself and cross-checks case id, submitter wallet address,
  // evidence kind, and content hash all match this row before persisting
  // — only a genuine match is ever marked linked.
  app.patch("/evidence/:id/link-contract", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = LinkEvidenceBody.parse(req.body);
    const { sub: userId, walletAddress } = req.user as { sub: string; walletAddress?: string };

    const [existing] = await db.select().from(evidence).where(eq(evidence.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "Evidence not found" });
    if (existing.submittedByUserId !== userId) {
      return reply.code(403).send({ error: "Only the submitter can link this evidence on-chain" });
    }

    const [caseRow] = await db.select().from(cases).where(eq(cases.id, existing.caseId)).limit(1);
    if (!caseRow || !caseRow.contractCaseId) {
      return reply.code(409).send({ error: "This case has no on-chain case id yet — cannot verify evidence linkage" });
    }

    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not configured — cannot verify evidence linkage" });
    }

    let onChain: Record<string, unknown>;
    try {
      onChain = await getOnChainEvidence(Number(body.contractEvidenceId));
    } catch (err) {
      req.log.warn({ err }, "on-chain evidence read failed during link-contract verification");
      return reply.code(502).send({ error: "Could not read this evidence id from the contract to verify it" });
    }

    const mismatches: string[] = [];
    if (String(onChain.case_id) !== String(caseRow.contractCaseId)) {
      mismatches.push(`case_id: on-chain=${onChain.case_id}, expected=${caseRow.contractCaseId}`);
    }
    if (walletAddress && String(onChain.submitted_by).toLowerCase() !== walletAddress.toLowerCase()) {
      mismatches.push(`submitted_by: on-chain=${onChain.submitted_by}, expected=${walletAddress}`);
    }
    const expectedKind = toContractKind(existing.evidenceType);
    if (String(onChain.kind) !== expectedKind) {
      mismatches.push(`kind: on-chain=${onChain.kind}, expected=${expectedKind}`);
    }
    if (String(onChain.content_hash).toLowerCase() !== existing.contentHashSha256.toLowerCase()) {
      mismatches.push("content_hash: on-chain value does not match this row's stored hash");
    }

    if (mismatches.length > 0) {
      req.log.warn({ mismatches, evidenceId: id, claimedContractId: body.contractEvidenceId }, "evidence link-contract verification failed");
      return reply.code(422).send({
        error: "The claimed on-chain evidence id does not match this record — not linked.",
        details: mismatches,
      });
    }

    const [updated] = await db
      .update(evidence)
      .set({ contractEvidenceId: body.contractEvidenceId })
      .where(eq(evidence.id, id))
      .returning();

    return { evidence: updated };
  });

  app.get("/cases/:caseId/evidence", async (req) => {
    const { caseId } = req.params as { caseId: string };
    const rows = await db.select().from(evidence).where(eq(evidence.caseId, caseId));
    return { evidence: rows };
  });
};
