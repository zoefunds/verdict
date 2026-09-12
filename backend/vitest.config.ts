import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several modules under test (indexer/poll.ts, routes/evidence.ts) pull
    // in db/client.ts transitively, which throws at import time if
    // DATABASE_URL is unset — correct behavior for the running app, but it
    // means unit tests exercising pure logic in those files need SOME
    // connection string present at import time even though no test here
    // actually opens a connection. A placeholder is sufficient; no test in
    // this project performs real I/O against it.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/verdict_test",
    },
  },
});
