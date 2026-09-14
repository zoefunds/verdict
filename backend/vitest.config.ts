import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several modules under test (indexer/poll.ts, routes/evidence.ts) pull
    // in db/client.ts and lib/env.ts transitively, both of which throw (or
    // hard `process.exit(1)`, in env.ts's case) at import time if their
    // required config is unset — correct behavior for the running app, but
    // it means unit tests exercising pure logic in those files need SOME
    // value present at import time even though no test here actually opens
    // a connection or reads a real secret. AUDIT FIX (re-audit,
    // 2026-09-14): this previously stubbed only DATABASE_URL — env.ts's
    // schema also requires JWT_SECRET and SESSION_REFRESH_SECRET (each
    // min 16 chars, no default), so `npm test` crashed with
    // `process.exit(1)` on any environment without a real backend/.env
    // file present (a fresh checkout, or CI, which sets none of these) —
    // the checked-in test config didn't actually work standalone. All
    // three are placeholders; no test in this project performs real I/O
    // or auth against them.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/verdict_test",
      JWT_SECRET: "test-jwt-secret-placeholder-not-real",
      SESSION_REFRESH_SECRET: "test-refresh-secret-placeholder-not-real",
    },
  },
});
