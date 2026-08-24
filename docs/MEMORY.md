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
