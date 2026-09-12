import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CONTRACT_STATUS_TO_DB_STATUS } from "./poll.js";

// Extracts every STATUS_* = "..." constant directly from the contract
// source, so this test fails loudly the moment the contract adds/renames a
// status the indexer doesn't know how to map — rather than silently
// dropping status updates in production (see syncOneCase's `if (!status)`
// warn-and-skip branch, which is exactly the failure mode this guards
// against).
function loadContractStatusValues(): string[] {
  const contractPath = path.resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../../contracts/verdict_contract.py",
  );
  const source = readFileSync(contractPath, "utf8");
  const matches = [...source.matchAll(/^STATUS_[A-Z_]+\s*=\s*"([A-Z_]+)"/gm)];
  return matches.map((m) => m[1]!);
}

describe("CONTRACT_STATUS_TO_DB_STATUS", () => {
  it("has a mapping for every status constant the contract actually defines", () => {
    const contractStatuses = loadContractStatusValues();
    expect(contractStatuses.length).toBeGreaterThan(0); // sanity check the extraction itself works
    for (const status of contractStatuses) {
      expect(CONTRACT_STATUS_TO_DB_STATUS).toHaveProperty(status);
    }
  });

  it("defines no stale mappings the contract no longer has", () => {
    const contractStatuses = new Set(loadContractStatusValues());
    for (const mappedStatus of Object.keys(CONTRACT_STATUS_TO_DB_STATUS)) {
      expect(contractStatuses.has(mappedStatus)).toBe(true);
    }
  });

  it("maps every value to a distinct DB status (no two on-chain statuses collapse into one)", () => {
    const dbStatuses = Object.values(CONTRACT_STATUS_TO_DB_STATUS);
    expect(new Set(dbStatuses).size).toBe(dbStatuses.length);
  });
});
