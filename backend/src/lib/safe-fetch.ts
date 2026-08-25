/**
 * SSRF-guarded fetch, used ONLY to compute a content hash of URL evidence
 * at submission time (audit finding, external review 2026-08-25: the API
 * previously hashed the URL STRING, not fetched content, making the
 * on-chain "content-hash commitment" claim false — see
 * routes/evidence.ts). This is deliberately NOT used to evaluate evidence
 * truthfulness — that remains exclusively the contract's own independent
 * nondet web-fetch at verdict time, run by every validator. This function
 * exists solely so the hash committed on-chain at submission actually
 * corresponds to real content a human could later re-verify against.
 *
 * SSRF mitigations:
 *  - http(s) only.
 *  - DNS-rebinding-safe address validation (AUDIT FIX, re-audit
 *    2026-08-25): the original version called `dns.lookup()` to validate
 *    the hostname, then called plain `fetch()` separately — which performs
 *    its OWN independent DNS resolution moments later. A hostile DNS
 *    server could answer the validation lookup with a public address and
 *    the connection lookup with a private one (classic DNS rebinding /
 *    TOCTOU). Fixed with Node's plain `http`/`https` modules' `lookup`
 *    request option — the SAME function that resolves the hostname is the
 *    function that connects to it, closing the window between check and
 *    use. Two non-obvious pitfalls surfaced and were fixed while building
 *    this (both reproduced with a real https.request against example.com,
 *    not assumed):
 *      1. Node's http(s) client invokes `lookup` internally with
 *         `{ all: true }` and expects the callback to return an ARRAY of
 *         `{address, family}` results in that case, not a single
 *         `(address, family)` pair — passing the single-pair shape
 *         unconditionally throws `ERR_INVALID_IP_ADDRESS: Invalid IP
 *         address: undefined` deep in Node's internals, for every request,
 *         including legitimate public URLs. `pinnedLookup` now branches on
 *         `options.all`.
 *      2. When the URL's hostname is already a literal IP address, Node's
 *         http(s) client skips the custom `lookup` option ENTIRELY (no
 *         resolution needed) and connects directly — so a URL like
 *         `http://169.254.169.254/` silently bypassed this whole check.
 *         `fetchOnce` now runs `isPrivateOrReservedIp` directly against
 *         literal-IP hostnames before ever calling `mod.request`.
 *  - Bounded timeout and response size — never hang or exhaust memory on
 *    a hostile or oversized response.
 *  - Redirects are followed manually (not by the HTTP client), each hop
 *    re-validated through the same pinned lookup, capped at a small
 *    number of hops, so a public URL can't redirect to an internal one to
 *    bypass the check.
 */

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB fetch budget — plenty of headroom for hashing, never for full-page mirroring
// Canonical BYTE truncation applied to the content actually hashed.
// AUDIT FIX (re-audit, 2026-08-25): this MUST stay numerically equal to
// EVIDENCE_CONTENT_BYTES in contracts/verdict_contract.py — the original
// mismatch (backend hashed up to 2MB, contract hashed only its first 1200
// CHARS) meant any normal-sized page reported a false hash mismatch. Both
// sides now truncate to the same byte count before hashing.
export const EVIDENCE_HASH_TRUNCATION_BYTES = 1200;
const MAX_REDIRECTS = 3;

export class UnsafeUrlError extends Error {}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true;
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped — recheck as v4
      return isPrivateOrReservedIp(lower.replace("::ffff:", ""));
    }
    return false;
  }
  return true; // unknown/unparseable — reject conservatively
}

/**
 * Node's documented `lookup` request-option signature
 * (https://nodejs.org/api/http.html#httprequestoptions-callback) — this
 * exact function is what http(s).request uses to resolve AND connect,
 * closing the DNS-rebinding gap: there is no separate pre-check step.
 */
function pinnedLookup(
  hostname: string,
  options: dns.LookupAllOptions | dns.LookupOneOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
): void {
  const wantsAll = (options as dns.LookupAllOptions).all === true;
  dns.lookup(hostname, {}, (err, address, family) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    if (isPrivateOrReservedIp(address)) {
      const unsafeErr = new Error(
        `URL resolves to a private/reserved address (${address}) — rejected`,
      ) as NodeJS.ErrnoException;
      unsafeErr.code = "EUNSAFEHOST";
      callback(unsafeErr, "", 0);
      return;
    }
    // Node's http(s).request calls its `lookup` option with
    // `{ all: true }` internally and expects the array-of-results shape
    // back in that case — passing a single (address, family) pair here
    // (the `dns.lookup`-with-no-options shape) makes Node's internal
    // `emitLookup` throw `ERR_INVALID_IP_ADDRESS: Invalid IP address:
    // undefined`, since it tries to read `results[0].address` off a
    // string. Must match whichever shape the caller asked for.
    if (wantsAll) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  });
}

function fetchOnce(url: string): Promise<{ status: number; location: string | null; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      reject(new UnsafeUrlError(`Unsupported protocol: ${parsed.protocol}`));
      return;
    }
    const mod = parsed.protocol === "https:" ? https : http;

    // Node's http(s) client skips the custom `lookup` option entirely
    // when the hostname is already a literal IP address (no resolution
    // needed) — so a URL like http://169.254.169.254/ would bypass
    // pinnedLookup completely and connect directly. Must check literal
    // IP hostnames explicitly before handing off to mod.request.
    if (net.isIP(parsed.hostname) && isPrivateOrReservedIp(parsed.hostname)) {
      reject(new UnsafeUrlError(`URL resolves to a private/reserved address (${parsed.hostname}) — rejected`));
      return;
    }

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        timeout: FETCH_TIMEOUT_MS,
        lookup: pinnedLookup,
        headers: { "user-agent": "VERDICT-evidence-hasher/1.0 (+https://ver-dict.vercel.app)" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            location: (res.headers.location as string | undefined) ?? null,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      },
    );

    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EUNSAFEHOST") {
        reject(new UnsafeUrlError(err.message));
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

/**
 * Fetches a URL's body safely and returns it as text, following redirects
 * manually (re-validating each hop through the same pinned lookup) up to
 * MAX_REDIRECTS. Throws UnsafeUrlError if the URL or any redirect target
 * fails the SSRF checks.
 */
export async function safeFetchText(rawUrl: string): Promise<string> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { status, location, body } = await fetchOnce(currentUrl);

    if (status >= 300 && status < 400) {
      if (!location) throw new UnsafeUrlError("Redirect response had no Location header");
      currentUrl = new URL(location, currentUrl).toString();
      continue; // re-validated on the next loop iteration, through the same pinned lookup
    }

    if (status < 200 || status >= 300) {
      throw new UnsafeUrlError(`URL returned HTTP ${status}`);
    }

    return body.toString("utf8").slice(0, MAX_RESPONSE_BYTES);
  }

  throw new UnsafeUrlError("Too many redirects");
}

/**
 * Truncates fetched text to the canonical byte bound (see
 * EVIDENCE_HASH_TRUNCATION_BYTES) BEFORE hashing — callers must use this,
 * never hash the full fetched text, so the resulting hash matches what
 * the contract computes from its own fresh fetch at verdict time.
 */
export function truncateForHash(text: string): Buffer {
  return Buffer.from(text, "utf8").subarray(0, EVIDENCE_HASH_TRUNCATION_BYTES);
}
