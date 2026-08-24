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
