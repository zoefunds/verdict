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
import { constitutionRoutes } from "./routes/constitutions.js";

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
  await app.register(constitutionRoutes);

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
