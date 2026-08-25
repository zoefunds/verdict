/**
 * One-off maintenance script: frees up `contract_case_id = '0'` from the
 * VX-5379 test case, which was linked to the now-retired pre-audit
 * contract (0x56118ae3ee66b662a9a4CEf3424008c1D1036DbD). The new contract
 * (0x2be36DaF2FC169310dB7Cc2dAFBAa3Db410aA195) also starts numbering
 * cases at 0 — without this, `cases.contract_case_id`'s unique index
 * would reject the very first real case linked against the new contract.
 *
 * Run once via:
 *   flyctl ssh console --app verdict-backend --command "node dist/db/retire_orphaned_case.js"
 */
import "dotenv/config";
import { db } from "./client.js";
import { cases } from "./schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const [updated] = await db
    .update(cases)
    .set({
      contractCaseId: null,
      updatedAt: new Date(),
    })
    .where(eq(cases.caseNumber, "VX-5379"))
    .returning({ id: cases.id, caseNumber: cases.caseNumber });

  if (updated) {
    console.log(`Retired ${updated.caseNumber} (${updated.id}) — contractCaseId cleared, slot 0 freed.`);
  } else {
    console.log("No matching case found (already retired, or caseNumber changed).");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
