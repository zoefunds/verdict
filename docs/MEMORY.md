# VERDICT - Project Memory

Running journal of decisions, state, and context for this project. Updated as
implementation progresses. This is a plain project file (not the Claude
memory system) so it travels with the repo.

## Confirmed Decisions (Discovery Phase)

- **Database:** PostgreSQL, run via Docker locally / in production.
- **Backend hosting:** Fly.io, always-on (must never go down).
- **Auth:** Wallet-based (SIWE-style nonce + signature), no email/password,
  no custodial private keys anywhere in the system.
- **Wallets supported:** MetaMask, Rainbow Wallet, Zerion, WalletConnect via
  Reown AppKit. Reown Project ID: `63c579e1124d040f28e2510b67d14dc9`.
- **Frontend:** Next.js (App Router) deployed to Vercel.
- **Styling:** Tailwind CSS + shadcn/ui, using the color/type/spacing tokens
  from the original DESIGN.md prototype (Deep Space Charcoal / Cyan-Trust
  Blue / Emerald-Success institutional dark theme).
- **Evidence file storage:** Fly.io persistent volume, backend-served,
  SHA-256 content-hashed for tamper detection.
- **Case privacy:** Both public and private cases supported; public by
  default. Private cases excluded from Casebook indexes.
- **Settlement model:** Winner reclaims their own stake; loser's stake is
  forfeited to the protocol treasury. Partial verdicts split proportionally.
- **Governance:** Protocol governance for MVP (admin approves constitution
  amendments); full amendment history retained for future migration to
  community governance.
- **Evidence MVP types:** URLs/public webpages, documents/images, transaction
  records, plain-text statements (explicitly labeled as unverified/
  participant-submitted vs. contract-verified).
- **Appeals:** One appeal per case, either party may file, requires an appeal
  bond and new evidence, 7-day appeal window post-verdict, second verdict is
  final.
- **GEN / StudioNet:** GenLayer StudioNet is a testnet; GEN has no real-world
  monetary value. UI must clearly label this (not framed as real money).
- **Social profile verification:** Skipped for MVP (no OAuth social linking).
- **Project root:** `/Users/macbook/verdict`.

## Reference Projects (informing contract + escrow design)

- `/Users/macbook/ic5/self-amending-constitution` - living/versioned
  constitution pattern, directly relevant to VERDICT's constitution
  versioning model.
- Veritine (`source-stake/contracts/veritine_contract.py`) - prior GenLayer
  submission, scored 560 pts on AI review. Study its escrow/verdict pattern
  before writing the VERDICT contract.
- Witness-Weave (`/Users/macbook/Witness-Weaver`) - prior GenLayer
  submission, scored 480 pts on AI review. Same treatment.
- ShipBond escrow pattern (user-supplied, from a friend's contract) -
  zero-then-transfer custody/emission pattern:
  - Money enters only via `@gl.public.write.payable` methods, validated
    against `gl.message.value` (never a caller-supplied amount param).
  - Money leaves only through a single `_send_gen` chokepoint via an
    `@gl.evm.contract_interface` recipient stub.
  - Every payout path: read ledger field -> zero it -> persist state ->
    only then call `_send_gen`. Never transfer before zeroing/saving.
  - Every payout path re-checks `if amount <= u256(0): raise
    gl.vm.UserError(...)` at the top so a double-call finds a zeroed
    balance and rejects cleanly instead of double-paying.
  - All money fields are `u256`, stored as strings in TreeMap[str, str]
    state (GenVM doesn't support arbitrary nested dicts).
  - Use `gl.vm.UserError` for all validation rejections, never bare
    `raise Exception(...)`.

## Open Items / Not Yet Started

- GenLayer CLI / StudioNet environment not yet set up on this machine -
  setup steps to be provided during the GenLayer Contract Design phase.
- Contract not yet written - must be verified against current
  docs.genlayer.com / skills.genlayer.com syntax before implementation,
  per explicit instruction not to invent GenLayer APIs.
- User will deploy the contract themselves and provide the resulting
  contract address; it must never be invented or assumed.

## Phase Log

- [x] Discovery questionnaire completed and answered.
- [x] Architecture proposal presented and approved.
- [x] Step 1: Project initialization (this scaffold).
- [x] Step 2: Database schema design (Postgres/Drizzle, 18 tables).
- [x] Step 3: GenLayer contract design + write (1600+ lines, deployed).
- [x] Step 4: Backend implementation (Fastify: auth, cases, evidence,
      casebook, constitutions, GenLayer read-proxy).
- [x] Step 5: Frontend implementation (Next.js, all required pages, DESIGN.md
      tokens, `next build` verified clean).
- [x] Step 6: GenLayer integration — real `genlayer-js` client (not a stub)
      wired to the deployed contract, verified with a live read
      (`get_protocol_config`) returning real on-chain data.
- [x] Step 7: Evidence system (submission routes + SHA-256 hashing + backend
      storage; on-chain `submit_evidence` write path wired).
- [x] Step 8: Case lifecycle + escrow (contract-side; indexer polls and
      mirrors status into Postgres).
- [x] Step 9: Appeals (contract-side `file_appeal`/`resolve_appeal`; frontend
      appeal flow page).
- [x] Step 10: Casebook (public route + frontend pages).
- [x] Step 11: Constitution governance (protocol-governance MVP; versioned
      articles, amendment proposal method on contract).
- [ ] Step 12: Testing — not yet started (unit/integration/contract test
      suites still to be written).
- [x] Step 13: Security review — initial pass in docs/SECURITY.md; needs
      revisiting once real traffic/load exists, and before handling
      non-testnet value.
- [x] Step 14: Deployment (Vercel + Fly.io) — all three legs live:
      - Contract: StudioNet, see below.
      - Backend: Fly.io app `verdict-backend`, region `iad`, two always-on
        processes (`app` + `indexer`, plus one standby indexer machine),
        Fly Postgres (`verdict-postgres`) attached, persistent evidence
        volume (`verdict_evidence_data`, 3GB) mounted.
      - Frontend: Vercel project `verdict` (scope
        `adebiyi2002gmailcoms-projects`), aliased to
        **https://ver-dict.vercel.app**.
- [x] Step 15: Post-deployment integration verification — confirmed live in
      production: `curl https://verdict-backend.fly.dev/health/ready` ->
      `{"status":"ready"}`; `/genlayer/protocol-config` returns real
      on-chain state through the deployed backend; `ver-dict.vercel.app`
      renders the landing page and reaches the backend with correct CORS
      headers (`access-control-allow-origin` scoped to that exact origin).

## Live URLs

- **Frontend:** https://ver-dict.vercel.app
- **Backend:** https://verdict-backend.fly.dev
- **Contract:** StudioNet, see below.

## Fly.io / Vercel accounts

- Fly.io: `priscillageorge83@gmail.com` (switched from the original
  `zoephotography2020@gmail.com` account, which had a billing issue).
- Vercel: scope `adebiyi2002gmailcoms-projects`. The `verdict` Vercel
  project initially had deployment SSO protection enabled by default
  (blocking public access with a 302 to `vercel.com/sso-api`) — disabled via
  `vercel project protection disable verdict --sso`.
- `frontend/vercel.json` pins `"framework": "nextjs"` explicitly — without
  it, Vercel mis-detected the project as a Fastify app (residual from an
  accidental first `vercel link` run from `backend/` before the cwd issue
  was caught) and deploys failed with "No entrypoint found".

## Deployed contract

- **Address (StudioNet):** `0x56118ae3ee66b662a9a4CEf3424008c1D1036DbD`
- **Constructor args used:** treasury_address = deployer's own account
  (`0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`), 3 genesis core articles,
  min_stake_wei = 0.
- Verified live via a direct `genlayer-js` `readContract` call to
  `get_protocol_config` — returned real on-chain state (appeal_bond_bps:
  2000, current_constitution_version: 1, paused: false).

## Rate limiting (GenLayer StudioNet 30 req/min cap)

- Upstash Redis coordinates a shared budget (capped conservatively at 25/min)
  across the backend API process, the indexer process, and every frontend
  tab — see `backend/src/lib/rate-limiter.ts`.
- Frontend reads never call the GenLayer RPC directly; they go through
  `backend/src/routes/genlayer.ts` (`/genlayer/*`) so the shared budget is
  actually shared. Only wallet-signed writes go direct from the browser
  (those aren't RPC-budget reads, they're user transactions).
- `REDIS_URL` is a credential — it lives only in `backend/.env` (gitignored)
  and must be set as a Fly.io secret in production, never committed.

## Infra notes specific to this dev machine

- Native Homebrew Postgres already occupies `localhost:5432`; a separate
  project's Docker Postgres already occupies `55432`. VERDICT's local
  Postgres container maps to host port **55433** instead
  (`docker-compose.yml`, `.env.example`).
- Dropped `@reown/appkit` / `@reown/appkit-adapter-wagmi` (Reown's full
  modal SDK) after its dependency tree (941 packages, pulling in unrelated
  Coinbase Smart Wallet / Safe Gateway bundles) proved unable to build
  reliably. Replaced with plain `wagmi` + `@wagmi/connectors`
  (`injected()` for MetaMask, `walletConnect()` for Rainbow/Zerion/others,
  same Reown Project ID). Frontend `next build` passes clean with this.
- Production frontend URL: **https://ver-dict.vercel.app** — backend
  `CORS_ORIGIN` (`backend/fly.toml`) is locked to this origin.
- Every `flyctl`/`vercel`/`npm` command in this project must be run with an
  explicit `cd` into the right subdirectory in the SAME shell invocation —
  the tool's cwd has repeatedly reset to the repo root between calls in
  this environment, causing real mistakes (an accidental `vercel link` from
  `backend/`, a `flyctl deploy` that failed with "no Dockerfile" because it
  ran from the repo root). Always `cd /Users/macbook/verdict/<dir> && <cmd>`
  in one command.

## Live end-to-end test findings (2026-08-25) — case creation flow

User walked the real Create Case flow on the deployed app and found three
real gaps, all fixed and redeployed:

1. **Constitution picker was empty** — Postgres had never been seeded with
   any constitution row, even though the contract has a genesis one
   on-chain. Fixed: `backend/src/db/seed.ts` (`npm run db:seed`), seeded
   both locally and in production.
2. **No CTA to actually publish a case on-chain** — the wizard created an
   off-chain DRAFT row and just said "ready to submit your stake," but no
   button anywhere ever called the contract's `create_case`. Cases were
   permanently stuck in DRAFT. Fixed: `frontend/hooks/usePublishCaseOnChain.ts`
   (shared by the wizard success screen and a new case-detail draft-state
   CTA) — reads case count (case ids are sequential, so count-before-tx =
   new id), submits the wallet-signed `create_case` tx, verifies the
   resulting on-chain case's claimant matches before linking (guards
   against a race if another case is created concurrently), then calls
   `PATCH /cases/:id/link-contract`.
3. **No way to name a respondent** — the contract's `create_case` requires
   a `respondent_address` parameter (VERDICT has no "open to anyone"
   respondent concept), but the wizard never collected one. Fixed: added a
   required "Respondent Wallet Address" field to the wizard, a new
   `cases.respondent_address` column (nullable at the DB level to avoid
   breaking the pre-existing test draft row, required at the API/zod
   level for all new cases), and a get-or-create respondent user +
   `case_participants` row at creation time.

Also fixed while wiring #2: `lib/genlayer.ts`'s `createCase`/
`submitEvidenceOnChain` signatures didn't actually match the deployed
contract's real parameters (they were written before the contract was
finalized and never reconciled) — corrected to the real
`create_case(respondent_address, title, claim_text, required_stake_wei,
evidence_window_seconds, respondent_join_window_seconds)` and
`submit_evidence(case_id, kind, url, description, tx_reference)` shapes.
Added `PATCH /cases/:id/fund-respondent` so the respondent's stake-lock
timestamp is recorded off-chain too (previously only the case's overall
status would eventually catch up via the indexer, leaving the
per-participant "Locked" indicator permanently wrong). Gated the evidence
submission form to only render during `evidence_window`/`re_investigation`
status, matching the contract's own enforcement.

## Full page audit (2026-08-25)

Went through every route looking for dead buttons / unwired data:

- **Verdict was never shown anywhere** — the whole point of a resolved
  case. Added `frontend/components/case/VerdictCard.tsx` +
  `useContractCase` hook, reading outcome/split/confidence/reasoning
  directly from the on-chain `get_case` (source of truth), on both the
  authenticated and public case detail pages.
- **Casebook "Highest stake" / "Most appealed" sort buttons were dead** —
  backend always ignored the `sort` param. Fixed `highest_stake` (real,
  DB-backed). `most_appealed` is now correctly implemented (LEFT JOIN
  count against `appeals`) but will read as ties until an appeals-event
  indexing job exists — the indexer currently only mirrors case *status*,
  not individual appeal events. Not fabricated, just not yet fed.
- **Wallet page ignored the fact the contract is now deployed** — showed
  nothing about collateral. Added a real "Case Collateral" summary from
  the user's own cases (honestly labeled as combined stake terms, not
  claimed as "your locked GEN specifically," since that would require a
  participant-level fetch per case this page doesn't do).
- **Profile editing and Notifications were honest "not yet implemented"
  stubs with no backend support.** Implemented both for real: `PATCH
  /auth/me` (displayName/bio) wired into an inline edit form on Profile;
  `GET /notifications` + `PATCH /notifications/:id/read` wired into a real
  Notifications page plus an unread-count bell in `AppTopbar`.
  Notification rows are now actually created at the two most impactful
  trigger points (case opened -> notify respondent, respondent funded ->
  notify claimant) — other trigger points (evidence submitted, verdict
  rendered, appeal filed) still don't create notifications yet, so the
  `notification_type` enum has entries with no producer; that's the next
  gap if this needs to feel fully alive.

## More live-test bugs found and fixed (2026-08-25, continued)

1. **`create_case` sent `required_stake_wei` as a JS string** —
   `.toString()`'d before passing to genlayer-js's `writeContract` args.
   genlayer-js maps a JS string arg to a Python `str` on the GenVM side;
   the contract does `required_stake_wei >= int(self.min_stake_wei)`,
   which raised `TypeError: '>=' not supported between 'str' and 'int'`.
   Confirmed from a real failed StudioNet transaction's stderr traceback.
   Fixed in `frontend/lib/genlayer.ts` — pass the bigint directly, never
   stringify a numeric arg for a write call. **Lesson: every arg's JS type
   must be checked against the contract's expected Python type before
   calling writeContract — a passing TypeScript build says nothing about
   this, since the args array is untyped (`unknown[]`) by design.**
2. **"Fund Respondent Stake" button showed to the claimant, not just the
   respondent** — the `awaiting_respondent_stake` card rendered
   unconditionally for anyone viewing the case, so the claimant looking at
   their own case saw a button meant for the other party (and got a wallet
   rejection when they tried it, since they aren't `case.respondent`).
   Fixed: gated on `address.toLowerCase() === c.respondentAddress.toLowerCase()`,
   with a read-only "waiting on X" message for everyone else.
3. **Case status stuck on `awaiting_respondent_stake` after the respondent
   actually funded on-chain** — two compounding bugs, found by comparing
   the live on-chain `get_case` (correctly `EVIDENCE_WINDOW`) against
   Postgres (stuck):
   - **Indexer off-by-one**: `backend/src/indexer/poll.ts`'s sync loop ran
     `for (let id = 1; id <= count; id += 1)`, but case ids are 0-indexed
     (`case_id = int(self.case_count)` *before* incrementing in the
     contract) — so with one case existing (count=1), the loop checked
     only id=1 (nonexistent, logged "Missing or invalid parameters" every
     cycle) and never touched id=0, the real case. Fixed: loop
     `0 <= id < count`.
   - **`REDIS_URL` Fly secret was corrupted into a garbled two-URL
     string** (`rediss://changeme_upstash_... rediss://default:...@...`) —
     traced to `backend/.env` having two `REDIS_URL=` lines (the
     `.env.example` placeholder content plus an appended real-value
     override); `dotenv` silently keeps the *first* occurrence of a
     duplicate key, so the placeholder always won locally, and the
     `grep '^REDIS_URL='` used to extract the value for `flyctl secrets
     set` matched and concatenated both lines. This meant the shared
     rate-limiter was silently failing open on every request (logged
     repeatedly, easy to miss). Rewrote `backend/.env` and
     `frontend/.env.local` with each var appearing exactly once, and
     reset the Fly secret with `flyctl secrets set REDIS_URL=<correct
     value only>`. **Lesson: never build a local env file by
     concatenating a template's full content with override lines appended
     after — always replace in place, one variable, one line.**

All three fixed and confirmed live: indexer logs show
`[indexer] case 0: awaiting_respondent_stake -> evidence_window`,
`GET /cases` shows VX-5379 as `evidence_window`, and no more Redis
connection errors in the logs.

## Evidence + adjudication pipeline wired for real (2026-08-25, continued)

User correctly flagged two more gaps: evidence submission never went
on-chain, and there was no way to trigger adjudication at all.

- **Evidence on-chain commit**: `EvidenceSubmitForm` previously only ever
  called the off-chain `/evidence/text` or `/evidence/file` backend
  routes. Now, after the off-chain save succeeds (so nothing is lost even
  if the wallet step fails), it calls `genlayerContract.submitEvidenceOnChain`
  (wallet-signed `submit_evidence` write), then reads
  `get_case_evidence_ids(case_id)` via a new proxy route
  (`GET /genlayer/case/:caseId/evidence-ids`) to learn the new on-chain
  evidence id (ids are appended in order, so the last element after the
  tx confirms is the new one — same pattern as the case-count trick), and
  finally calls a new `PATCH /evidence/:id/link-contract` to record it.
  Maps DB `evidenceType` -> contract `kind` (URL/TEXT_STATEMENT/TX_RECORD/
  DOCUMENT_HASH); file uploads use the SHA-256 hash as `tx_reference`.
- **Adjudication pipeline had no UI at all** — the contract's own design
  splits this into four explicit steps (kept deterministic/nondeterministic
  concerns apart, see contracts/verdict_contract.py section 5.7 comments):
  `close_evidence_window_early` (optional, both-parties-ready fast path) ->
  `request_investigation` (deterministic state move, requires evidence
  deadline passed) -> `render_verdict` (the actual nondet LLM+web-fetch
  adjudication — this is what "request adjudication" means concretely) ->
  `settle_case` (payout, auto-transitions APPEAL_WINDOW -> FINAL if the
  appeal deadline already passed). Added
  `frontend/components/case/CaseLifecycleActions.tsx`, shown on the case
  detail page, which reads on-chain `evidence_deadline`/`appeal_deadline`
  from `useContractCase` to decide which single action is currently valid
  and shows exactly that one button with an explanation — never multiple
  contradictory actions at once.
- Added `closeEvidenceWindowEarly` and `renderVerdict` to
  `frontend/lib/genlayer.ts` (were missing entirely; `requestInvestigation`
  and `settleCase` already existed from the initial contract wiring).

Not yet done: automatically re-fetching `onChainCase` on a fixed interval
while a party is looking at a case stuck waiting on the *other* party's
action (e.g. respondent hasn't funded yet) — currently only refetches on
explicit user actions/query invalidation, so a second browser tab won't
see the other party's on-chain action until it's refreshed or its own
`useContractCase`/`useCase` queries next run.

**Update:** the polling gap above is now fixed — see the full audit below.

## Full contract <-> backend <-> frontend audit (2026-08-25, continued)

Systematically diffed every `@gl.public.write`/`@gl.public.view` method in
`contracts/verdict_contract.py` against what was actually wired in
`frontend/lib/genlayer.ts` (writes) and `backend/src/routes/genlayer.ts` +
`backend/src/lib/genlayer-client.ts` (read proxy). Found and fixed real
gaps, in order of severity:

1. **Appeal bond bug that would have reverted every appeal.** The appeal
   page sent `c.appealBondAmountWei` — a value the claimant typed into the
   Create Case wizard and that gets stored in Postgres — as the on-chain
   appeal bond. But `create_case` has no appeal-bond parameter at all, and
   `file_appeal` computes the *required* bond itself, independently, as
   `(claimant_stake_wei + respondent_stake_wei) * protocol appeal_bond_bps
   / 10000` (a PROTOCOL-WIDE setting, `get_protocol_config().appeal_bond_bps`,
   currently 2000 = 20%). Any mismatch reverts with "attached GEN must
   exactly equal the required appeal bond". For VX-5379 (60 GEN each side,
   120 GEN pot, 20% protocol bps) the real requirement is 24 GEN — the
   wizard had stored 12 GEN (20% of one side only). Fixed:
   `app/(app)/cases/[id]/appeal/page.tsx` now computes the bond live from
   `useContractCase` (real stake amounts) + `get_protocol_config` (real
   bps) and uses that for the transaction. The wizard's "Appeal Bond
   Amount" input was replaced with a read-only protocol-computed estimate,
   since the field was never sent to or checked by the contract in the
   first place — it was pure decoration that happened to be wrong.
2. **Appeal pipeline was a dead end after filing.** `file_appeal` was
   wired, but the two steps required afterward —
   `open_appeal_evidence_window` (APPEALED -> RE_INVESTIGATION, reopens
   evidence submission) and `resolve_appeal` (the actual second/final
   adjudication) — had no UI or `lib/genlayer.ts` methods at all. An
   appeal, once filed, could never actually be resolved. Fixed: both added
   to `lib/genlayer.ts` and to `CaseLifecycleActions.tsx`'s state machine
   (APPEALED and RE_INVESTIGATION branches).
3. **No cancellation path.** `cancel_case` (claimant-only, full refund,
   before the respondent funds) had no UI. Added to the
   `awaiting_respondent_stake` branch of `CaseLifecycleActions.tsx`,
   visible only to the connected wallet matching the on-chain claimant.
4. **No abandonment/timeout recovery path anywhere** — the contract's own
   "funds can never be permanently stuck" guarantee
   (`claim_case_abandonment`) had zero UI across every stage it applies to
   (awaiting-respondent-stake, evidence-window/under-investigation,
   appealed/re-investigation). Added as a secondary option alongside the
   primary action at each relevant stage, gated client-side on the same
   `deadline + 14-day grace period` check the contract itself enforces
   (`ABANDONMENT_GRACE_SECONDS`), so the button only appears when it would
   actually succeed on-chain.
5. **Stale UI after successful on-chain transitions** — user reported
   clicking "Signal Ready to Close Early" from both wallets and seeing no
   change. Verified on-chain: it DID work (`evidence_deadline` collapsed
   from Aug 28 to Aug 25, already in the past) — the UI just never
   refetched to notice, since `useContractCase`/`useCase` were one-shot
   fetches with no polling and the UI's "is the deadline in the past"
   check only evaluates at render time. Fixed: both hooks now
   `refetchInterval: 15_000`, so time-based transitions (deadline passing)
   and the other party's on-chain actions surface within 15s without a
   manual reload.
6. **`get_metrics` (protocol-wide totals) was never exposed anywhere.**
   Added `GET /genlayer/metrics` proxy route + `useProtocolMetrics` hook,
   wired into the Dashboard as a small "Protocol Cases / Evidence /
   Appeals / Volume" stat row alongside the user's own stats — confirmed
   live returning real numbers (`case_count: 1, evidence_count: 7`, etc.).

**Deliberately left unwired** (owner-only admin functions —
`set_protocol_fee_bps`, `set_appeal_bond_bps`, `set_paused`,
`transfer_ownership`, `set_treasury_address`, `sweep_treasury`,
`propose_constitution_amendment`, `add_case_rule`): no admin panel exists
in this app, and casually exposing owner-only contract calls to the
regular case-detail UI would be a security-relevant scope decision, not a
"missing wiring" bug — flagging here rather than adding silently.
Similarly `get_case_rules` and `get_current_constitution_version` (views)
weren't proxied — the off-chain DB already tracks case rules and
constitution version adequately for display, so the on-chain view isn't
load-bearing for the current UI, though it would be a straightforward
addition if the constitution page ever needs to prove on-chain-vs-DB
consistency.

## First real appeal + two more evidence bugs found (2026-08-25, continued)

Verdict actually rendered for VX-5379 for real: `PARTIAL`, 75/25 split,
55% confidence, full structured reasoning citing the specific evidence
(404 staging URL, unverifiable milestone doc, respondent's own admission
of 3/5 pages) — confirms the whole adjudication pipeline works
end-to-end, including GenLayer's real LLM+web-fetch evaluation.

User then filed a real appeal (respondent, citing the CMS provider outage
as a third-party delay under Article 4) — confirmed on-chain: status
`APPEALED`, `appeal_used: true`, 24 GEN bond correctly computed and
locked (validating the appeal-bond fix from the previous audit pass).

Then hit two more real bugs trying to submit appeal evidence, found by
reading the failed transaction directly on
explorer-studio.genlayer.com/tx/... :

1. **Text-statement evidence content was silently dropped on-chain.** The
   error message showed decoded params with an empty `description` field.
   Root cause: `EvidenceSubmitForm`'s on-chain commit sent the optional
   "Description" field as the contract's `description` argument, but
   never sent `textContent` — the actual text the user typed into
   "Content" for `text_statement` kind. The contract has no separate
   content parameter; `description` IS the content slot. Fixed in both
   `EvidenceSubmitForm.tsx` and `useCommitEvidenceOnChain.ts` (the
   retroactive-commit hook had the identical bug) — now sends
   `textContent` (plus any optional description, joined) as the on-chain
   description, capped at 2000 chars to match the contract's
   `MAX_EVIDENCE_DESCRIPTION_LEN` (previously would have reverted on
   anything longer, since off-chain allows up to 20000 chars).
2. **Appeal-evidence form always attempted on-chain submission,
   regardless of case status.** The actual failure the user hit:
   `[EXPECTED] case is not currently accepting evidence` — the contract
   only accepts `submit_evidence` during `EVIDENCE_WINDOW` or
   `RE_INVESTIGATION`, but the case was still `APPEALED` (appeal filed,
   but "Open Appeal Evidence Window" not yet clicked). The main case
   detail page already gated the whole evidence form's visibility
   correctly; the appeal page never did. Added a `canCommitOnChain` prop
   to `EvidenceSubmitForm` (defaults `true` for back-compat) and wired the
   appeal page to pass `c.status === "re_investigation"` — off-chain save
   still always happens, but the on-chain step is skipped with an honest
   inline message instead of attempting (and reverting) a doomed
   transaction.

**Lesson reinforced again**: every on-chain write's argument mapping needs
to be checked field-by-field against what the contract actually reads
from each parameter, not just "does it compile" — this is the third
distinct on-chain argument-mapping bug found this way (after the
stringified `required_stake_wei` and the ignored per-case appeal-bond
field), all three only surfaced by reading a real failed StudioNet
transaction's decoded params/stderr, not from code review alone.

## Final staleness audit (2026-08-25, continued)

User asked explicitly to confirm nothing is stale end to end. Found one
more real bug and closed the remaining gaps:

- **The actual staleness bug**: `CaseLifecycleActions.tsx` computes
  `nowSec = Date.now()` inline at render time and compares it against
  on-chain deadlines. React Query does structural sharing — if a poll's
  fetched data deep-equals the previous result, the query keeps the SAME
  object reference specifically to avoid a re-render. That means a
  deadline passing with zero on-chain activity (nobody has to submit a
  transaction for wall-clock time to elapse) would never flip the UI from
  "window still open" to "action now available" — `refetchInterval` alone
  only helps when the fetched *values* actually change. Fixed with an
  independent `setInterval` (20s) that forces a re-render via a dummy tick
  state, decoupled from data-change-triggered re-renders.
- Added `refetchInterval` to every remaining un-watched query:
  `useCaseEvidence` (15s — the other party's evidence appears with zero
  action on this user's end), `useMyCases` (20s — dashboard), `useCasebook`
  (30s), `useProtocolMetrics` (30s). Combined with the previous pass's
  `useCase`/`useContractCase` (15s) and the existing notification-bell
  poll (30s), every read surface in the app now self-updates.
- Verified no read path bypasses the rate-limited backend proxy: grepped
  for `createClient`/`genlayer-js` usage across both frontend and backend
  — only `frontend/lib/genlayer.ts` (writes, correctly direct-to-wallet)
  and `backend/src/lib/genlayer-client.ts` (reads, correctly routed
  through the Redis-coordinated rate limiter) import it. No leaks.
- Verified `fund_respondent_stake`'s payable value
  (`c.stakeAmountWei` from Postgres, not a fresh on-chain read) is safe
  despite being off-chain-sourced: it's set once at `create_case` time
  from the exact same value and is immutable on the contract afterward —
  no drift is possible, so this isn't a staleness risk despite reading
  from the DB rather than `onChainCase`.

**Known, deliberately-accepted scaling caveat** (not fixed, just flagged
honestly): the indexer's poll cycle cost scales as `1 + case_count` RPC
calls every 15s. At current test scale (1-2 cases) that's well within the
shared 25/min Redis-coordinated budget. Once case count grows past
roughly 5-6 concurrently-open cases, the indexer alone could approach or
exceed the budget even before counting frontend tabs' own polling — this
was already flagged in the original rate-limiting design notes
(`backend/src/indexer/poll.ts` module comment) as needing pagination/
backoff at scale, and remains true after this audit. Not addressed now
since it's out of scope for "is anything ACTUALLY stale right now" at the
app's current real usage level.

## External audit + contract v2 (2026-08-25, continued)

User ran (or received) a rigorous external audit of the contract,
backend, and frontend, citing exact line numbers and docs.genlayer.com
references. Every one of the 6 findings checked out against the actual
code. Full detail in `docs/SECURITY.md` "External audit findings" and
`contracts/README.md` "v2 — external audit fixes"; short version:

1. `_coerce_outcome` now raises `ERR_LLM` on unmappable LLM output instead
   of silently defaulting to INCONCLUSIVE (was accepting malformed/
   hallucinated output as a settlement-ready refund).
2. Added `SETTLEMENT_BANDS_BPS` — PARTIAL splits snap to one of 7 discrete
   bands before leader/validator comparison; raw tolerance tightened
   1500 -> 500 bps as a backstop only.
3. `MAX_EVIDENCE_PER_CASE` 40 -> 15, `MAX_EVIDENCE_FETCH_CHARS` 5000 ->
   1200; prompt restructured into explicit bounded "witness record"
   blocks. A full two-stage extraction pipeline was considered and
   explicitly NOT implemented (doubles nondet LLM calls) — documented as
   a follow-up, not silently half-done.
4. `_mark_evidence_independently_fetched` now threads the leader's real
   per-item fetch/hash result through instead of blanket
   `fetch_succeeded = True`.
5. **Biggest fix**: `submit_evidence` gained a required `content_hash`
   param (contract had none before); the backend
   (`backend/src/lib/safe-fetch.ts`) now actually fetches URL evidence
   server-side (SSRF-guarded — smoke-tested against a real URL,
   localhost, and a cloud-metadata address, all behaving correctly) and
   hashes the real body, instead of hashing the URL string as before. The
   contract's verdict-time re-fetch now compares its own hash against the
   commitment and surfaces match/mismatch to the LLM as a signal, not an
   automatic verdict.
6. Fixed `docs/GENLAYER.md`'s stale "not yet deployed" claim (a real
   address had been live and used for hours). Pinned `genlayer-js` to
   different EXACT versions per package (frontend `0.16.0`, backend
   `1.1.8`) rather than guessing a unified version works for both without
   being able to test the wallet-signing path myself — each is what's
   actually proven working in its own role right now.

Added `tests/contract/` — 19 unit tests for the deterministic parsing/
banding/equivalence logic (via a minimal `genlayer` stub, not a GenVM
emulator), all passing, directly regression-testing fixes #1 and #2.
Honestly scoped in `tests/contract/README.md`: nondet/escrow/payout paths
still need the real GenLayer CLI (`genvm-lint`, `genlayer test`), not
installed in this environment — that gap is only partially closed, not
pretended to be fully closed.

**This is a new contract needing redeployment** — `submit_evidence`'s
signature changed, so it's wire-incompatible with the retired
`0x5611...036DbD` address. User will redeploy themselves and provide the
new address, per this project's original rule (contract deployment is
always done by the user, never assumed or invented).

## Second external audit round (re-audit, 2026-08-25) — new contract wired
in, safe-fetch actually fixed, production redeployed

User provided the redeployed v2 contract address
`0x2be36DaF2FC169310dB7Cc2dAFBAa3Db410aA195` and asked to clear all
cases/evidence from previous contracts, then pasted a re-audit scoring
3,300/4,000 with 5 findings and said "fix them" — see
`docs/SECURITY.md`'s "Second external audit round" section for the full
per-finding detail. Summary of what actually happened:

- Wired the new contract address into `backend/.env`,
  `frontend/.env.local`, and the Fly.io `VERDICT_CONTRACT_ADDRESS` secret.
  Verified it loads correctly via the real `genlayer` CLI (`genlayer
  schema`, `genlayer call ... get_protocol_config`) — not assumed.
- Ran `backend/src/db/clear_all_cases.ts` against production via `flyctl
  ssh console`: deleted the 2 old-contract cases (VX-2939, VX-5379),
  confirmed 0 cases remain.
- Fixed the hash-truncation mismatch (backend/contract now both truncate
  to the same 1,200-byte bound before hashing).
- Fixed self-asserted evidence linkage: `PATCH
  /evidence/:id/link-contract` now reads the claimed id back from the
  contract and cross-checks case id/submitter/kind/content-hash before
  persisting.
- **The DNS-rebinding SSRF fix took two real debugging passes to actually
  work, not just compile.** First attempt (undici `Agent` with a custom
  `connect.lookup`) failed at runtime with `ERR_INVALID_IP_ADDRESS` even
  for legitimate public URLs — abandoned rather than shipped broken.
  Second attempt (plain Node `http`/`https` with a `lookup` request
  option) hit the SAME error class initially, which proved the bug was in
  my own lookup function, not the transport. Root-caused by writing an
  isolated `node -e` reproduction against `https.request` directly (not
  through the app), which showed Node was calling my lookup function with
  `{ all: true, hints: 1024 }` and expecting an array-of-results callback
  shape back — I was unconditionally calling back with a single
  `(address, family)` pair, which Node's internal `emitLookup` then choked
  on trying to read `results[0].address` off a string. Fixed by branching
  on `options.all`. A SECOND distinct bug surfaced only after fixing the
  first and testing the metadata-IP case: `169.254.169.254` was
  "blocked" but only via an 8s connection timeout, not the intended
  instant IP-range rejection — because Node's http client skips the
  custom `lookup` option entirely when the hostname is already a literal
  IP (no DNS resolution needed), so literal-IP URLs bypassed the guard
  completely. Fixed with an explicit `isPrivateOrReservedIp` pre-check on
  literal-IP hostnames before ever calling `mod.request`. Both fixes
  verified against a real Node process (`example.com` succeeds instantly,
  `127.0.0.1`/`::1`/`169.254.169.254` all rejected instantly with the
  correct error message, not a timeout) before deploying.
- Backend redeployed to Fly.io (`flyctl deploy`) with all of the above.
- **Found an unrelated real bug while redeploying the frontend**: the
  Vercel production env var `NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS` existed
  but was set to an EMPTY STRING (`vercel env pull` confirmed
  `=""`) — not the stale v1 address as expected, just blank. Removed and
  re-added with the correct v2 address before deploying, otherwise the
  live frontend would have shipped with no contract address at all.
- Frontend deployed to Vercel production and aliased to
  `ver-dict.vercel.app` (the required production URL for this project),
  after getting explicit user confirmation first — `vercel --prod` is a
  publish-to-shared-state action, and the auto-mode classifier correctly
  blocked the first unconfirmed attempt.

## Third external audit pass (re-audit of the re-audit, 2026-08-25) —
caught a silent regression, closed the render-vs-raw gap honestly

Re-audit score 3,250/4,000, three findings. What actually happened:

- **The single biggest finding was self-inflicted and worth remembering**:
  `contracts/verdict_contract.py`'s byte-truncation fix from the PREVIOUS
  round had been silently reverted — back to character-truncation, with
  `_hash_matches_submission` and the old 2-tuple `_fetch_evidence_
  independently` restored — by the time this audit ran. This is the same
  external file-sync-stripping-changes behavior (almost certainly GenLayer
  Studio) noted earlier in this doc for the module header comment, but
  this time it silently reverted actual logic, not just a comment block.
  **Lesson: after any edit to `verdict_contract.py`, re-diff or re-run
  `pytest tests/contract/` before trusting the file reflects what was
  last written — do not assume an edit made minutes ago is still there.**
  Re-applied the byte-truncation fix (`EVIDENCE_CONTENT_BYTES = 1200`,
  hashing the same truncated UTF-8 byte buffer that's displayed) and
  verified immediately with the 19-test suite, not just by re-reading the
  diff.
- Also fixed the OTHER half of finding #1, which was real and not just a
  regression: the backend hashed raw HTTP response bodies while the
  contract's fetch goes through `gl.nondet.web.render(..., mode="text")`
  — a rendered-text view. Added `extractVisibleText` to
  `backend/src/lib/safe-fetch.ts` (strips script/style/noscript blocks and
  remaining tags, decodes entities, collapses whitespace) so HTML
  responses are hashed as approximate visible text instead of raw markup.
  Explicitly documented as a narrowing, not a claimed fix: a hand-rolled
  tag-stripper can't be proven byte-identical to GenVM's actual renderer
  for JS-driven content, and GenVM exposes no raw-fetch primitive to
  match against instead — this is why the contract has always treated
  (and still treats) a hash mismatch as a signal for the verdict LLM to
  weigh, never automatic proof of tampering.
- Fixed a real doc-drift bug caught while addressing finding #2:
  `docs/GENLAYER.md` still said "awaiting redeployment" even though the
  v2 contract (`0x2be36...`) had already been deployed, wired in, and
  CLI-verified in the previous round. Updated it, and — since the
  byte-truncation fix above changed contract source AGAIN after that
  deployment — added an explicit note that the currently-deployed
  bytecode no longer matches checked-in source and needs a fresh
  redeploy (by the user, never by Claude, per this project's standing
  rule) before the hash fix is actually live on-chain.
- Attempted to close finding #3 (no real GenVM validation) with something
  more real than another stub-test claim: `genlayer up`/`genlayer init`
  has a local multi-validator GenVM simulator mode in Docker, which
  doesn't need a funded StudioNet wallet. Docker was confirmed available
  and `genlayer init --numValidators 3` was actually run (twice — first
  attempt with `yes | ...` piped into the interactive prompt corrupted
  the TUI's terminal control codes into a 4.6MB garbage log, fixed by
  piping a single `y` instead). It reached a second interactive step
  requiring a real LLM provider API key (OpenAI/Heurist/Gemini/XAI) for
  the validators' own `gl.nondet.exec_prompt` calls — no such key exists
  anywhere in this project's environment, and none was fabricated or
  requested just to force the init through. Documented as a genuinely
  open gap in `docs/SECURITY.md`, not silently dropped or claimed closed:
  this specific gap is one provider API key away from resolvable, not a
  tooling dead end.

## v3 contract deployed — `0xD570c9bA2B68b10d0c86EDD9Fc5B384c9ecD7185`

User redeployed with the byte-truncation fix included and gave the new
address. Wired into `backend/.env`, `frontend/.env.local`, the Fly.io
`VERDICT_CONTRACT_ADDRESS` secret, and the Vercel prod env var. Verified
against real chain state before trusting it: `genlayer schema` confirms
`submit_evidence`'s 6-param signature matches source exactly, `genlayer
call get_protocol_config` returns live config, `get_case_count` returns
`0` (clean deploy, nothing to clear this round).

**Caught the Vercel env-add bug happening a THIRD time and finally root-
caused it**: `vercel env pull` shows every single `NEXT_PUBLIC_*` var as
an empty string in this project, including ones known to be live and
working (API_BASE_URL, APP_ENV) — this is `env pull` masking/not
resolving values in this CLI context, not the underlying secret actually
being empty. The previous session's "found it empty, fixed it" diagnosis
for v2 may itself have been a false alarm from this same CLI quirk
(harmless either way, since re-setting to the correct value is a no-op if
it was already correct). **Lesson: never trust `vercel env pull` to
verify a `NEXT_PUBLIC_` value in this project — verify by grepping the
actual built/served JS bundle instead.** Did exactly that this time:
rebuilt the frontend locally against `.env.local`, grepped the resulting
`.next` client chunks for the new address (found in `layout` and
`casebook/page`, old address absent anywhere), then re-confirmed by
fetching the actual live chunks from `ver-dict.vercel.app` after
deploying and aliasing — both real, both automated, neither assumed.

Deployed frontend to Vercel prod and aliased to `ver-dict.vercel.app`
after explicit user confirmation (blocked once by the auto-mode
classifier first, same as the v2 round — expected behavior for a
publish-to-shared-state action, not a bug).

## Live end-to-end lifecycle audit (2026-08-25) — found real bugs no
static review would have caught

User asked for a real audit — every read/write method exercised with
real, detailed transactions against the live v3 contract, zero tolerance
for GenVM/consensus errors, and the result had to actually show up on the
frontend. Full write-up: `docs/SECURITY.md` "Live end-to-end lifecycle
audit". Two things worth remembering:

- **The static wiring audit (schema diff against every call site) found
  zero drift, and would have missed both real bugs below entirely.**
  Neither was a code-vs-contract mismatch — they only surfaced by actually
  running transactions and watching what happened over real wall-clock
  time. This is the case for doing the real thing, not just the review.
- **`genlayer write` cannot send payable value** (hardcodes `value: 0n`,
  confirmed by reading the CLI's own source) — this blocked testing
  `create_case`/`fund_respondent_stake`/`file_appeal` via the CLI
  entirely. Worked around with `genlayer-js`'s `createAccount`/
  `createClient` directly from a Node script, decrypting the CLI's own
  keystore files with `ethers.Wallet.fromEncryptedJson` to get a raw
  private key. This is now documented in `contracts/README.md` so it
  doesn't need re-discovering.
- Found **the indexer silently starving on an undocumented StudioNet
  daily quota** (5,000 req/day, separate from the known 30/min cap) —
  root-caused by SSHing directly into the indexer's Fly machine and
  reproducing the exact upstream error (`Rate limit exceeded: 5000
  requests per day`, code -32029), not just inferring it from a generic
  wrapped error message. Fixed with a slower poll interval, a real daily
  budget governor, and exponential backoff on sustained failure — see
  SECURITY.md for detail. The specific machine used for this test kept
  failing for a while even after the fix deployed, since the fix doesn't
  retroactively restore an already-blown daily counter — confirmed the
  fix itself was correct by reproducing success from a different source
  (the API machine, unaffected) while the indexer machine worked through
  its backlog. Don't mistake "still failing right after a fix deploys" for
  "the fix didn't work" without checking whether a different, unaffected
  source succeeds.
- Found `get_metrics`'s `total_volume_wei` undercounts by roughly half
  (only respondent stakes are added, never claimant stakes) purely by
  reading the actual value back after a real test transaction and noticing
  it didn't match the known total. A static code read might have caught
  this too, but it was the live number looking wrong that actually
  triggered checking the source.

Test accounts created for this (`verdict-test`, `verdict-test-2`) are
StudioNet-only ephemeral keystores local to this dev machine
(`~/.genlayer/keystores/`), not tied to the user's real wallet — fine to
reuse for future live testing, or to ignore/delete, entirely at the
user's discretion.

Afterward, did a full documentation pass at the user's explicit request:
rewrote `README.md` from scratch (it still said "scaffolding in
progress" despite the app being live in production for a while),
updated `docs/DEPLOYMENT.md` with the current contract address and a
verify-in-this-order checklist, updated `contracts/README.md` with the
full v1/v2/v3 version history and the `genlayer write` payable-value
limitation, and rewrote `tests/contract/README.md`'s "not covered" section
since most of what it listed as uncovered had since been covered live.

## Closing the loop: evidence backfill + indexer recovery, both confirmed

Two threads closed out for real after the doc pass above:

- User noticed the E2E test case's evidence timeline was empty on the
  frontend. Root cause: the live lifecycle test submitted evidence
  directly on-chain via `genlayer-js` to isolate testing contract
  consensus, never going through the app's own `POST /evidence/text` →
  `PATCH /evidence/:id/link-contract` flow — so real, correct on-chain
  evidence had no Postgres row to be read from. Wrote
  `backend/src/db/backfill_test_evidence.ts` to backfill exactly the row
  that flow would have created, using real on-chain values (hash,
  description, the genuine `content_hash_matched: false` outcome recorded
  honestly as `status: "verification_failed"`, not glossed over as
  verified). **Hit a real gotcha writing it**: `users.walletAddress` is
  stored checksummed (mixed-case), not lowercase — first attempt queried
  lowercase and found nothing. Confirmed by dumping the actual `users`
  table rows rather than guessing at the format. Fixed and backfill
  succeeded on retry.
- The indexer's StudioNet daily-quota backoff (from the earlier fix)
  recovered entirely on its own with zero manual intervention — confirmed
  by polling the case's API endpoint hours later and seeing
  `"status": "settled"` with a `settledAt` matching the real on-chain
  settlement timestamp exactly. This is the strongest real-world
  confirmation yet that `syncOneCase`'s "just overwrite to current
  on-chain status" design is correct even after an extended outage, not
  just for routine gaps.

Both are now documented with their FINAL confirmed state (not
"should work once X happens") across README.md, docs/SECURITY.md, and
docs/GENLAYER.md, per the user's explicit ask for "real detailed latest
information," not projected/expected outcomes.

## v4 contract + multi-product live lifecycle audit (2026-08-29)

New contract `0x2BEe5eBb18c8E0D82E68Fc103fA68dfC0e876E58` ("v4") wired in
after user request: clear all prior-contract DB data, then run every
non-admin read/write method through 4 independent, fully-detailed product
tests. Full technical write-up in `docs/SECURITY.md` "Multi-product live
lifecycle audit" — summary of what's worth remembering:

- Flagged the `claim_case_abandonment` 14-day hard-coded grace period to
  the user BEFORE starting, rather than silently skipping it or trying to
  fake it — got explicit agreement to skip it. Asking first here mattered:
  it's the kind of thing that looks like an oversight if discovered after
  the fact instead of disclosed upfront.
- 4 real, distinct dispute scenarios (freelance payment, rental deposit,
  contract cancellation, e-commerce partial refund) with genuinely
  different evidence and outcomes — not 4 copies of the same test with
  different names. One (`add_case_rule` test) got the LLM to explicitly
  cite the added case rule by name in its verdict reasoning — real
  confirmation the mechanism works, not just that the call doesn't error.
- **The v3 round's evidence-visibility gap repeated at case-level, and
  this time it's clearly a pattern, not a one-off**: testing by calling
  the contract directly (for precise scriptable control) always bypasses
  the app's DB-writing flow, so it will ALWAYS need a backfill step
  afterward. Documented this explicitly in SECURITY.md as a standing note
  for future rounds, not something to silently rediscover each time.
- Real consensus behavior observed twice: `MAJORITY_DISAGREE` after
  exhausting all 3 leader rotations, resolved by simply retrying the same
  call for a fresh leader/validator draw. This is expected GenVM behavior,
  not a bug — worth remembering so a future session doesn't panic and
  start "fixing" something that isn't broken.
- Real timing constraint found: evidence/appeal windows have a **hard
  1-hour minimum enforced on-chain** regardless of what's requested — a
  short-window request doesn't error, it silently floors to 1 hour. This
  meant every appealed test case had a real ~1-hour wait before
  `resolve_appeal` became callable; scheduled wakeups (not fixed sleeps)
  were used to avoid busy-waiting during each wait.
- **This exact README-update step was initially skipped and had to be
  redone after the user flagged it.** The pattern going forward: any
  contract redeployment or major testing round needs README.md +
  docs/SECURITY.md + docs/GENLAYER.md + contracts/README.md +
  docs/DEPLOYMENT.md all touched, not just SECURITY.md/MEMORY.md — the
  user has now had to ask twice for the full doc set to be kept current
  after a round like this, so treat "update the docs" as implicitly
  including README.md every time, not just the audit trail files.

## Engineering quality blockers fixed (2026-09-12)

Three concrete gaps found by an external audit, all fixed and verified:

- **Backend `eslint` had no config at all under ESLint 9** (which dropped
  support for `.eslintrc.*` — needs a flat `eslint.config.js/mjs`). Added
  `backend/eslint.config.mjs` using `typescript-eslint`'s flat preset,
  deliberately without type-aware linting (kept fast, and avoids needing
  every one-off `src/db/` maintenance script added to a tsconfig
  `"project"` array — `tsc --noEmit` already covers type correctness
  separately). Also cleaned up two now-unused `eslint-disable` comments and
  one unused import that surfaced once linting actually ran.
- **Frontend `next lint` failed** on a real unescaped apostrophe in
  `app/(marketing)/page.tsx` (`contract's` in body copy) — one-line fix
  (`&apos;`), confirmed clean afterward.
- **Backend `npm test` failed outright — zero test files existed.** Added
  real unit tests, not filler: `safe-fetch.test.ts` (SSRF IP-range
  classification incl. IPv4-mapped IPv6 recursion, the HTML-to-visible-text
  extractor, and the byte-vs-character truncation behavior that caused a
  real hash-mismatch bug earlier this project), `indexer/poll.test.ts`
  (asserts `CONTRACT_STATUS_TO_DB_STATUS` stays exhaustive against every
  `STATUS_*` constant actually present in `verdict_contract.py`, parsed
  live from the contract source — this fails loudly if a future contract
  change adds a status the indexer doesn't know how to map, instead of the
  indexer silently warn-and-skipping it in production), and
  `evidence.test.ts` (the DB-enum-to-contract-`kind` mapping). Exported
  `isPrivateOrReservedIp`, `extractVisibleText`, `CONTRACT_STATUS_TO_DB_STATUS`,
  and `toContractKind` — all previously private/nested — specifically to
  make them unit-testable; none of that changes runtime behavior. Hit one
  real snag: importing `poll.ts`/`evidence.ts` transitively loads
  `db/client.ts`, which throws at import time if `DATABASE_URL` is unset —
  correct for the running app, but blocks unit-testing pure logic in those
  files in an environment with no DB configured. Fixed with
  `backend/vitest.config.ts` supplying a placeholder `DATABASE_URL` for the
  test environment only (no test performs real I/O against it).
- Added `.github/workflows/ci.yml`: contract's 19 deterministic tests,
  backend lint/typecheck/test/build, frontend lint/typecheck/build, all on
  every PR and push to `main`. Verified the frontend build step actually
  works with placeholder `NEXT_PUBLIC_*` env vars (the values CI will use,
  since it never contacts a real backend/contract) before trusting the
  workflow file, not just assumed from writing it.
