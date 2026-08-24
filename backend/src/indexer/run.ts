import "dotenv/config";
import { syncAllCases } from "./poll.js";

const POLL_INTERVAL_MS = 15_000;

async function loop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    try {
      await syncAllCases();
    } catch (err) {
      console.error("[indexer] sync cycle failed", err);
    }
    const elapsed = Date.now() - start;
    const wait = Math.max(0, POLL_INTERVAL_MS - elapsed);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

console.log("[indexer] starting VERDICT contract -> Postgres sync loop");
loop();
