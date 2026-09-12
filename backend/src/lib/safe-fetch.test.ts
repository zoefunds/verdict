import { describe, it, expect } from "vitest";
import { isPrivateOrReservedIp, extractVisibleText, truncateForHash, EVIDENCE_HASH_TRUNCATION_BYTES } from "./safe-fetch.js";

describe("isPrivateOrReservedIp", () => {
  it("blocks loopback", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
  });

  it("blocks cloud metadata / link-local", () => {
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIp("172.32.0.1")).toBe(false); // just outside the 172.16-31 range
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
  });

  it("blocks IPv6 unique-local and link-local ranges", () => {
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIp("fc00::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd12:3456::1")).toBe(true);
  });

  it("recurses through IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows legitimate public addresses", () => {
    expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false); // example.com-class public IP
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("2001:4860:4860::8888")).toBe(false); // public IPv6 (Google DNS)
  });

  it("conservatively rejects unparseable input", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
  });
});

describe("extractVisibleText", () => {
  it("strips tags and collapses whitespace", () => {
    const html = "<html><body><h1>Title</h1>  <p>Some   text.</p></body></html>";
    expect(extractVisibleText(html)).toBe("Title Some text.");
  });

  it("removes script/style/noscript content entirely, not just their tags", () => {
    const html = "<p>Before</p><script>alert('xss')</script><style>.x{color:red}</style><p>After</p>";
    const result = extractVisibleText(html);
    expect(result).not.toContain("alert");
    expect(result).not.toContain("color:red");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  it("decodes common HTML entities", () => {
    expect(extractVisibleText("Tom &amp; Jerry &lt;3 &quot;friends&quot;")).toBe('Tom & Jerry <3 "friends"');
  });

  it("decodes numeric and hex character references", () => {
    expect(extractVisibleText("&#65;&#x42;")).toBe("AB");
  });
});

describe("truncateForHash", () => {
  it("truncates to the canonical byte bound, not character count", () => {
    // Each "é" is 2 UTF-8 bytes — a naive character-count truncation would
    // diverge from a byte-count truncation for this exact input, which is
    // precisely the class of bug this function exists to prevent (see the
    // module-level canonicalization comment in safe-fetch.ts).
    const text = "é".repeat(EVIDENCE_HASH_TRUNCATION_BYTES); // 2x the byte bound in bytes
    const truncated = truncateForHash(text);
    expect(truncated.length).toBe(EVIDENCE_HASH_TRUNCATION_BYTES);
  });

  it("does not truncate content already under the bound", () => {
    const text = "short text";
    expect(truncateForHash(text).toString("utf8")).toBe(text);
  });

  it("is deterministic — identical input always produces identical output", () => {
    const text = "some evidence content ".repeat(100);
    expect(truncateForHash(text).equals(truncateForHash(text))).toBe(true);
  });
});
