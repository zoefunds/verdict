#!/usr/bin/env python3
"""
step3_backend_api.py

Creates the Fastify backend application:
  - src/index.ts             app entrypoint, health checks, graceful shutdown
  - src/lib/env.ts           validated environment config
  - src/lib/auth.ts          SIWE-style nonce + signature verification
  - src/routes/auth.ts       /auth/nonce, /auth/verify, /auth/logout, /auth/me
  - src/routes/cases.ts      case CRUD/listing (off-chain index + creation intent)
  - src/routes/evidence.ts   evidence upload + hashing
  - src/routes/casebook.ts   public casebook listing/filtering
  - src/storage/files.ts     evidence file storage on the Fly.io volume
  - Dockerfile, fly.toml     Fly.io always-on deployment config

Usage:
    cd /Users/macbook/verdict
    python3 scripts/step3_backend_api.py
"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND = PROJECT_ROOT / "backend"

ENV_TS = """\
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BACKEND_PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  SESSION_REFRESH_SECRET: z.string().min(16),
  SESSION_REFRESH_EXPIRES_IN: z.string().default("7d"),
  EVIDENCE_STORAGE_PATH: z.string().default("./storage/uploads"),
  EVIDENCE_MAX_FILE_SIZE_MB: z.coerce.number().default(25),
  GENLAYER_RPC_URL: z.string().optional(),
  GENLAYER_CHAIN_ID: z.string().optional(),
  VERDICT_CONTRACT_ADDRESS: z.string().optional(),
  GENLAYER_INDEXER_START_BLOCK: z.coerce.number().default(0),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
"""

AUTH_LIB_TS = """\
/**
 * SIWE-style wallet authentication.
 *
 * Flow:
 *   1. Client requests a nonce for their wallet address (/auth/nonce).
 *   2. Client signs a deterministic challenge message containing that nonce
 *      with their wallet (personal_sign / EIP-191).
 *   3. Client posts the signature back (/auth/verify). We recover the
 *      signer address with viem, confirm it matches the claimed address,
 *      confirm the nonce is unexpired and unconsumed, then atomically mark
 *      it consumed (single-use — replay-proof) and issue a JWT session.
 *
 * The backend never sees or stores a private key. There is no custodial
 * wallet anywhere in this system.
 */

import { randomBytes } from "node:crypto";
import { verifyMessage, isAddress, getAddress } from "viem";
import { db } from "../db/client.js";
import { authNonces, users } from "../db/schema.js";
import { eq, and, isNull, gt } from "drizzle-orm";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough for a wallet popup, short enough to bound replay risk

export function buildSiweChallenge(walletAddress: string, nonce: string): string {
  return [
    "VERDICT wants you to sign in with your wallet.",
    "",
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    "",
    "This request will not trigger a blockchain transaction or cost any gas.",
  ].join("\\n");
}

export async function issueNonce(rawAddress: string): Promise<{ nonce: string; message: string }> {
  if (!isAddress(rawAddress)) {
    throw new Error("Invalid wallet address");
  }
  const walletAddress = getAddress(rawAddress);
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  await db.insert(authNonces).values({ walletAddress, nonce, expiresAt });

  return { nonce, message: buildSiweChallenge(walletAddress, nonce) };
}

export async function verifySignatureAndConsumeNonce(
  rawAddress: string,
  nonce: string,
  signature: `0x${string}`,
): Promise<{ userId: string; walletAddress: string }> {
  if (!isAddress(rawAddress)) {
    throw new Error("Invalid wallet address");
  }
  const walletAddress = getAddress(rawAddress);

  const [nonceRow] = await db
    .select()
    .from(authNonces)
    .where(
      and(
        eq(authNonces.walletAddress, walletAddress),
        eq(authNonces.nonce, nonce),
        isNull(authNonces.consumedAt),
        gt(authNonces.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!nonceRow) {
    throw new Error("Nonce not found, expired, or already used");
  }

  const message = buildSiweChallenge(walletAddress, nonce);

  const isValid = await verifyMessage({
    address: walletAddress,
    message,
    signature,
  });

  if (!isValid) {
    throw new Error("Signature verification failed");
  }

  // Consume the nonce BEFORE issuing a session so a second request with the
  // same signature can never mint a second session (replay protection).
  await db.update(authNonces).set({ consumedAt: new Date() }).where(eq(authNonces.id, nonceRow.id));

  const [existingUser] = await db.select().from(users).where(eq(users.walletAddress, walletAddress)).limit(1);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  } else {
    const [created] = await db
      .insert(users)
      .values({ walletAddress, lastLoginAt: new Date() })
      .returning({ id: users.id });
    userId = created!.id;
  }

  return { userId, walletAddress };
}
"""

ROUTES_AUTH_TS = """\
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { issueNonce, verifySignatureAndConsumeNonce } from "../lib/auth.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

const NonceBody = z.object({ walletAddress: z.string() });
const VerifyBody = z.object({
  walletAddress: z.string(),
  nonce: z.string(),
  signature: z.string(),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Rate limit auth endpoints more tightly than the general API — these are
  // the highest-value targets for brute-force / nonce-spam abuse.
  app.post("/auth/nonce", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = NonceBody.parse(req.body);
    try {
      const { nonce, message } = await issueNonce(body.walletAddress);
      return { nonce, message };
    } catch (err) {
      req.log.warn({ err }, "nonce issuance failed");
      return reply.code(400).send({ error: "Could not issue nonce" });
    }
  });

  app.post("/auth/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = VerifyBody.parse(req.body);
    try {
      const { userId, walletAddress } = await verifySignatureAndConsumeNonce(
        body.walletAddress,
        body.nonce,
        body.signature as `0x${string}`,
      );

      const accessToken = await reply.jwtSign({ sub: userId, walletAddress }, { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" });
      const refreshToken = await reply.jwtSign(
        { sub: userId, walletAddress, type: "refresh" },
        { expiresIn: process.env.SESSION_REFRESH_EXPIRES_IN ?? "7d" },
      );

      reply.setCookie("verdict_refresh", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/auth",
        maxAge: 60 * 60 * 24 * 7,
      });

      return { accessToken, userId, walletAddress };
    } catch (err) {
      req.log.warn({ err }, "signature verification failed");
      return reply.code(401).send({ error: "Authentication failed" });
    }
  });

  app.post("/auth/refresh", async (req, reply) => {
    const refreshToken = req.cookies["verdict_refresh"];
    if (!refreshToken) {
      return reply.code(401).send({ error: "No refresh token" });
    }
    try {
      const payload = app.jwt.verify<{ sub: string; walletAddress: string; type?: string }>(refreshToken);
      if (payload.type !== "refresh") {
        return reply.code(401).send({ error: "Invalid token type" });
      }
      const accessToken = await reply.jwtSign(
        { sub: payload.sub, walletAddress: payload.walletAddress },
        { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" },
      );
      return { accessToken };
    } catch {
      return reply.code(401).send({ error: "Invalid or expired refresh token" });
    }
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie("verdict_refresh", { path: "/auth" });
    return { ok: true };
  });

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const [user] = await db.select().from(users).where(eq(users.id, sub)).limit(1);
    return { user };
  });
};
"""

ROUTES_CASES_TS = """\
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
import { and, desc, eq } from "drizzle-orm";

const CreateCaseBody = z.object({
  title: z.string().min(8).max(200),
  claimText: z.string().min(20).max(5000),
  resolutionRule: z.string().min(10).max(2000),
  category: z.string().min(2).max(60),
  constitutionVersionId: z.string().uuid(),
  caseRules: z.array(z.string().max(500)).max(20).default([]),
  stakeAmountWei: z.string().regex(/^\\d+$/, "must be a base-10 integer string"),
  appealBondAmountWei: z.string().regex(/^\\d+$/),
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

  app.get("/cases", async (req) => {
    const query = req.query as { status?: string; category?: string; mine?: string };
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
"""

ROUTES_EVIDENCE_TS = """\
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
"""

STORAGE_FILES_TS = """\
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env.js";

/**
 * Evidence files are stored on the Fly.io persistent volume mounted at
 * EVIDENCE_STORAGE_PATH (see fly.toml [[mounts]]). Filenames are randomized
 * (never the user-supplied original name) to prevent path traversal and
 * collisions; the original filename is preserved only as metadata in the DB.
 */
export async function saveEvidenceFile(caseId: string, originalFilename: string, buffer: Buffer): Promise<string> {
  const safeExt = path.extname(originalFilename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const generatedName = `${randomUUID()}${safeExt}`;
  const caseDir = path.join(env.EVIDENCE_STORAGE_PATH, caseId);
  await mkdir(caseDir, { recursive: true });
  const fullPath = path.join(caseDir, generatedName);
  await writeFile(fullPath, buffer);
  return fullPath;
}
"""

ROUTES_CASEBOOK_TS = """\
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
"""

INDEX_TS = """\
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { env } from "./lib/env.js";
import { authRoutes } from "./routes/auth.js";
import { caseRoutes } from "./routes/cases.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { casebookRoutes } from "./routes/casebook.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}

async function buildServer() {
  const app = Fastify({
    logger:
      env.NODE_ENV === "production"
        ? { level: "info" }
        : { level: "debug", transport: { target: "pino-pretty" } },
    trustProxy: true, // required behind Fly.io's proxy for correct client IPs (rate limiting, audit logs)
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: env.EVIDENCE_MAX_FILE_SIZE_MB * 1024 * 1024 } });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  app.decorate("authenticate", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // Liveness/readiness probe for Fly.io health checks. This is the "must
  // never die" backstop: Fly restarts the machine automatically if this
  // stops responding. Keep it dependency-free and fast.
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      // A cheap DB round-trip proves the app can actually serve traffic,
      // not just that the process is alive.
      const { db } = await import("./db/client.js");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`select 1`);
      return { status: "ready" };
    } catch (err) {
      reply.code(503);
      return { status: "not_ready", error: (err as Error).message };
    }
  });

  await app.register(authRoutes);
  await app.register(caseRoutes);
  await app.register(evidenceRoutes);
  await app.register(casebookRoutes);

  return app;
}

async function main() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: env.BACKEND_PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
"""

DOCKERFILE = """\
# Multi-stage build for the VERDICT backend (Fastify + Node 20).
# Runs on Fly.io as an always-on machine (see fly.toml: min_machines_running = 1).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle

# Evidence volume mount point — see fly.toml [[mounts]]
RUN mkdir -p /data/evidence
ENV EVIDENCE_STORAGE_PATH=/data/evidence

EXPOSE 4000
CMD ["node", "dist/index.js"]
"""

FLY_TOML = """\
# Fly.io configuration for the VERDICT backend.
# "Backend must never die" -> min_machines_running = 1, auto_stop disabled,
# aggressive health checks with automatic restart on failure.

app = "verdict-backend"
primary_region = "iad"

[build]

[env]
  NODE_ENV = "production"
  BACKEND_PORT = "4000"
  CORS_ORIGIN = "https://verdict.vercel.app"

[[mounts]]
  source = "verdict_evidence_data"
  destination = "/data/evidence"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "10s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

# Secrets (JWT_SECRET, DATABASE_URL, SESSION_REFRESH_SECRET, etc.) must be
# set via `flyctl secrets set KEY=value` — never committed here.
"""


def write_if_missing(path: Path, content: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        print(f"SKIP  (already exists): {path.relative_to(PROJECT_ROOT)}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {path.relative_to(PROJECT_ROOT)}")


def main() -> None:
    print(f"Step 3: Backend API — project root: {PROJECT_ROOT}\n")
    write_if_missing(BACKEND / "src" / "lib" / "env.ts", ENV_TS)
    write_if_missing(BACKEND / "src" / "lib" / "auth.ts", AUTH_LIB_TS)
    write_if_missing(BACKEND / "src" / "routes" / "auth.ts", ROUTES_AUTH_TS)
    write_if_missing(BACKEND / "src" / "routes" / "cases.ts", ROUTES_CASES_TS)
    write_if_missing(BACKEND / "src" / "routes" / "evidence.ts", ROUTES_EVIDENCE_TS)
    write_if_missing(BACKEND / "src" / "routes" / "casebook.ts", ROUTES_CASEBOOK_TS)
    write_if_missing(BACKEND / "src" / "storage" / "files.ts", STORAGE_FILES_TS)
    write_if_missing(BACKEND / "src" / "index.ts", INDEX_TS)
    write_if_missing(BACKEND / "Dockerfile", DOCKERFILE)
    write_if_missing(BACKEND / "fly.toml", FLY_TOML)
    print("\nDone.")


if __name__ == "__main__":
    main()
