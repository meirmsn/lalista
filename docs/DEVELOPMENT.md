# Developing lalista

Voice-first bilingual grocery list app.

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

Two jobs, both defined in `.github/workflows/ci.yml`.

### `fast` — every push

Runs on every branch push. Blocks PR merge.

- `pnpm turbo run lint typecheck test:unit build`
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
