# VERDICT — Architecture

## System overview

VERDICT is split across three independently deployable systems with an
intentional split of "source of truth":

1. **GenLayer Intelligent Contract (StudioNet)** — authoritative for: case
   existence, stake custody/escrow, evidence content-hash commitments,
   verdicts, appeals, settlement. If it isn't true on-chain, it isn't
   financially true, no matter what Postgres says.
2. **Postgres (backend/src/db/schema.ts, Drizzle ORM)** — the indexed /
   derived layer: rich case metadata, evidence content, constitution
   library, casebook search, notifications, audit log. Rebuildable at any
   time from the contract via `backend/src/indexer/`.
3. **Next.js frontend (Vercel)** — reads Postgres for browsing speed, but
   reads financial truth (stakes, verdicts, settlement) directly from the
   contract via `frontend/lib/genlayer.ts`.

```
 wallet signs tx           contract state changes         indexer polls
      |                          |                              |
      v                          v                              v
  GenLayer contract  <----  frontend (Vercel)  ---->   backend API (Fly.io)
      ^                          |                              |
      |                          v                              v
      +-----------------  direct verdict/stake reads      Postgres (derived)
```

## Why the split (on-chain vs off-chain vs frontend)

- **On-chain**: anything where tampering must be cryptographically
  impossible — money movement, verdict outcome, evidence hash commitments.
- **Off-chain (Postgres)**: anything that benefits from fast search/filter
  (Casebook browsing, case lists) or needs storage the chain shouldn't hold
  directly (full evidence file bytes, long-form descriptions). Every
  financially-relevant Postgres field carries a `contract_*` reference back
  to the chain so it's auditable, not just asserted.
- **Frontend**: never trusts a cached Postgres value for "did I get paid" —
  settlement/verdict reads go straight to the contract's view methods.

## Case lifecycle (state machine)

```
DRAFT -> OPEN -> AWAITING_RESPONDENT_STAKE -> FUNDED -> EVIDENCE_WINDOW ->
UNDER_INVESTIGATION -> VERDICT_RENDERED -> APPEAL_WINDOW ->
  [APPEALED -> RE_INVESTIGATION -> FINAL] | FINAL -> SETTLED
(also: CANCELLED, ABANDONED_REFUNDED as timeout/cancellation exits)
```

Mirrored identically between `contracts/verdict_contract.py` (source of
truth) and `backend/src/db/schema.ts` `case_status` enum (derived index) —
see `backend/src/indexer/poll.ts` `CONTRACT_STATUS_TO_DB_STATUS` for the
explicit mapping table.

## Directory responsibilities

- `frontend/` — Next.js App Router app. `(marketing)` = public landing,
  `(app)` = authenticated case/dashboard flows, `(public)` = logged-out
  Casebook.
- `backend/` — Fastify API: wallet auth (SIWE-style), case/evidence CRUD
  against Postgres, file storage on the Fly.io volume, and the GenLayer
  polling indexer.
- `contracts/` — the single production Intelligent Contract.
- `scripts/` — every file-creation/modification operation, as executable
  Python scripts (per the project's terminal-first workflow).
- `docs/` — this file, plus SECURITY.md, DEPLOYMENT.md, GENLAYER.md,
  MEMORY.md (running project journal).

## Transaction lifecycle (frontend)

Every stake / settlement / appeal-bond action goes through an explicit
state machine (`frontend/hooks/useTransaction.ts`):

```
idle -> wallet_confirm -> submitted -> pending -> confirmed | failed
                                            |
                                            +-> rejected | wrong_network |
                                                insufficient_funds |
                                                wallet_disconnected
```

No UI path is allowed to show a bare "Success" without passing through
`confirmed`.
