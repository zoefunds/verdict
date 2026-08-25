/**
 * One-off maintenance script: deletes ALL case data (cases,
 * case_participants, evidence, evidence_reviews, stakes, verdicts,
 * appeals, settlements, and case-scoped notifications — all cascade from
 * `cases` per schema.ts's onDelete: "cascade" — audit_logs' caseId is set
 * to null instead of deleted, preserving the audit trail). Users and
 * constitutions are left untouched, since neither is tied to a specific
 * contract deployment.
 *
 * Run via:
 *   flyctl ssh console --app verdict-backend --command "node dist/db/clear_all_cases.js"
 */
import "dotenv/config";
import { db } from "./client.js";
import { cases } from "./schema.js";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.delete(cases).returning({ id: cases.id, caseNumber: cases.caseNumber });
  console.log(`Deleted ${result.length} case(s):`, result.map((r) => r.caseNumber).join(", ") || "(none)");

  // Reset sequences/counters isn't needed (all ids are UUIDs, not
  // sequential), so nothing else to reset here.
  const [{ count }] = await db.execute(sql`select count(*)::int as count from cases`) as unknown as [{ count: number }];
  console.log(`Remaining cases in DB: ${count}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
