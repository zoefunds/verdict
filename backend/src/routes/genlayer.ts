/**
 * GenLayer read-proxy routes.
 *
 * The frontend does NOT call the GenLayer StudioNet RPC directly for reads.
 * Every browser tab doing so independently would make the shared 30/min
 * rate-limit budget impossible to coordinate. Instead, all view-method
 * reads go through here, sharing the same Redis-coordinated bucket as the
 * indexer (see lib/rate-limiter.ts). Writes (stake locking, evidence
 * submission, verdict-triggering calls) still happen directly from the
 * user's own wallet in the browser — those are wallet-signed transactions,
 * not RPC-rate-limited reads, and must remain non-custodial.
 */

import type { FastifyPluginAsync } from "fastify";
import { getCase, getCaseCount, getCaseEvents, getEvidence, viewCall, isContractConfigured } from "../lib/genlayer-client.js";

export const genlayerRoutes: FastifyPluginAsync = async (app) => {
  app.get("/genlayer/status", async () => ({
    contractConfigured: isContractConfigured(),
  }));

  // Read immediately before submitting create_case: since case ids are
  // sequential starting at 0, this count IS the id the new case will get.
  // Avoids needing to decode a write transaction's return value at all.
  app.get("/genlayer/case-count", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    try {
      const count = await getCaseCount();
      return { count };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_case_count failed");
      return reply.code(502).send({ error: "Failed to read case count from contract" });
    }
  });

  app.get("/genlayer/case/:caseId", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const { caseId } = req.params as { caseId: string };
    try {
      const result = await getCase(Number(caseId));
      return { case: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_case failed");
      return reply.code(502).send({ error: "Failed to read case from contract" });
    }
  });

  app.get("/genlayer/case/:caseId/events", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const { caseId } = req.params as { caseId: string };
    const query = req.query as { limit?: string };
    try {
      const result = await getCaseEvents(Number(caseId), query.limit ? Number(query.limit) : 50);
      return { events: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_case_events failed");
      return reply.code(502).send({ error: "Failed to read case events from contract" });
    }
  });

  app.get("/genlayer/evidence/:evidenceId", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const { evidenceId } = req.params as { evidenceId: string };
    try {
      const result = await getEvidence(Number(evidenceId));
      return { evidence: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_evidence failed");
      return reply.code(502).send({ error: "Failed to read evidence from contract" });
    }
  });

  app.get("/genlayer/protocol-config", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    try {
      const result = await viewCall("get_protocol_config");
      return { config: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_protocol_config failed");
      return reply.code(502).send({ error: "Failed to read protocol config from contract" });
    }
  });

  app.get("/genlayer/constitution", async (req, reply) => {
    if (!isContractConfigured()) {
      return reply.code(503).send({ error: "Contract not yet configured" });
    }
    const query = req.query as { version?: string };
    try {
      const result = await viewCall("get_constitution", query.version ? [Number(query.version)] : [0]);
      return { constitution: result };
    } catch (err) {
      req.log.warn({ err }, "genlayer get_constitution failed");
      return reply.code(502).send({ error: "Failed to read constitution from contract" });
    }
  });
};
