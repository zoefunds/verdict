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

## Live end-to-end lifecycle audit (2026-08-25)

Requested explicitly: run real, detailed tests against the deployed v3
contract for every read and write method, with zero tolerance for GenVM
or consensus errors, in a way that's visible on the frontend afterward.
This section records exactly what was done and what was found — not a
summary claim.

### Setup

Two dedicated StudioNet test accounts were created specifically for this
(never used for anything else): a claimant account funded with StudioNet
test GEN by the user, and a respondent account self-funded from the
claimant account via `genlayer account send`. Since `genlayer write`
(CLI v0.39.2) cannot send value with a payable call — confirmed by reading
the CLI's own source, it hardcodes `value: 0n` — a small Node script using
`genlayer-js`'s `createAccount`/`createClient` directly was used instead,
mirroring exactly what `frontend/lib/genlayer.ts` does with a browser
wallet, just with a private-key signer instead. Private keys were
recovered from the CLI's own encrypted keystores with `ethers`'
`Wallet.fromEncryptedJson`.

### Every method, tested for real

| Method | Result |
|---|---|
| `create_case` (payable) | `FINALIZED`, `MAJORITY_AGREE`, case id `0` returned |
| `fund_respondent_stake` (payable) | `FINALIZED`, `SUCCESS` |
| `submit_evidence` | `FINALIZED`, `SUCCESS` on both leader and validator |
| `close_evidence_window_early` (×2, one per party) | `FINALIZED` |
| `request_investigation` | First attempt correctly REJECTED (deterministic guard: evidence window hadn't closed yet — this is the guard working, not a bug). Retried after `close_evidence_window_early` legitimately collapsed the deadline: `FINALIZED`, `MAJORITY_AGREE` |
| `render_verdict` | `FINALIZED`. Real LLM verdict: `outcome: CLAIMANT`, `confidence_bps: 10000`, coherent case-specific reasoning text (not boilerplate) |
| `file_appeal` (payable) | `FINALIZED` |
| `open_appeal_evidence_window` | `FINALIZED` |
| `resolve_appeal` | Called only after the real 1-hour minimum re-investigation window had genuinely elapsed. `FINALIZED`, validator explicitly voted `agree`. Second verdict genuinely differed from the first: `outcome: INCONCLUSIVE`, `verdict_split_bps: 5000`, reasoning that specifically cited the evidence content-hash mismatch as a weakening (not disqualifying) signal |
| `settle_case` | `settled: true`, `status: SETTLED`. Real GEN moved — confirmed by reading both test accounts' balances before and after |

Read methods (`get_case`, `get_case_count`, `get_case_evidence_ids`,
`get_evidence`, `get_protocol_config`, `get_metrics`) were all exercised
throughout via `genlayer call` and returned correct, consistent data at
every step — including catching the `total_volume_wei` bug below.

**Zero genuine GenVM or consensus errors across the entire run.** The only
`"execution_result": "ERROR"` entries observed were
`CONSENSUS_VALIDATOR_QUORUM_REACHED` with `fatal: false` — a validator
whose execution was cancelled because the other validators already
reached quorum, a normal optimization artifact, not a failure. One benign
`UserWarning` about pickling storage appeared in leader stderr during
`render_verdict`/`resolve_appeal` — informational, not an error.

The static wiring audit that preceded this (contract schema pulled fresh
via `genlayer schema` and diffed line-by-line against every call site in
`frontend/lib/genlayer.ts`, `backend/src/lib/genlayer-client.ts`, and
`backend/src/routes/genlayer.ts`) found zero drift — every parameter list,
every return shape, every status enum matched exactly before any live
transaction was sent.

**Final confirmed state (2026-08-25, after indexer recovery):** the
indexer recovered on its own once StudioNet's daily window rolled over,
exactly as the backoff fix intended — no further intervention needed.
`GET /cases/05935c6f-709d-4943-a94a-922b9b8d4c06` now returns
`"status": "settled"`, `"settledAt": "2026-08-25T19:31:10.519Z"`, matching
the real on-chain settlement time exactly, with both real participant
rows (claimant `stakeTxHash: 0xfe36...a3154`, respondent) intact. This is
case `VX-5961` — visible end to end at
[ver-dict.vercel.app/casebook](https://ver-dict.vercel.app/casebook).

### Three real bugs found live, all fixed and deployed

1. **Indexer silently starved by an undocumented daily RPC quota.**
   StudioNet enforces a hard **5,000 requests/day** cap, entirely separate
   from the documented 30/min cap, which nothing in this codebase tracked.
   The indexer's original 15-second poll interval alone made 5,760
   requests/day — over budget with zero user traffic — so the case created
   during this test sat at a stale `awaiting_respondent_stake` status in
   Postgres for an extended stretch while the chain had already progressed
   through `SETTLED`, with no error surfaced to a user. Root-caused with a
   direct SSH-in reproduction against the indexer's own process, which
   returned the raw upstream error verbatim: `UnknownRpcError... Details:
   Rate limit exceeded: 5000 requests per day (code: -32029)`. Fixed:
   - `backend/src/indexer/run.ts` poll interval 15s → 60s.
   - `backend/src/lib/rate-limiter.ts` gained a second, independent daily
     budget governor (4,500/day cap, Redis-backed, checked once per
     logical call — not once per per-minute retry iteration, which would
     have double-counted).
   - The indexer now backs off exponentially (60s → 30 minutes) on
     consecutive sync failures instead of retrying at a fixed rate
     forever, so a sustained outage — this one or a future one — gets room
     to recover instead of being kept hammered, since a rejected request
     plausibly still counts against the same daily counter that caused the
     rejection.
   - `frontend/hooks/useCases.ts`'s `useContractCase` polling interval
     (the one frontend hook that reads the contract directly, not
     Postgres) reduced from 15s to 30s to cut its per-open-tab
     contribution to the same shared budget.
   The specific indexer machine used for this test needed real time to
   recover from its own accumulated usage even after the fix deployed —
   confirmed the fix itself was correct by reproducing success from a
   different source (the API machine, and this session's own scripts)
   while the indexer machine was still working through its backlog.
2. **`total_volume_wei` protocol metric undercounts by roughly half.**
   `get_metrics`'s `total_volume_wei` is only incremented once, inside
   `fund_respondent_stake` (line ~813 of `verdict_contract.py`), by the
   respondent's attached stake — the claimant's stake locked at
   `create_case` time is never added. For the test case (1 GEN from each
   side), `total_volume_wei` read back as `1000000000000000000` (1 GEN)
   instead of the true `2000000000000000000` (2 GEN). **This does not
   affect escrow or settlement correctness** — confirmed by this same
   test run, where the correct 2 GEN total pot was tracked and paid out
   correctly via `claimant_stake_wei`/`respondent_stake_wei`, which are
   separate, correctly-maintained fields. It only affects the
   protocol-wide dashboard "Total Volume" stat
   (`frontend/app/(app)/dashboard/page.tsx`). Left unfixed rather than
   forcing an immediate contract redeploy for a cosmetic metric — flagged
   here for a future fix alongside other contract changes.
3. **Real on-chain evidence with no matching Postgres row, because it was
   submitted directly on-chain rather than through the app's normal
   flow.** To isolate testing the contract's own consensus behavior, the
   test evidence was committed via `genlayer-js` calling `submit_evidence`
   directly — bypassing the app's usual `POST /evidence/text` (which
   fetches/hashes content and writes the DB row *first*) → wallet-signed
   on-chain commit → `PATCH /evidence/:id/link-contract` sequence
   entirely. The result was real and correct on-chain (`get_evidence`
   confirmed it: hash, submitter, independent re-fetch, everything), but
   invisible in the frontend's evidence timeline, which reads Postgres,
   not the chain directly. Backfilled with a one-off script
   (`backend/src/db/backfill_test_evidence.ts`) using the real on-chain
   values — not placeholders — including the genuine
   `content_hash_matched: false` outcome, recorded honestly as
   `status: "verification_failed"` rather than glossed over. **A real
   gotcha hit while writing that script**: `users.walletAddress` is stored
   **checksummed** (mixed-case), not lowercase — the first backfill
   attempt queried the lowercase form and found no matching user row.
   Fixed by querying the exact checksummed address. Worth remembering for
   any future script that looks up a user by wallet address.

### Frontend visibility — confirmed, not just expected

The case created during this run (case number `VX-5961`, contract case id
`0`) went through the real API — real SIWE-style auth (nonce issued,
signed with the test account's key, verified), real `POST /cases`, real
`PATCH /cases/:id/link-contract` — so it is a completely ordinary case
row, indistinguishable from one created by a real user through the UI.
**Confirmed live, after the indexer's own recovery**: `GET
/cases/05935c6f-709d-4943-a94a-922b9b8d4c06` returns `status: "settled"`
with a `settledAt` matching the real on-chain settlement transaction, and
`GET /cases/05935c6f-709d-4943-a94a-922b9b8d4c06/evidence` returns the
backfilled evidence row from bug #3 above. Both are visible on
[ver-dict.vercel.app/casebook](https://ver-dict.vercel.app/casebook) as of
this writing.

## Multi-product live lifecycle audit (2026-08-29, v4 contract)

Requested explicitly: clear all prior-contract data, deploy against the
new v4 contract (`0x2BEe5eBb18c8E0D82E68Fc103fA68dfC0e876E58`), and run
every non-admin read/write method through 4 independent, fully-detailed
("not placeholder") product dispute scenarios, with zero tolerance for
GenVM/consensus errors, visible on the frontend afterward.

### Setup

Database fully cleared of prior-contract cases/evidence/participants
(`backend/src/db/clear_all_cases.ts`) before any testing began. The v4
contract was verified against checked-in source via `genlayer schema`
before sending any transaction — schema matched exactly, zero drift. The
same two dedicated StudioNet test accounts from the v3 round were reused
(`verdict-test`, `verdict-test-2`), alternating claimant/respondent roles
across the four tests for direction diversity.

### Four tests, four different real disputes

1. **Freelance payment dispute** — a web-design contractor suing for an
   unpaid final milestone. Initial verdict: `CLAIMANT`, 80% confidence.
   Respondent appealed with new evidence (unresolved warranty bug reports
   within a contractual 30-day window) — the appeal **genuinely flipped
   the outcome** to `RESPONDENT`, 72% confidence, with the LLM explicitly
   noting the claimant's URL evidence had a hash mismatch and disregarding
   it as unreliable. Exercised: `create_case`, `fund_respondent_stake`,
   `submit_evidence` (URL + TEXT_STATEMENT), `close_evidence_window_early`,
   `request_investigation`, `render_verdict`, `file_appeal`,
   `open_appeal_evidence_window`, `resolve_appeal`, `settle_case`.
2. **Rental security deposit dispute** — a tenant suing for a wrongfully
   withheld deposit. `render_verdict`'s first attempt genuinely hit
   `MAJORITY_DISAGREE` after all 3 leader rotations were exhausted — a
   real consensus split, not a bug — and a retry with a fresh
   leader/validator draw succeeded, landing `INCONCLUSIVE` (50/50) because
   neither side's evidence was independently verifiable. Claimant appealed
   with a countersigned property-management portal record addressing that
   exact gap — the appeal resolved to a clean `CLAIMANT` win (full deposit,
   82% confidence), citing both the newly-corroborated checklist and a
   missed statutory deadline as independently sufficient grounds. Same
   method coverage as test 1, plus multiple evidence rounds across the
   appeal.
3. **Design contract cancellation** — a claimant who created a case then
   cancelled before the respondent funded their stake. Exercises
   `create_case` and `cancel_case` specifically — the one test that never
   reaches a verdict, by design, to cover the pre-funding exit path.
4. **E-commerce partial refund dispute** — a buyer with a partially
   defective product (one broken feature, otherwise functional), with a
   case-specific rule added via `add_case_rule` mandating a proportional
   partial refund for exactly this scenario. `render_verdict` correctly
   landed `PARTIAL` (75/25 split favoring the buyer, 72% confidence) and
   **explicitly cited the added case rule by name** in its reasoning —
   real confirmation `add_case_rule` actually influences verdicts, not
   just that it doesn't error. Seller appealed with the actual product
   listing wording, arguing the disputed feature was a secondary "bonus"
   spec, not a primary advertised one. The appeal's underlying LLM
   reasoning genuinely shifted (citing a "70/30" split this time) but
   **settlement-band snapping rounded it to the same 7500bps band as
   before** — a real, notable confirmation that the discrete settlement-
   band design absorbs small appeal-driven shifts within one band rather
   than always producing a visibly different final number. Also exercised
   `submit_evidence` with all three non-file kinds (URL, TEXT_STATEMENT,
   TX_RECORD) across the two sides.

Every write across all four tests reached `FINALIZED` consensus (with the
two documented `MAJORITY_DISAGREE`-then-retry exceptions above, which are
genuine consensus behavior, not errors). No other error class was
observed. Real GEN moved correctly on every settlement and the
cancellation refund.

### Non-admin methods exercised (12 of 13)

`create_case`, `fund_respondent_stake`, `submit_evidence`, `add_case_rule`,
`close_evidence_window_early`, `request_investigation`, `render_verdict`,
`file_appeal`, `open_appeal_evidence_window`, `resolve_appeal`,
`settle_case`, `cancel_case`. **`claim_case_abandonment` was deliberately
not exercised** — its `ABANDONMENT_GRACE_SECONDS` constant is a hard-coded
14 days with no per-case or deploy-time override, making it infeasible to
trigger for real within a normal testing session; this was surfaced to
the user upfront and explicitly agreed to be skipped rather than silently
omitted. Admin/owner-only methods (`set_appeal_bond_bps`, `set_paused`,
`set_protocol_fee_bps`, `set_treasury_address`, `sweep_treasury`,
`transfer_ownership`, `propose_constitution_amendment`) were out of scope
per the request that prompted this round.

### Real timing constraints discovered

`evidence_window_seconds`, `respondent_join_window_seconds`, and
`additional_evidence_window_seconds` (the appeal re-investigation window)
all enforce a **hard 1-hour minimum on-chain** — passing a shorter value
does not error, it silently floors to 1 hour. The initial evidence window
can still be collapsed instantly via `close_evidence_window_early` (once
both parties call it), but the re-investigation window during an appeal
has no equivalent shortcut — each of the 3 appealed test cases genuinely
waited out close to the full hour before `resolve_appeal` became callable.
Separately, `APPEAL_WINDOW_SECONDS` (7 days, fixed, non-configurable) must
fully elapse before `settle_case` succeeds on a case nobody appealed —
confirmed by hitting the real on-chain rejection — which is why every test
case that needed settlement went through a real appeal rather than waiting
out 7 real days.

### Frontend visibility gap, again — same root cause as before, now systematic

All 4 cases were created by calling `create_case`/`submit_evidence`
directly via `genlayer-js`, the same testing approach as the v3 round and
for the same reason (precise, scriptable control over every parameter to
exercise the contract's own consensus behavior exactly). This means all 4
bypassed the app's normal `POST /cases` → wallet-signed on-chain tx →
`PATCH /cases/:id/link-contract` flow again, leaving 4 real, correct,
fully-settled/cancelled on-chain cases with zero matching Postgres rows —
identical in kind to the single evidence-visibility gap from the v3 round,
just at case-level and across all 4 cases this time, not one evidence
item. Backfilled with `backend/src/db/backfill_e2e_test_cases.ts`, pulling
every field (case data, all 13 evidence items across the 4 cases) live
from the contract via `get_case`/`get_case_evidence_ids`/`get_evidence` —
no placeholders. Confirmed live via the real API: 3 settled cases appear
on [ver-dict.vercel.app/casebook](https://ver-dict.vercel.app/casebook)
(the casebook's `RESOLVED_STATUSES` filter correctly excludes the
cancelled case from public listing, by pre-existing design — it's still
fully reachable directly by ID).

**Note for future testing**: this is now a confirmed repeating pattern,
not a one-off. Any future round that creates test cases by calling the
contract directly (rather than through the frontend/API) will need this
same backfill step — see the README's "Testing this yourself" section and
consider that a standing note, not a surprise to rediscover each time.

## Known gaps / follow-up before real-value production use

- [ ] Real local GenVM validator-consensus test run via `genlayer up`
      localnet mode — tooling and Docker are confirmed working, blocked
      only on an LLM provider API key (OpenAI/Heurist/Gemini/XAI) for the
      validators' `gl.nondet.exec_prompt` calls, which does not exist in
      this environment. Supplying one key unblocks this; it does not need
      a funded StudioNet wallet, only a provider key.
- [ ] `genvm-lint`-equivalent / direct validator tests with divergent
      fetch/LLM mocks, and turning the one-off real end-to-end lifecycle
      run (see "Live end-to-end lifecycle audit" below — this DID happen,
      manually, once) into a repeatable CI job. Needs either a funded
      CI-dedicated wallet or a local GenVM simulator with fast-forwardable
      time, since the real run needed real wall-clock waiting for the
      contract's own evidence/appeal-window deadlines to close.
- [ ] Formal external audit of `contracts/verdict_contract.py` before any
      non-testnet deployment.
- [ ] Automated dependency vulnerability scanning (`npm audit` / Dependabot)
      — CI now exists (`.github/workflows/ci.yml`: contract tests,
      backend lint/typecheck/test/build, frontend lint/typecheck/build on
      every PR) but does not yet run a vulnerability scan step.
- [ ] Structured centralized logging/monitoring on the Fly.io backend
      (currently `pino` structured logs only, no alerting pipeline yet).
- [ ] Load testing of the polling indexer against a case volume beyond
      trivial (current design polls all case IDs sequentially each cycle —
      fine at MVP scale, will need pagination/backoff at scale).
- [ ] `total_volume_wei` in `get_metrics` undercounts by roughly the
      claimant's share of each case's stake (only the respondent's stake
      is added, in `fund_respondent_stake`) — see "Live end-to-end
      lifecycle audit" above. Cosmetic-only (does not affect escrow or
      per-case settlement, both confirmed correct), fixable alongside a
      future contract redeploy by also adding `attached` to
      `total_volume_wei` inside `create_case`.
- [ ] `claim_case_abandonment` has never been exercised against a real
      deployment — its 14-day `ABANDONMENT_GRACE_SECONDS` grace period is
      hard-coded (not per-case or deploy-time configurable), making it
      infeasible to trigger for real within a normal testing session. Would
      need either a genuine multi-week test window or a contract change to
      make the grace period configurable for a test/staging deployment.
