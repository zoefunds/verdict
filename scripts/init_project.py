#!/usr/bin/env python3
"""
init_project.py

Scaffolds the VERDICT project directory structure, git repo, and baseline
config files. Safe to re-run: creates missing pieces, never overwrites
existing files with content in them.

Usage:
    cd /Users/macbook/verdict
    python3 scripts/init_project.py
"""

from pathlib import Path
import subprocess
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DIRECTORIES = [
    "frontend/app/(marketing)",
    "frontend/app/(app)",
    "frontend/app/(public)",
    "frontend/components",
    "frontend/lib",
    "frontend/hooks",
    "frontend/types",
    "frontend/public",
    "backend/src/routes",
    "backend/src/db",
    "backend/src/indexer",
    "backend/src/storage",
    "backend/src/lib",
    "contracts",
    "scripts",
    "tests/contract",
    "tests/backend",
    "tests/frontend",
    "docs",
    "config",
]

GITIGNORE_CONTENT = """\
# Dependencies
node_modules/
.pnp
.pnp.js

# Env files (never commit secrets)
.env
.env.local
.env.*.local
!.env.example

# Next.js
frontend/.next/
frontend/out/
frontend/build/

# Backend
backend/dist/
backend/build/

# Postgres data (Docker volume mounts if any land in-repo)
pgdata/
*.sqlite

# Evidence storage volume (never commit user-uploaded evidence)
backend/storage/uploads/
storage/

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/

# Test/coverage
coverage/
.nyc_output/

# GenLayer local artifacts
contracts/__pycache__/
contracts/*.pyc

# Python
__pycache__/
*.pyc
.venv/
venv/
"""

ENV_EXAMPLE_CONTENT = """\
# ==============================================================================
# VERDICT - Environment Variable Template
# Copy this file to .env (root/local dev) or .env.local (frontend) and fill in
# real values. NEVER commit the filled-in file.
# ==============================================================================

# ---- Database (Postgres via Docker) ----
POSTGRES_USER=verdict_app
POSTGRES_PASSWORD=changeme_local_dev_only
POSTGRES_DB=verdict
POSTGRES_PORT=5432
DATABASE_URL=postgresql://verdict_app:changeme_local_dev_only@localhost:5432/verdict

# ---- Backend (Fastify API) ----
BACKEND_PORT=4000
BACKEND_PUBLIC_URL=http://localhost:4000
JWT_SECRET=changeme_generate_a_long_random_secret
JWT_EXPIRES_IN=15m
SESSION_REFRESH_SECRET=changeme_generate_a_different_long_random_secret
SESSION_REFRESH_EXPIRES_IN=7d

# ---- Evidence file storage (Fly.io volume path in production) ----
EVIDENCE_STORAGE_PATH=./storage/uploads
EVIDENCE_MAX_FILE_SIZE_MB=25

# ---- GenLayer StudioNet ----
GENLAYER_RPC_URL=changeme_studionet_rpc_url
GENLAYER_CHAIN_ID=changeme_studionet_chain_id
VERDICT_CONTRACT_ADDRESS=changeme_after_deployment
GENLAYER_INDEXER_START_BLOCK=0

# ---- Wallet / WalletConnect (Reown) ----
NEXT_PUBLIC_REOWN_PROJECT_ID=63c579e1124d040f28e2510b67d14dc9

# ---- Frontend (Next.js, exposed to browser -> must be NEXT_PUBLIC_) ----
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_GENLAYER_RPC_URL=changeme_studionet_rpc_url
NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS=changeme_after_deployment
NEXT_PUBLIC_APP_ENV=development

# ---- Fly.io deployment (set as Fly secrets, not committed) ----
FLY_APP_NAME=verdict-backend
"""

README_CONTENT = """\
# VERDICT

**Put money behind your version of reality.**

VERDICT is a platform where two people can turn a real-world disagreement into
a cryptographically enforced case. Parties lock collateral, submit evidence,
GenLayer independently investigates that evidence against a predefined
constitution, and the Intelligent Contract settles the outcome on-chain.

VERDICT is not a betting platform, not a prediction market, and not a vote on
who people believe. It is evidence-driven dispute resolution:

```
DISAGREEMENT -> RULES -> COLLATERAL -> EVIDENCE -> GENLAYER INVESTIGATION -> VERDICT -> SETTLEMENT
```

## Status

Project scaffolding in progress. See `docs/ARCHITECTURE.md` (once written) for
the full system design, and `docs/MEMORY.md` for the running project journal.

## Stack

- **Frontend:** Next.js, Tailwind CSS, shadcn/ui, wagmi/viem, Reown AppKit -> Vercel
- **Backend:** Node.js (TypeScript), Fastify, Postgres (Docker) -> Fly.io (always-on)
- **Contract:** One production GenLayer Intelligent Contract -> GenLayer StudioNet
- **Evidence storage:** Fly.io persistent volume, SHA-256 content hashing

## Directory layout

```
verdict/
|-- frontend/     Next.js app (Vercel)
|-- backend/      Fastify API + Postgres + GenLayer indexer (Fly.io)
|-- contracts/    GenLayer Intelligent Contract (StudioNet)
|-- scripts/      Python automation scripts for all file operations
|-- tests/        Contract, backend, and frontend test suites
|-- docs/         Architecture, security, deployment, GenLayer, API docs
|-- config/       Shared configuration
```

## Development

Setup instructions land here as each phase is implemented. Do not run
anything against production infrastructure without explicit confirmation.
"""

MEMORY_CONTENT = """\
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
- [ ] Step 2: Database schema design.
- [ ] Step 3: GenLayer contract design (requires live docs research).
- [ ] Step 4: Backend implementation.
- [ ] Step 5: Frontend implementation.
- [ ] Step 6: GenLayer integration.
- [ ] Step 7: Evidence system.
- [ ] Step 8: Case lifecycle + escrow.
- [ ] Step 9: Appeals.
- [ ] Step 10: Casebook.
- [ ] Step 11: Constitution governance.
- [ ] Step 12: Testing.
- [ ] Step 13: Security review.
- [ ] Step 14: Deployment (Vercel + Fly.io + StudioNet).
- [ ] Step 15: Post-deployment integration verification.
"""


def write_if_missing(path: Path, content: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        print(f"SKIP  (already exists, not overwritten): {path.relative_to(PROJECT_ROOT)}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {path.relative_to(PROJECT_ROOT)}")


def ensure_directories() -> None:
    for rel_dir in DIRECTORIES:
        dir_path = PROJECT_ROOT / rel_dir
        dir_path.mkdir(parents=True, exist_ok=True)
        gitkeep = dir_path / ".gitkeep"
        if not any(dir_path.iterdir()):
            gitkeep.write_text("", encoding="utf-8")
        print(f"DIR   {dir_path.relative_to(PROJECT_ROOT)}")


def git_init() -> None:
    git_dir = PROJECT_ROOT / ".git"
    if git_dir.exists():
        print("SKIP  git already initialized")
        return
    result = subprocess.run(
        ["git", "init"],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"WARN  git init failed: {result.stderr.strip()}", file=sys.stderr)
    else:
        print("GIT   initialized empty repository")


def main() -> None:
    print(f"Initializing VERDICT project at: {PROJECT_ROOT}\n")
    ensure_directories()
    write_if_missing(PROJECT_ROOT / ".gitignore", GITIGNORE_CONTENT)
    write_if_missing(PROJECT_ROOT / ".env.example", ENV_EXAMPLE_CONTENT)
    write_if_missing(PROJECT_ROOT / "README.md", README_CONTENT)
    write_if_missing(PROJECT_ROOT / "docs" / "MEMORY.md", MEMORY_CONTENT)
    git_init()
    print("\nDone. Run 'git status' inside /Users/macbook/verdict to review the scaffold.")


if __name__ == "__main__":
    main()
