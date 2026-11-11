# Developing lalista

Developer notes for lalista, a bilingual grocery list web app (voice-first is the goal; see the [README](../README.md) for status).

## Documentation

- [`OVERVIEW.md`](../OVERVIEW.md) — product map: what lalista does, who uses it, core flows, features
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system map: components, data flow, deployment topology, module map
- Per-package READMEs: [`apps/web/README.md`](../apps/web/README.md), [`packages/core/README.md`](../packages/core/README.md), [`packages/ui/README.md`](../packages/ui/README.md), [`supabase/functions/README.md`](../supabase/functions/README.md)
- [`PLAN.md`](../PLAN.md) — what's being built right now · [`BUILD-LOG.md`](../BUILD-LOG.md) — what's shipped · [`PRODUCT-ROADMAP.md`](../PRODUCT-ROADMAP.md) — long-term

## Development

Needs Node 22 (`.nvmrc`), pnpm 10, Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli) 2.98.2 (the version every workflow pins).

### Commands

- `scripts/setup.sh` — install the workspace's packages (`pnpm install --frozen-lockfile`)
- `pnpm turbo run test:unit` — fast test loop
- `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` — the local Supabase stack (`supabase start` / `stop` / `status`)
- `pnpm db:reset` — re-apply the migrations and the seed (`supabase db reset`)
- `pnpm db:gen-types` — regenerate `packages/core/src/supabase.types.ts` from the local stack
- `pnpm test:integration` — Supabase-backed integration tests (needs the local stack)
- `pnpm turbo run dev` — dev server
- `scripts/check-fast.sh origin/main` — the fast tier, as CI runs it; run it before pushing
- `scripts/build.sh` — build the Worker (OpenNext) that `scripts/local-run.sh` serves
- `scripts/local-run.sh` — serve that build on `127.0.0.1:$PORT` (run `scripts/build.sh` first)

### Local URLs

After `pnpm db:start` + `pnpm turbo run dev`:

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

`.github/workflows/ci.yml`, in the devshop's two tiers: `fast` and `slow` check every PR and every push to `main` (both are the required checks), and `deploy` ships `main` after both pass. What each tier checks lives in a script, so it runs the same locally.

### `fast` — `scripts/check-fast.sh`

- the PR title starts with a Conventional Commit type (`scripts/pr-title-check.py`)
- the secret scan since the base (`scripts/secret-scan.sh`, gitleaks pinned in `ci.yml`)
- the spec check over `specs/*.md`, each acceptance item named by a test (`scripts/spec-check.py`)
- the project contract check (`scripts/contract-check.py`)
- `scripts/lint.sh`: ESLint, typecheck, and Prettier on the changed files
- `pnpm turbo run test:unit build`, `scripts/deploy.test.sh`, `scripts/repo-shape.test.sh`

It reads the GitHub Variables `SUPABASE_URL` + `SUPABASE_ANON_KEY` (the local stack's
`http://127.0.0.1:54321` and its stock anon JWT, so a unit test that touches the client fails
loudly instead of reaching production), `NEXT_PUBLIC_POSTHOG_KEY`, and the secrets `SENTRY_DSN`,
`SENTRY_AUTH_TOKEN`.

### `slow` — `scripts/check-slow.sh`

Needs `fast`. The job's setup steps bring up a real Supabase stack in the runner (native Docker),
check that its service-role key is the local default, and install Playwright's browsers; then the
script runs:

- `pnpm test:integration` (Vitest, `*.integration.test.ts`), with the locally served `add-item`
  edge function calling Claude through `ANTHROPIC_API_KEY_QA` (re-exported as `ANTHROPIC_API_KEY`;
  the production key never reaches CI's tiers)
- `scripts/ci-type-drift.sh` and `scripts/ci-rollback-explain.sh`
- the Worker build (`scripts/build.sh`), then Playwright at mobile and desktop against it in
  `wrangler dev` (`E2E_TARGET=worker`), the runtime production uses

It uploads `playwright-report/` + `test-results/` on failure. It takes about 8 minutes, and a merge's
deploy waits for it.

### `deploy` — push to `main` only

Runs `scripts/deploy.sh` in the GitHub `production` environment (deployment branch rule:
`main` only): builds the app with OpenNext, records the live version, deploys the `lalista`
Worker with wrangler, then smoke-checks that `/build.txt` is the commit and `/` renders.
The job summary has the new version, the one it replaced and the line that undoes it.
It reads, from the `production` environment:

- secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit only) and, optionally,
  `SENTRY_AUTH_TOKEN` (source maps);
- variables `CLOUDFLARE_ACCOUNT_ID` (a secret of that name also works; the variable wins),
  `SUPABASE_PROD_URL`, `SUPABASE_PROD_ANON_KEY`, and
  optionally `SITE_URL` (the custom domain: invite links and the domain smoke check),
  `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `SENTRY_ORG`.

`deploy-migrations.yml`, `deploy-functions.yml` and `keepalive.yml` also run in `production`
and read `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY_PROD`,
`SUPABASE_PROD_URL` and `SUPABASE_PROD_ANON_KEY` from it.
