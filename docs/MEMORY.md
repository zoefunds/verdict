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
