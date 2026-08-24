# VERDICT — Deployment

## Frontend -> Vercel

Production URL: **https://ver-dict.vercel.app**

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_BASE_URL production
vercel env add NEXT_PUBLIC_REOWN_PROJECT_ID production
vercel env add NEXT_PUBLIC_GENLAYER_RPC_URL production
vercel env add NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS production
vercel --prod
vercel alias set <the-new-deployment-url-printed-above> ver-dict.vercel.app
```

`vercel --prod` publishes a new unique `verdict-<hash>-....vercel.app` URL
each time — it does NOT automatically move the `ver-dict.vercel.app` alias
to point at it. Re-run the `vercel alias set` command above after every
production deploy (with that deploy's printed URL) to keep
`ver-dict.vercel.app` current. Attaching `ver-dict.vercel.app` as this
Vercel project's actual primary domain (Project Settings -> Domains, in the
dashboard) would make this automatic, but wasn't set up that way here — the
CLI has no subcommand for assigning a `*.vercel.app` subdomain as a
project's primary domain, only for domains you own via external DNS.

Preview deployments happen automatically on every push once the Vercel
project is linked to the GitHub repo (github.com/zoefunds/verdict). The
backend's `CORS_ORIGIN` (`backend/fly.toml`) is locked to
`https://ver-dict.vercel.app`, so requests from any other origin (including
an un-aliased fresh deploy URL) will be rejected by CORS.

Also note: a freshly linked Vercel project can mis-detect the framework
(this happened once during setup, when the project was accidentally linked
from `backend/` first and got tagged "Fastify") — `frontend/vercel.json`
pins `"framework": "nextjs"` explicitly to prevent that regressing.

If the deployment is unexpectedly returning a 302 to
`vercel.com/sso-api?...` instead of the app, deployment protection got
re-enabled — disable it with:
```bash
vercel project protection disable verdict --sso --scope <your-scope>
```

## Backend -> Fly.io

The backend is configured for **always-on** operation
(`backend/fly.toml`: `min_machines_running = 1`, `auto_stop_machines =
false`, HTTP health checks against `/health` with automatic restart on
failure).

```bash
cd backend
flyctl auth login              # authenticate with the correct Fly account
flyctl apps create verdict-backend
flyctl volumes create verdict_evidence_data --size 3 --region iad
flyctl secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="$(openssl rand -hex 32)" \
  SESSION_REFRESH_SECRET="$(openssl rand -hex 32)" \
  GENLAYER_RPC_URL="https://studio.genlayer.com/api" \
  VERDICT_CONTRACT_ADDRESS="<from contract deployment>"
flyctl deploy
```

For genuine "never die" resilience beyond a single machine, scale to two
machines across regions:

```bash
flyctl scale count 2 --region iad,ord
```

## Database

Local dev: `docker compose up -d postgres`, then `npm run db:generate &&
npm run db:migrate` inside `backend/`.

Production: either a managed Postgres attached to the Fly app
(`flyctl postgres create`) or an external managed Postgres — set
`DATABASE_URL` as a Fly secret either way. Run
`npm run db:migrate` against production before the first deploy that needs
the new schema.

## GenLayer contract -> StudioNet

**Deployed by the user, not by Claude** — see `contracts/README.md` for the
full, current deployment walkthrough (prerequisites, `genlayer deploy`
invocation, verification steps, and how to obtain the resulting contract
address). Once you have the address, provide it and I will wire it into:

- `backend/.env` (`VERDICT_CONTRACT_ADDRESS`, `GENLAYER_RPC_URL`)
- `frontend/.env.local` (`NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS`,
  `NEXT_PUBLIC_GENLAYER_RPC_URL`)
- Fly.io secrets (`flyctl secrets set VERDICT_CONTRACT_ADDRESS=...`)
- Vercel environment variables

...and then we'll verify end-to-end: a real view call succeeds, a real
write call (case creation) succeeds, the indexer picks up the resulting
state change, and the frontend reflects it.

## Environment variable reference

See `.env.example` at the project root for the full list with inline
comments. Never commit a filled-in `.env` / `.env.local`.
