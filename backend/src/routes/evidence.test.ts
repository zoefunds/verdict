import { describe, it, expect } from "vitest";
import { toContractKind } from "./evidence.js";

describe("toContractKind", () => {
  it("maps every DB evidenceType enum value to a contract-recognized kind", () => {
    expect(toContractKind("url")).toBe("URL");
    expect(toContractKind("transaction_record")).toBe("TX_RECORD");
    expect(toContractKind("document")).toBe("DOCUMENT_HASH");
    expect(toContractKind("image")).toBe("DOCUMENT_HASH");
    expect(toContractKind("text_statement")).toBe("TEXT_STATEMENT");
  });

  it("falls back to TEXT_STATEMENT for any unrecognized value, never throws", () => {
    expect(toContractKind("something_unexpected")).toBe("TEXT_STATEMENT");
  });
});
