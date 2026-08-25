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

  const UpdateMeBody = z.object({
    displayName: z.string().trim().max(80).optional(),
    bio: z.string().trim().max(500).optional(),
  });

  app.patch("/auth/me", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const body = UpdateMeBody.parse(req.body);

    if (Object.keys(body).length === 0) {
      return reply.code(400).send({ error: "No fields to update" });
    }

    const [updated] = await db
      .update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, sub))
      .returning();

    return { user: updated };
  });
};
