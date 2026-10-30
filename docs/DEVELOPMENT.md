# Developing lalista

Developer notes for lalista, a bilingual grocery list web app (voice-first is the goal; see the [README](../README.md) for status).

## Documentation

- [`OVERVIEW.md`](../OVERVIEW.md) — product map: what lalista does, who uses it, core flows, features
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system map: components, data flow, deployment topology, module map
- Per-package READMEs: [`apps/web/README.md`](../apps/web/README.md), [`packages/core/README.md`](../packages/core/README.md), [`packages/ui/README.md`](../packages/ui/README.md), [`supabase/functions/README.md`](../supabase/functions/README.md)
- [`PLAN.md`](../PLAN.md) — what's being built right now · [`BUILD-LOG.md`](../BUILD-LOG.md) — what's shipped · [`PRODUCT-ROADMAP.md`](../PRODUCT-ROADMAP.md) — long-term

## Development

1. Open in VS Code and select **Reopen in Container**
2. Run `claude` in the terminal

### Commands

- `pnpm turbo run test:unit` — fast test loop
- `pnpm turbo run test` — full test suite
- `pnpm db:start` — bring up the local Supabase stack (runs in the `supabase-runner` sibling compose container; relays through `pnpm db:reset` / `db:status` / `db:stop` / `db:gen-types`)
- `pnpm test:integration` — Supabase-backed integration tests (requires the local stack from `pnpm db:start`)
- `pnpm turbo run build` — production build
- `pnpm turbo run dev` — dev server

> Without the devcontainer: `pnpm install && pnpm turbo run dev`

### Local URLs (devcontainer)

After `pnpm db:start` + `pnpm turbo run dev`, these are reachable from your macOS browser:

- Dev server: http://localhost:3000
- Supabase API gateway: http://127.0.0.1:54321
- Supabase Studio: http://127.0.0.1:54323/project/default
- Mailpit (local email inbox): http://127.0.0.1:54324

> Before shipping a DB migration, open Studio's **Advisor** (Database → Advisor). It surfaces RLS / `search_path` / missing-FK-index findings against your local stack — run `pnpm db:reset` first so Studio sees the latest migration's effect (Studio caches advisor state across runs). The hosted Advisor against prod runs separately after deploy.

### Migrations

See `CLAUDE.md § Migration Workflow` for the `supabase migration new` →
`supabase db reset` → `supabase db push` → `supabase gen types` loop.
The CI slow-job validates that committed types stay in lockstep via
`scripts/ci-type-drift.sh` and that every `-- ROLLBACK:` block parses +
round-trips via `scripts/ci-rollback-explain.sh`.

## CI

Three jobs, all defined in `.github/workflows/ci.yml`: `fast` and `slow` check every PR, and `deploy` ships `main`.

### `fast` — every push

Runs on every branch push. Blocks PR merge.

- `pnpm turbo run lint typecheck test:unit build`
- `scripts/deploy.test.sh` (the deploy script, against a fake wrangler and curl)
- Gitleaks scan of the push range

**Required GitHub Secrets:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_POSTHOG_KEY`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`. After PR 4,
`SUPABASE_URL` + `SUPABASE_ANON_KEY` are rotated to `http://127.0.0.1:54321`
and the stock Supabase local-stack anon JWT — unit tests that touch the
client now fail loudly (`ECONNREFUSED`) rather than silently hitting prod.

### `slow` — PRs to main only

Gated on `fast` passing. Brings up a real Supabase stack in the GH-Actions
runner (native Docker, no DinD) and runs:

- `supabase start` → `supabase db reset` (applies migrations + seed)
- `supabase functions deploy add-item --no-verify-jwt` (local only)
- `pnpm test:integration` (Vitest, `*.integration.test.ts` glob)
- `scripts/ci-type-drift.sh` — regenerate `packages/core/src/supabase.types.ts`
  against the local schema and fail on drift
- `scripts/ci-rollback-explain.sh` — for each migration with a `-- ROLLBACK:`
  block, EXPLAIN each statement against local Postgres + round-trip apply/revert
- Next.js build + Playwright E2E at mobile (375) + desktop (1440)
- Uploads `playwright-report/` + `test-results/` on failure

**Required GitHub Secrets (beyond the fast job):** `SUPABASE_SERVICE_ROLE_KEY`
(admin client for integration test setup/teardown), `ANTHROPIC_API_KEY_QA`
(consumed by the locally-served add-item edge function for Claude NLP calls
during integration tests — re-exported as `ANTHROPIC_API_KEY` inside the test
step's env block; the prod key lives in `ANTHROPIC_API_KEY_PROD` and is pushed
to Supabase project secrets by `deploy-functions.yml`). See `CLAUDE.md
§ Anthropic API key split`.

Three caches speed up repeated runs: pnpm store, Turborepo outputs, and
Playwright browsers. Keys hash `pnpm-lock.yaml`.

**Expected wall time:** ~6-8 min warm, ~10-12 min cold.

The Playwright suite runs against the Cloudflare Worker build (`pnpm build:worker`, then
`wrangler dev` via `E2E_TARGET=worker`), the runtime production uses. Locally,
`pnpm --filter @lalista/web preview:worker` builds and serves the same Worker.

### `deploy` — push to `main` only

Runs `scripts/deploy.sh` in the GitHub `production` environment (deployment branch rule:
`main` only): builds the app with OpenNext, records the live version, deploys the `lalista`
Worker with wrangler, then smoke-checks that `/build.txt` is the commit and `/` renders.
The job summary has the new version, the one it replaced and the line that undoes it.
It reads, from the `production` environment:

- secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit only) and, optionally,
  `SENTRY_AUTH_TOKEN` (source maps);
- variables `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_PROD_URL`, `SUPABASE_PROD_ANON_KEY`, and
  optionally `SITE_URL` (the custom domain: invite links and the domain smoke check),
  `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `SENTRY_ORG`.

`deploy-migrations.yml`, `deploy-functions.yml` and `keepalive.yml` also run in `production`
and read `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY_PROD`,
`SUPABASE_PROD_URL` and `SUPABASE_PROD_ANON_KEY` from it.
