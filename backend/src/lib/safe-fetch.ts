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
 *  - Resolve the hostname and reject if any resolved address is private,
 *    loopback, link-local, or otherwise non-public (blocks
 *    http://localhost, http://169.254.169.254 cloud-metadata endpoints,
 *    internal 10.x/172.16.x/192.168.x ranges, etc).
 *  - Bounded timeout and response size — never hang or exhaust memory on
 *    a hostile or oversized response.
 *  - Redirects are NOT followed automatically; each hop is re-validated,
 *    capped at a small number of hops, so a public URL can't redirect to
 *    an internal one to bypass the check.
 */

import { lookup } from "node:dns/promises";
import net from "node:net";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB — plenty for hashing purposes, never for full-page mirroring
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

async function assertPublicHost(hostname: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    const result = await lookup(hostname, { all: true });
    addresses = Array.isArray(result) ? result : [result];
  } catch {
    throw new UnsafeUrlError(`Could not resolve hostname: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Hostname resolved to no addresses: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new UnsafeUrlError(`URL resolves to a private/reserved address (${address}) — rejected`);
    }
  }
}

/**
 * Fetches a URL's body safely and returns it as text, following redirects
 * manually (re-validating each hop) up to MAX_REDIRECTS. Throws
 * UnsafeUrlError if the URL or any redirect target fails the SSRF checks.
 */
export async function safeFetchText(rawUrl: string): Promise<string> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new UnsafeUrlError(`Unsupported protocol: ${parsed.protocol}`);
    }
    await assertPublicHost(parsed.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": "VERDICT-evidence-hasher/1.0 (+https://ver-dict.vercel.app)" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new UnsafeUrlError("Redirect response had no Location header");
      currentUrl = new URL(location, currentUrl).toString();
      continue; // re-validate the new target on the next loop iteration
    }

    if (!res.ok) {
      throw new UnsafeUrlError(`URL returned HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return text.slice(0, MAX_RESPONSE_BYTES);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8").slice(0, MAX_RESPONSE_BYTES);
  }

  throw new UnsafeUrlError("Too many redirects");
}
