# VERDICT — Security Review

Status: **pre-deployment draft**. Must be revisited once the contract is
actually deployed to StudioNet and once real load/traffic patterns exist.
This is not a substitute for a professional audit before handling real
economic value beyond StudioNet testnet GEN.

## Authentication & session management

- Wallet-based auth only (SIWE-style nonce + `personal_sign`), no
  custodial private keys anywhere in the system (`backend/src/lib/auth.ts`).
- Nonces are single-use: consumed atomically before session issuance
  (`consumedAt` set in the same logical step as verification), preventing
  signature replay.
- Nonces expire after 5 minutes.
- Access tokens are short-lived JWTs (15 min default); refresh tokens live
  in an `httpOnly`, `sameSite=strict`, `secure`-in-production cookie scoped
  to `/auth` — never exposed to JS, reducing XSS blast radius.
- Auth endpoints (`/auth/nonce`, `/auth/verify`) are rate-limited tighter
  than the general API (10/min) to blunt nonce-spam and brute-force.

## Smart contract security (see contracts/verdict_contract.py)

- **Reentrancy / double-spend**: every payout path follows read-ledger ->
  zero-ledger -> persist -> `_send_gen` ordering. The transfer never
  happens before the ledger is zeroed and saved, and every payout function
  re-checks `amount <= 0` at the top so a second call after a zeroed
  balance fails cleanly (`gl.vm.UserError`) instead of double-paying.
- **Single emission chokepoint**: all GEN leaves the contract through one
  `_send_gen` function — the entire fund-movement surface can be audited by
  grepping one symbol.
- **Consensus / undetermined-status risk**: verdict evaluation uses
  `gl.vm.run_nondet_unsafe` with a custom tolerance-band comparator
  (`_verdicts_agree`), not exact-string equality, so ordinary LLM phrasing
  variance doesn't cause spurious leader rotation. Error classification
  prefixes (`[EXPECTED]`/`[EXTERNAL]`/`[TRANSIENT]`/`[LLM_ERROR]`) let
  validators agree on failure *classes* instead of exact text.
- **Prompt injection**: participant-submitted evidence text is always
  wrapped and explicitly labeled as untrusted data inside LLM prompts, never
  concatenated as instructions. Web-fetched evidence content is truncated
  (`MAX_EVIDENCE_FETCH_CHARS`) and likewise labeled untrusted.
- **Abandonment / griefing**: every escrow path has a timeout-based recovery
  exit (`claim_case_abandonment`) so funds can never be permanently stuck if
  a counterparty disappears at any stage.
- **Access control**: owner-only admin functions (`_only_owner`) are
  explicitly separated from participant actions and public views; case
  actions verify caller is a registered party (`_is_party`) before allowing
  evidence submission or fund-related calls.

## Evidence integrity

- All evidence is SHA-256 content-hashed at submission time
  (`backend/src/routes/evidence.ts`), and that hash is what gets committed
  on-chain. URL evidence is independently re-fetched by the contract at
  verdict time (`_fetch_evidence_independently`) — a hash mismatch is a
  tamper signal surfaced to the verdict reasoning, not silently accepted.
- Evidence provenance is tracked explicitly (`participant_submitted` vs
  `contract_verified` — `evidence_provenance` enum) so the UI never implies
  a claim has been independently verified when it hasn't.
- File uploads are validated by MIME allowlist and size cap
  (`EVIDENCE_MAX_FILE_SIZE_MB`), stored under randomized filenames (never
  the user-supplied name) to prevent path traversal.

## Application security

- **SSRF**: **updated 2026-08-25** — this used to say the Fastify backend
  never makes outbound requests to user-supplied URLs at all. That's no
  longer true: fixing the evidence content-hash commitment (see "External
  audit findings" below) requires the backend to actually fetch submitted
  URLs server-side to hash real content. This is now mitigated instead of
  avoided — see `backend/src/lib/safe-fetch.ts` and the audit-findings
  section below for the guard (private-IP/localhost/cloud-metadata
  blocking, redirect re-validation, timeout, size cap). The contract's own
  independent nondet web-fetch (inside GenVM) remains separate and
  unchanged — it's what the verdict LLM actually evaluates against, not
  this hashing fetch.
- **Input validation**: all route bodies are parsed through `zod` schemas
  with explicit length caps before touching the database.
- **SQL injection**: not applicable in the traditional sense — all queries
  go through Drizzle ORM's parameterized query builder, no raw string
  interpolation into SQL anywhere in the codebase.
- **Rate limiting**: global 100 req/min via `@fastify/rate-limit`, tighter
  on auth endpoints.
- **CORS**: locked to `CORS_ORIGIN` (the deployed frontend origin), not
  wildcard.
- **Secrets**: never committed; `.env.example` ships only placeholder
  values (verified before every commit); production secrets are set via
  `flyctl secrets set` / Vercel's environment variable UI, never in
  `fly.toml` or repo files.

## External audit findings (2026-08-25) and fixes applied

An external review of the deployed contract, backend, and frontend found
six real issues. All six were fixed in `contracts/verdict_contract.py` /
`backend/src/routes/evidence.ts` / `frontend/lib/genlayer.ts` and required
a **new contract deployment** (submit_evidence's signature changed — see
`docs/GENLAYER.md` "Current status" for the superseded old address).

1. **Verdict parsing silently accepted malformed LLM output as a valid
   INCONCLUSIVE result** instead of forcing validator disagreement/
   rotation. `_coerce_outcome` now raises `gl.vm.UserError(ERR_LLM + ...)`
   on any unmappable output — which the existing `_handle_leader_error`/
   `_verdicts_agree` error-classification scheme already treats as a
   forced-disagreement class, so this was a targeted fix to one function,
   not new machinery. INCONCLUSIVE remains a legitimate explicit outcome
   the LLM can choose; what changed is that garbage no longer silently
   becomes it.
2. **Consensus tolerance was too wide for monetary settlement** — validators
   could disagree by up to 1500 bps (15% of the pot) on a PARTIAL split and
   still "agree". Added `SETTLEMENT_BANDS_BPS`, a fixed set of discrete
   payout bands (10%/25%/40%/50%/60%/75%/90%) that every PARTIAL split is
   snapped to before comparison, so independent LLM calls landing close
   together collapse onto the identical value rather than merely falling
   in a wide window. The raw tolerance backstop was also tightened
   1500 -> 500 bps.
3. **Unbounded nondeterministic input surface** — up to 40 URLs x 5000
   chars could enter one prompt, with every validator independently
   rendering mutable live pages (a consensus/liveness hazard). Tightened
   to 15 evidence items x 1200 chars, and restructured the prompt into
   explicit, bounded "witness record" blocks (source, retrieval status,
   content-hash-match status) instead of an unstructured dump. A full
   two-stage extraction pipeline (separate compact-summary LLM call per
   source before the verdict call) was considered and NOT implemented —
   it doubles nondet LLM calls, a real cost/latency/consensus-surface
   trade-off that deserves its own explicit decision, documented as a
   follow-up rather than silently half-done.
4. **Evidence fetch outcome was recorded as a blanket success** —
   `_mark_evidence_independently_fetched` set `fetch_succeeded = True` for
   every URL after any verdict, regardless of whether that item's fetch
   actually succeeded, misrepresenting provenance. Now threads the
   leader's real per-item fetch/hash result through
   `_run_verdict_judgment`'s returned dict and records it faithfully
   (including a new `content_hash_matched` field).
5. **URL evidence's "on-chain content-hash commitment" was not real** —
   the backend hashed the URL STRING, the contract had no hash field at
   all, and the frontend never sent one. A tampered page and an untampered
   page at the same URL produced the identical "commitment". Fixed
   end-to-end: `submit_evidence` gained a required `content_hash`
   parameter (64-char hex sha256, format-checked on-chain); the backend
   now actually fetches the URL server-side (`lib/safe-fetch.ts`, SSRF-
   guarded — see below) and hashes the real response body; the frontend
   sends that real hash on every submission. The contract's verdict-time
   independent re-fetch now compares its own hash against the committed
   one and surfaces a match/mismatch signal to the LLM explicitly (not an
   automatic tamper verdict, since a live page is allowed to legitimately
   change).
6. **Deployment/documentation contradictions and split SDK versions** —
   `docs/GENLAYER.md` said "not yet deployed" while a real address was
   live and in active use elsewhere; `genlayer-js` had drifted to
   different major versions between frontend (`0.16.0`) and backend
   (`1.1.8`) with no record either was actually verified. Fixed the docs
   contradiction; pinned both to their exact already-proven-working
   version rather than guessing a unified version works for both (see
   `docs/GENLAYER.md` "SDK version note" for the reasoning).

**New SSRF surface introduced by fix #5, and its mitigation:** hashing
real URL content server-side means the backend now makes outbound HTTP
requests to user-submitted URLs for the first time (previously this was
avoided entirely — see the updated SSRF bullet above).
`backend/src/lib/safe-fetch.ts` mitigates this: http(s)-only, resolves the
hostname and rejects any private/loopback/link-local/reserved address
(blocks `localhost`, cloud metadata endpoints like `169.254.169.254`,
internal `10.x`/`172.16.x`/`192.168.x` ranges), each redirect hop is
re-validated against the same checks (capped at 3 hops, so a public URL
can't redirect to an internal one to bypass the check), and both a
timeout (8s) and response-size cap (2MB) are enforced. Verified against a
real public URL, `localhost`, and a cloud-metadata address before merging.

## Second external audit round (re-audit, 2026-08-25) and fixes applied

Score at re-audit: 3,300/4,000. Five findings, all addressed:

1. **Hash truncation mismatch, and render-vs-raw content mismatch** — two
   separate problems raised in the re-audit:
   - Backend truncated by up to 2MB of raw bytes while the contract
     truncated its fresh fetch to 1,200 *characters* before UTF-8
     encoding — for non-ASCII content those splits at different points,
     so even byte-identical pages could hash differently. Fixed: both
     sides now truncate the same canonical **1,200-byte UTF-8 buffer**
     before hashing (`EVIDENCE_HASH_TRUNCATION_BYTES` in `safe-fetch.ts`,
     `EVIDENCE_CONTENT_BYTES` in `verdict_contract.py` — the two constants
     must stay numerically equal).
   - Separately, the backend hashed the **raw HTTP response body**
     (markup, scripts, styles and all) while the contract's fresh fetch
     goes through `gl.nondet.web.render(url, mode="text")` — a
     rendered-text view. Fixed: `safe-fetch.ts` now reduces HTML responses
     to visible text (`extractVisibleText` — strips `<script>`/`<style>`/
     `<noscript>` blocks, strips remaining tags, decodes entities,
     collapses whitespace) before hashing, closer to what the renderer
     produces. **This is a documented residual limitation, not a claim of
     full parity** — a hand-rolled tag-stripper and GenVM's actual
     renderer are not provably byte-identical for JS-driven content or
     unusual markup, and GenVM exposes no raw-bytes fetch primitive inside
     nondet blocks to fetch through instead. This is why the contract has
     always treated (and continues to treat) a hash mismatch as a signal
     for the verdict LLM to weigh, never automatic proof of tampering —
     see the matching docstrings in both `safe-fetch.ts` and
     `_fetch_evidence_independently` in `verdict_contract.py`.
   - **Mid-fix regression caught and re-applied**: between the first and
     second audit rounds, an external process (GenLayer Studio's own file
     sync, observed stripping this file's changes more than once during
     development) silently reverted the byte-truncation fix in
     `verdict_contract.py` back to character-truncation — meaning the fix
     described in round 1 was never actually live in the version the
     re-audit reviewed. Re-applied and this time verified with the
     deterministic test suite (19/19 passing) immediately after editing,
     not assumed from a prior commit.
2. **SSRF guard vulnerable to DNS rebinding** — the original guard called
   `dns.lookup()` to validate a hostname, then called `fetch()` separately,
   which re-resolves DNS independently; a hostile DNS server could answer
   the validation lookup with a public IP and the connection lookup with a
   private one (classic TOCTOU). Fixed by rebuilding `safe-fetch.ts` on
   Node's plain `http`/`https` `lookup` request option, so the same
   function that resolves the hostname is the function that connects to
   it. Two non-obvious runtime bugs were found and fixed while getting this
   working (both reproduced with a real `https.request` against
   `example.com`, not assumed from docs):
   - Node's http(s) client invokes the `lookup` option internally with
     `{ all: true }` and expects an *array* of `{address, family}` results
     back in that case, not a single `(address, family)` pair — passing
     the single-pair shape unconditionally threw
     `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined` for every
     request, including legitimate public URLs. `pinnedLookup` now
     branches on `options.all`.
   - When a URL's hostname is already a literal IP address, Node's
     http(s) client skips the custom `lookup` option entirely (no
     resolution needed) and connects directly — so `http://169.254.169.254/`
     silently bypassed the whole guard. `fetchOnce` now runs the same
     private/reserved-IP check directly against literal-IP hostnames
     before ever calling `mod.request`.
   Verified against `https://example.com` (succeeds), `127.0.0.1`, IPv6
   `::1`/localhost, and `169.254.169.254` — all four reproduced with a real
   Node process, not mocked.
3. **Self-asserted on-chain evidence linkage** — `PATCH
   /evidence/:id/link-contract` previously trusted whatever
   `contractEvidenceId` the client sent, with no verification against the
   contract; any authenticated submitter could link any id (their own
   unrelated evidence, another case's evidence, or a non-existent id) and
   the UI would show a misleading "on-chain" status. Fixed: the route now
   reads the claimed id back from the contract via `get_evidence` and
   cross-checks case id, submitter wallet address, evidence kind, and
   content hash all match the DB row before persisting the link; a
   mismatch returns 422 with the specific field(s) that failed.
4. **SDK compatibility unproven** — backend pins `genlayer-js` at `1.1.8`,
   frontend at `0.16.0`; this is a deliberate split (see
   `docs/GENLAYER.md` "SDK version note"), each pinned to the exact version
   already proven working in that specific role, rather than one version
   untested in both. No further mechanical fix applies here without live
   dual-role wallet testing.
5. **No real GenVM validation** — the 19/19 passing unit tests
   (`tests/contract/`) run against a stub `genlayer` module, not real
   GenVM. Two real avenues were investigated for closing this, both
   partially blocked on things outside this environment:
   - **StudioNet CLI checks (done)**: the locally installed `genlayer` CLI
     (v0.39.2) was used to run `genlayer schema <address>` and
     `genlayer call <address> get_protocol_config` against the live
     deployed contract, confirming it loads correctly on StudioNet and
     that `submit_evidence`'s parameter list exactly matches
     `[case_id, kind, url, description, tx_reference, content_hash]`.
     This CLI version has no `genvm-lint`/test subcommand (checked
     `genlayer --help`: only
     `deploy/call/write/schema/code/receipt/trace/appeal/...` exist).
   - **Local multi-validator GenVM simulator (attempted, blocked)**: the
     CLI has a `genlayer up` / `genlayer init` localnet mode that runs a
     real multi-validator GenVM consensus network in Docker — this would
     let contract writes, nondet consensus, and evidence fetch/verdict
     logic run against the actual GenVM runtime rather than a stub,
     without needing a funded StudioNet wallet. Docker was confirmed
     available and `genlayer init --numValidators 3` was run; it reached
     an interactive provider-selection step requiring a real LLM provider
     API key (OpenAI, Heurist, Gemini, or XAI — for the validators'
     `gl.nondet.exec_prompt` calls) before it can start. No such key
     exists anywhere in this project's environment or `.env` files, and
     one was not fabricated or requested to force this through. **This
     remains an open gap**: a real local GenVM validator-consensus test
     run is one funded LLM provider key away, not blocked by tooling.

## Known gaps / follow-up before real-value production use

- [ ] Real local GenVM validator-consensus test run via `genlayer up`
      localnet mode — tooling and Docker are confirmed working, blocked
      only on an LLM provider API key (OpenAI/Heurist/Gemini/XAI) for the
      validators' `gl.nondet.exec_prompt` calls, which does not exist in
      this environment. Supplying one key unblocks this; it does not need
      a funded StudioNet wallet, only a provider key.
- [ ] `genvm-lint`-equivalent / direct validator tests with divergent
      fetch/LLM mocks, and at least one recorded StudioNet end-to-end
      write transaction in CI (needs a funded CI wallet — not available in
      this environment).
- [ ] Formal external audit of `contracts/verdict_contract.py` before any
      non-testnet deployment.
- [ ] Automated dependency vulnerability scanning (`npm audit` / Dependabot)
      wired into CI once CI is set up.
- [ ] Structured centralized logging/monitoring on the Fly.io backend
      (currently `pino` structured logs only, no alerting pipeline yet).
- [ ] Load testing of the polling indexer against a case volume beyond
      trivial (current design polls all case IDs sequentially each cycle —
      fine at MVP scale, will need pagination/backoff at scale).
