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

**Deployed by the user, never automated** — see `contracts/README.md` for
the full, current deployment walkthrough (prerequisites, `genlayer deploy`
invocation, verification steps, and how to obtain the resulting contract
address). Current production address:
`0x41e2bD175ce730ec613e5977a069dC5061A271E2` ("v6" — see
`contracts/README.md` for what changed across versions).

Once you have a new address, wire it into:

- `backend/.env` (`VERDICT_CONTRACT_ADDRESS`, `GENLAYER_RPC_URL`)
- `frontend/.env.local` (`NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS`,
  `NEXT_PUBLIC_GENLAYER_RPC_URL`)
- Fly.io secrets: `flyctl secrets set VERDICT_CONTRACT_ADDRESS=... --app verdict-backend`
- Vercel environment variables: `vercel env add NEXT_PUBLIC_VERDICT_CONTRACT_ADDRESS production`,
  then `vercel --prod`, then re-alias: `vercel alias set <new-deploy-url> ver-dict.vercel.app`

Then verify end-to-end, in this order, with real calls rather than assuming
success from a green deploy log:

1. **Real read**: `genlayer schema <address>` — confirms the contract loads
   and every method's parameter list matches the checked-in source exactly
   (this catches a stale-deploy mismatch immediately). Before relying on
   any read result, confirm `genlayer --version` — the global CLI has
   been observed to silently auto-update mid-session to a broken release
   candidate that fails every read against every contract with a generic
   `exit_code 1` error; if reads that worked earlier suddenly all fail
   identically, check the CLI version before assuming the contract is
   broken (`npm install -g genlayer@0.39.2` is the last confirmed-working
   version as of this writing).
2. **Real write**: submit a real transaction (case creation is the natural
   first one) and confirm the receipt's actual **result** field
   (`result_name`/`resultName`, e.g. `MAJORITY_AGREE`), not just its
   **status** field (`status_name`/`statusName`, e.g. `FINALIZED`) —
   a genuinely disagreed consensus round (`MAJORITY_DISAGREE`) still
   reaches `FINALIZED` status, so checking status alone can silently
   treat a real disagreement as success. Confirmed the hard way: an
   earlier test script that checked only status caused 3 duplicate cases
   before this was caught (see `docs/SECURITY.md` "v5 contract: 2-test
   round").
3. **Indexer pickup**: confirm the resulting state change reaches
   Postgres — `curl https://verdict-backend.fly.dev/cases/<id>` and check
   `status` matches the on-chain value. If it doesn't update within a
   couple of minutes, check `flyctl logs --app verdict-backend | grep
   indexer` for the StudioNet daily-quota signature (see
   `docs/GENLAYER.md` "Rate limiting") before assuming something else is
   broken.
4. **Frontend reflects it**: load the case on
   [ver-dict.vercel.app](https://ver-dict.vercel.app) and confirm the
   displayed status/data matches. Verify the deployed JS bundle actually
   contains the new contract address by grepping it directly — `vercel env
   pull` has been observed to show `NEXT_PUBLIC_*` values as empty
   strings in this project regardless of what's actually stored, so it is
   not a reliable way to confirm the env var took.

**If you're redeploying over an address that already has case data**,
either accept that old-contract cases are retired test artifacts (the
indexer will just stop finding new state for them), or clear them from
Postgres explicitly with `backend/src/db/clear_all_cases.ts`:

```bash
cd backend && npm run build
flyctl ssh console --app verdict-backend --command "node dist/db/clear_all_cases.js"
```

## Environment variable reference

See `.env.example` at the project root for the full list with inline
comments. Never commit a filled-in `.env` / `.env.local`.
