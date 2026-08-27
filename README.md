# VERDICT

**Put money behind your version of reality.**

VERDICT is a collateralized, evidence-based dispute resolution platform built
on a GenLayer Intelligent Contract. Two parties lock GEN as collateral,
submit evidence, and GenLayer's decentralized LLM-validator network
independently investigates that evidence against a predefined constitution.
The Intelligent Contract records the verdict and settles the outcome
on-chain — no human arbiter, no off-chain trust assumption for the money
movement itself.

VERDICT is **not** a betting platform, a prediction market, or a vote on who
people believe. It is evidence-driven dispute resolution:

```
DISAGREEMENT -> RULES -> COLLATERAL -> EVIDENCE -> GENLAYER INVESTIGATION -> VERDICT -> SETTLEMENT
```

## Live deployment

| Component | Where | Status |
|---|---|---|
| Frontend | [ver-dict.vercel.app](https://ver-dict.vercel.app) | Live |
| Backend API | `verdict-backend.fly.dev` | Live, always-on (Fly.io) |
| Contract | `0xD570c9bA2B68b10d0c86EDD9Fc5B384c9ecD7185` (StudioNet) | Live — "v3" |

The contract has gone through several deployments as external audits found
and fixed real issues (hash-truncation canonicalization, DNS-rebinding SSRF,
self-asserted evidence linkage, settlement-band consensus tolerance — full
history in `docs/SECURITY.md`). **Contract deployment is always done by the
project owner, never automated** — see "Redeploying the contract" below.

## How it actually works

1. **Claimant creates a case** (`create_case`, payable) — names a
   respondent by wallet address, states a claim, and locks a stake. The
   contract escrows the GEN itself; nothing off-chain custodies funds.
2. **Respondent matches the stake** (`fund_respondent_stake`, payable) —
   must attach exactly the required amount, or the case stays in
   `AWAITING_RESPONDENT_STAKE` until a join-window deadline, after which
   either side can reclaim via `claim_case_abandonment`.
3. **Both sides submit evidence** (`submit_evidence`) during the evidence
   window — URLs, transaction references, or text statements. Every
   submission carries a SHA-256 content hash computed server-side from the
   actual fetched content (never the URL string), so it can later be
   compared against an independent re-fetch.
4. **Either party requests investigation** (`request_investigation`) once
   the evidence window closes, then **triggers the verdict**
   (`render_verdict`). This runs inside GenLayer's non-deterministic
   consensus block: every validator independently re-fetches every URL
   piece of evidence (`gl.nondet.web.render`), independently calls an LLM
   with a structured prompt built from the constitution + case rules +
   evidence, and the network reaches consensus on a structured verdict
   (outcome, split in basis points, confidence, reasoning) — not on raw LLM
   prose, which is what makes consensus achievable at all (see
   `docs/GENLAYER.md` "Avoiding UNDETERMINED / leader-rotation").
5. **Either party can appeal once** (`file_appeal`, payable — bond is a
   protocol-wide percentage of the combined stake, not chosen per case),
   within a fixed window. This reopens a short evidence window
   (`open_appeal_evidence_window`) and, once that closes,
   **resolve_appeal** triggers a second, final, independent verdict.
6. **Settlement** (`settle_case`) releases the escrowed GEN according to the
   final verdict — loser's share (if any) goes to the protocol treasury,
   with a real-then-transfer pattern (zero the ledger, persist, then
   emit — see `contracts/verdict_contract.py`) so a single chokepoint
   handles every GEN emission and reentrancy isn't a question that needs
   answering per call site.

Every step above was verified against the live v3 contract with real
StudioNet transactions during development — see "Testing this yourself"
below and `docs/SECURITY.md` for the full audit trail.

## Stack

- **Frontend** — Next.js (App Router), Tailwind CSS, shadcn/ui,
  wagmi/viem + Reown AppKit for wallet connection, TanStack Query for
  server state → deployed to Vercel.
- **Backend** — Node.js/TypeScript, Fastify, Postgres via Drizzle ORM,
  Redis (Upstash) for shared rate-limit coordination → deployed to Fly.io
  as two always-on processes (`app` = HTTP API, `indexer` = on-chain →
  Postgres sync loop).
- **Contract** — one production GenLayer Intelligent Contract, written in
  GenLayer's Python-based contract language → deployed to GenLayer
  StudioNet.
- **Evidence storage** — uploaded files live on a Fly.io persistent volume;
  every piece of evidence (uploaded or fetched) is SHA-256 content-hashed at
  submission time and that hash is what gets committed on-chain.

## Repository layout

```
verdict/
├── frontend/          Next.js app (Vercel)
│   ├── app/            App Router pages — (marketing) public landing,
│   │                   (app) authenticated flows, (public) logged-out Casebook
│   ├── components/      UI components (case lifecycle actions, evidence forms, etc.)
│   ├── hooks/           TanStack Query hooks — useCases.ts is the read-path map
│   └── lib/              genlayer.ts (writes), genlayer-proxy.ts (proxied reads), api.ts
├── backend/            Fastify API + Postgres + GenLayer indexer (Fly.io)
│   └── src/
│       ├── routes/       auth, cases, evidence, casebook, constitutions,
│       │                 notifications, genlayer (read proxy)
│       ├── lib/           genlayer-client.ts (contract reads), rate-limiter.ts,
│       │                 safe-fetch.ts (SSRF-guarded evidence fetch), auth.ts
│       ├── indexer/       poll.ts + run.ts — on-chain → Postgres sync loop
│       └── db/            schema.ts (Drizzle), migrate.ts, seed.ts
├── contracts/          The single production GenLayer Intelligent Contract
│   ├── verdict_contract.py
│   └── README.md         Deployment walkthrough + version history
├── tests/               contract/ (deterministic-logic unit tests against a
│                        genlayer stub), backend/, frontend/
├── docs/                 ARCHITECTURE.md, SECURITY.md, DEPLOYMENT.md,
│                        GENLAYER.md, MEMORY.md (running project journal)
└── scripts/              Python automation scripts
```

## Running it locally

### Prerequisites

- Node.js 20+, Python 3.11+ (for the contract's test stub / any local
  contract tooling), Docker (for local Postgres), a GenLayer CLI install if
  you want to interact with the contract directly (`npm i -g genlayer` or
  see [docs.genlayer.com](https://docs.genlayer.com)).

### Backend

```bash
cd backend
npm install
cp ../.env.example .env        # fill in real values — see below
docker compose up -d postgres  # local Postgres on host port 55433
npm run db:generate && npm run db:migrate
npm run dev                    # Fastify API on :4000, hot-reload
npm run indexer                # separately: the on-chain -> Postgres sync loop
```

### Frontend

```bash
cd frontend
npm install
cp ../.env.example .env.local  # fill in NEXT_PUBLIC_* values
npm run dev                    # Next.js on :3000
```

### Contract tests (deterministic logic only)

```bash
python3 -m pytest tests/contract/test_verdict_parsing.py -v
```

This runs the pure parsing/consensus-equivalence logic (verdict coercion,
settlement-band snapping, verdict-agreement comparison) against a minimal
stub of the `genlayer` module — **not** a real GenVM emulator. It does not
exercise nondet LLM calls, evidence fetching, or escrow/payout logic; see
`tests/contract/README.md` for an honest scope statement, and "Testing this
yourself" below for how that logic actually got verified — real
transactions against the real deployed contract, not a simulator.

### Environment variables

See `.env.example` at the repo root for the full list with inline comments.
Never commit a filled-in `.env` / `.env.local` — both are gitignored.

Key ones you'll need:

| Variable | Where | What |
|---|---|---|
| `DATABASE_URL` | backend | Postgres connection string |
| `REDIS_URL` | backend | Upstash Redis — coordinates the shared GenLayer RPC rate-limit budget across the API, indexer, and every frontend tab |
| `JWT_SECRET`, `SESSION_REFRESH_SECRET` | backend | Auth token signing |
| `GENLAYER_RPC_URL` | backend | StudioNet RPC endpoint |
| `VERDICT_CONTRACT_ADDRESS` | backend | The deployed contract address |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | Points at the backend API |
| `NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS` | frontend | Same contract address, for wallet-signed writes |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | frontend | Reown/WalletConnect project ID |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | frontend | StudioNet RPC, used by the wallet's write path |

## Testing this yourself

The full case lifecycle (`create_case` → `fund_respondent_stake` →
`submit_evidence` → `request_investigation` → `render_verdict` →
`file_appeal` → `open_appeal_evidence_window` → `resolve_appeal` →
`settle_case`) was verified with **real signed transactions against the
live v3 contract on StudioNet**, using two dedicated funded test accounts —
not a simulator, not mocked. Every write reached `FINALIZED` /
`MAJORITY_AGREE` consensus with zero genuine GenVM errors; the only
"ERROR" entries observed were benign `CONSENSUS_VALIDATOR_QUORUM_REACHED`
markers (a validator whose vote was cancelled after quorum was already
reached — `fatal: false`, not a real failure). Real GEN moved on
settlement, confirmed by checking both accounts' balances before and
after. The resulting case (`VX-5961`) is fully synced end to end and
visible right now at
[ver-dict.vercel.app/casebook](https://ver-dict.vercel.app/casebook) with
real status `settled` and its real evidence item. Full write-up, including
three real bugs this testing found and fixed (a StudioNet daily RPC quota
silently starving the indexer, a metrics undercounting bug, and an
evidence-visibility gap from testing evidence submission directly
on-chain): `docs/SECURITY.md` → "Live end-to-end lifecycle audit".

To repeat this yourself: connect a funded StudioNet wallet at
[ver-dict.vercel.app](https://ver-dict.vercel.app), or use the
`genlayer` CLI directly (`genlayer call <address> <method>` for reads;
writes need a signer — the CLI's own `write` subcommand doesn't support
sending value with a payable call, which is why the test harness used
`genlayer-js`'s `createAccount`/`createClient` directly instead — see
`docs/SECURITY.md` for the exact pattern).

## Redeploying the contract

**This is always done by the project owner, never by an automated
assistant.** See `contracts/README.md` for the full walkthrough. Once
you have a new address, it needs to be wired into four places:

1. `backend/.env` → `VERDICT_CONTRACT_ADDRESS`
2. `frontend/.env.local` → `NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS`
3. Fly.io secret: `flyctl secrets set VERDICT_CONTRACT_ADDRESS=... --app verdict-backend`
4. Vercel env var: `vercel env add NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS production`
   (then `vercel --prod` and re-alias to `ver-dict.vercel.app` — see
   `docs/DEPLOYMENT.md`)

**Verify the Vercel env var actually took** by grepping the built/served
JS bundle for the new address rather than trusting `vercel env pull` — in
this project that command has been observed to show every `NEXT_PUBLIC_*`
value as an empty string regardless of what's actually stored, so it is
not a reliable check here (see `docs/GENLAYER.md`).

If the case count on the new contract is 0 (a fresh deployment), there's
nothing to clear. If you're redeploying over live data, you likely want to
wipe stale references to the old contract from Postgres first — see
`backend/src/db/clear_all_cases.ts`.

## Known operational gotcha: StudioNet's daily RPC quota

StudioNet enforces **two independent** rate limits, confirmed live against
this production deployment:
- 30 requests/minute (short-term burst cap)
- **5,000 requests/day** (sustained-usage cap) — easy to miss, since a
  client can stay well under 30/min and still exhaust this within hours of
  continuous polling.

This bit us for real: the indexer's original 15-second poll interval alone
made 5,760 requests/day, over budget with zero user traffic, and the
indexer silently failed almost every sync cycle for an extended stretch
with no user-visible error. Fixed (see `docs/GENLAYER.md` "Rate limiting"
for the full story): the poll interval is now 60s, a Redis-backed daily
budget governor exists alongside the per-minute one, and the indexer backs
off exponentially (up to 30 minutes) on consecutive failures instead of
retrying at a fixed rate forever. If you see cases stuck showing a stale
status on the frontend, check `flyctl logs --app verdict-backend | grep
indexer` for this signature before assuming something else is wrong.
Confirmed working as intended: the indexer that got caught in this during
development recovered on its own once StudioNet's daily window rolled
over, with no manual intervention — it logged `[indexer] recovered after
N consecutive failed cycle(s)` and the affected case's status caught up
to `settled` in Postgres on the very next successful cycle, no replay of
intermediate states needed.

## Documentation map

- **`docs/ARCHITECTURE.md`** — system split (on-chain vs Postgres vs
  frontend), case lifecycle state machine, directory responsibilities.
- **`docs/SECURITY.md`** — every external audit round, every finding, and
  the exact fix applied for each; known gaps still open.
- **`docs/DEPLOYMENT.md`** — step-by-step deploy instructions for
  frontend, backend, database, and contract.
- **`docs/GENLAYER.md`** — why GenLayer specifically, how UNDETERMINED /
  leader-rotation is avoided, evidence verification design, indexer
  design, rate limiting, current contract status and version history.
- **`docs/MEMORY.md`** — running, chronological project journal: every
  bug found, every fix applied, in the order it happened. The most
  detailed record of "why is this line of code the way it is."
- **`contracts/README.md`** — contract-specific deployment walkthrough
  and version history (constructor args, breaking API changes between
  versions).
- **`tests/contract/README.md`** — honest scope statement for what the
  unit test suite does and does not cover.

## Contributing / working on this repo

- Contract deployment is a human-only action — see above.
- Every write path is meant to be non-custodial: the backend never signs
  a transaction on a user's behalf; it only proxies rate-limited *reads*
  and indexes derived state. If you find code where the backend holds or
  moves user funds, that's a bug.
- Postgres is a derived index, not a source of truth — it should always be
  safely rebuildable from the contract via the indexer. Don't add
  financially-relevant state that only lives in Postgres.
