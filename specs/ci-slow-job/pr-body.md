## Summary

- **CI slow-job wired end-to-end** — Supabase local start, integration tests, Playwright at 2 viewports, edge-function deploy proof, type-drift check, rollback EXPLAIN, three cache layers, and secret masking. Fast job stays as-is; slow job gates on real-DB evidence.
- **Migration 012: `profiles` table + signup trigger + backfill** — backs the "added by X" display-name surface across list rows and item detail. Trigger derives first-pass display names from `auth.users.email` local-part; UI lets users edit in `/settings`.
- **`HydratedListEntry.addedByName` hydration** via two-query join (D21 fallback after FK-foreign-schema Supabase quirk; see `CLAUDE.md § Gotchas`). Keeps the payload small and survives RLS constraints.
- **Runtime URL guard (`assertNotProdUrlInTestEnv`)** closes Enforcement #3 from qa-options.md — test-env callers (Vitest, Playwright, CI) can't instantiate a Supabase client pointing at production. Guarded at every `createClient` entry point.
- **Force-create E2E** (PR 5 carry-forward) now runs in CI slow-job with admin-client real-DB assertions — confirms the disambiguation "add as new" escape hatch doesn't silently merge into an existing item.
- **22 spec-time decisions** (D1–D22) documented in `specs/ci-slow-job/spec.md`, including D8 (rotate CI secrets off prod) and D22 (runtime URL guard).
- **Auto-deploy workflows for migrations + edge functions** (folded in 2026-04-25) — `.github/workflows/deploy-migrations.yml` + `deploy-functions.yml` fire on push:main with path filters; sed-derive project ref from the `SUPABASE_PROD_URL` GH Variable. Closes the manual `supabase db push` / `supabase functions deploy` gap.
- **CI/prod credential separation** (folded in 2026-04-25) — CI fast/slow jobs use local-stack defaults for Supabase URL/anon/service-role; only the deploy workflows touch prod credentials. Slow-job has a JWT-issuer assertion that aborts if `SERVICE_ROLE_KEY` ever resolves to the prod admin token. CLAUDE.md gotcha entry documents the full contract.

Spec + decisions: [`specs/ci-slow-job/spec.md`](https://github.com/meirmsn/lalista/blob/feature/ci-slow-job/specs/ci-slow-job/spec.md) · Pre-ship review: [`review.md`](https://github.com/meirmsn/lalista/blob/feature/ci-slow-job/specs/ci-slow-job/review.md) · Task log: [`tasks.md`](https://github.com/meirmsn/lalista/blob/feature/ci-slow-job/specs/ci-slow-job/tasks.md)

![sign-in](https://github.com/meirmsn/lalista/raw/feature/ci-slow-job/specs/ci-slow-job/hero/sign-in.png)
![list](https://github.com/meirmsn/lalista/raw/feature/ci-slow-job/specs/ci-slow-job/hero/list.png)
![settings](https://github.com/meirmsn/lalista/raw/feature/ci-slow-job/specs/ci-slow-job/hero/settings.png)
![item detail](https://github.com/meirmsn/lalista/raw/feature/ci-slow-job/specs/ci-slow-job/hero/item.png)

## Test plan

- [x] `pnpm turbo run lint typecheck test:unit build` — green (239 unit tests passing at `5378ae4`; pre-commit hooks ran lint+typecheck on every commit; `build` may flake locally on Google Fonts network, rely on CI)
- [x] Playwright spec parses (`npx playwright test --list`) — force-create E2E + qa-walk specs present, pre-ship parse check passed
- [x] Fast-job CI green — green on `411d5a9` via run [24951474621](https://github.com/meirmsn/lalista/actions/runs/24951474621). Note: passed without the pre-merge Variable/Secret setup because fast-job's env block is mostly inert (Next.js build is permissive about empty `NEXT_PUBLIC_*`; lint/typecheck/test:unit don't need Supabase).
- [x] Slow-job CI green — green on the same run; new "Verify SERVICE_ROLE_KEY is local-stack default" step (de76c62) executed and passed; slow-job sources values from `supabase status -o env` at runtime so unset Variables don't break it.
- [x] Vercel preview deploys successfully — Ready per Vercel bot's PR comment, [preview URL](https://lalista-git-feature-ci-slow-job-meirs-projects-4803a76a.vercel.app) (deploy timestamp matches latest commit).
- [ ] Visual audit at 375 + 1440, light + dark
- [ ] Live QA walkthrough of 5-verb user story (add / disambiguate / edit / mark bought / settings)
- [x] D22 URL guard enforces: prod URL + test env → throw (5 unit tests in `packages/core/src/supabase.test.ts`, green at branch HEAD)

## Pre-merge actions

CI fast-job + slow-job pass even with most of the new state unset (the `add-item` function gracefully skips its NLP path when `ANTHROPIC_API_KEY` is empty; `SUPABASE_DB_PASSWORD` isn't read by `ci.yml` at all). What you actually need to configure is split by who consumes it. Three tiers below.

### Tier 1 — Required for post-merge auto-deploy to work (set BEFORE merging)

Without these, `deploy-migrations.yml` fires on the push:main and fails red. Recoverable via re-run after the fix (see § Recovery if auto-deploy fails), but cleaner to set first time:

- [ ] GH Variable `SUPABASE_PROD_URL` = `https://nzfdfjctpotjyuxdfcpw.supabase.co` — used by **both** deploy workflows to derive the project ref
- [ ] GH Secret `SUPABASE_DB_PASSWORD` — Supabase Settings → Database → connection string password (`deploy-migrations.yml` only)
- [ ] GH Secret `SUPABASE_ACCESS_TOKEN` — supabase.com/dashboard/account/tokens (both deploy workflows; `supabase link` auth)

### Tier 2 — Recommended for hygiene + future-proofing (set anytime)

The cleanup migrates the public Supabase values from Secrets → Variables and renames the local-stack defaults. Functionally CI passes either way (fast-job's env block is mostly inert; slow-job derives values from `supabase status -o env` at runtime). Set these so the GH state matches what `/ak-new-project § Security Posture` documents and so a future workflow change doesn't surprise you:

- [ ] GH Variable `SUPABASE_URL` = `http://127.0.0.1:54321` (local-stack URL)
- [ ] GH Variable `SUPABASE_ANON_KEY` = local-stack default JWT (run `supabase start` and copy `anon key:` line — same value across every Supabase install)
- [ ] GH Variable `SUPABASE_SERVICE_ROLE_KEY` = local-stack default JWT (`supabase start` output's `service_role key:` line)
- [ ] GH Variable `NEXT_PUBLIC_POSTHOG_KEY` = the PostHog key (move from Secret if currently there)
- [ ] Delete legacy Secrets after Variables are set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`
- [ ] Delete legacy Variable `SUPABASE_PROJECT_REF` if present (superseded by `SUPABASE_PROD_URL` sed-derive)

### Tier 3 — Optional (set if you want the test coverage)

- [ ] GH Secret `ANTHROPIC_API_KEY` — console.anthropic.com. The `add-item` function calls Claude only when this key is set AND the utterance hits a Spanish word in `isLikelyEnglish`'s heuristic. If unset, the function skips NLP and relies on trigram matching against `items` — which already covers the slow-job E2E test's "leche" → "Leche lactaid" path via `seed.sql`. Setting the key gets the bilingual NLP code path actually exercised in CI; leaving it unset means slow-job passes but the NLP path is uncovered.

## Recovery if post-merge auto-deploy fails

If `deploy-migrations.yml` or `deploy-functions.yml` runs red post-merge (e.g., a Tier 1 secret was unset, a typo in `SUPABASE_PROD_URL`, or a transient Supabase API hiccup):

**Most cases — re-run from the Actions UI:**

1. Fix the underlying config (set the missing Secret/Variable, correct the typo, retry the API)
2. Actions tab → click into the failed run → "Re-run failed jobs" or "Re-run all jobs"
3. The workflow re-reads Secrets/Variables at job-start time — picks up your fix without needing another push

`supabase db push` is idempotent for migrations not yet applied (tracked in `supabase_migrations.schema_migrations`), and `supabase functions deploy` overwrites on each call, so re-running from a clean failure state is safe.

**Manual fallback** — for cases where the failure left prod in a half-applied state, or you want to bypass GH entirely: run from your devcontainer:

```bash
PROJECT_REF=$(echo "$SUPABASE_PROD_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')
supabase link --project-ref "$PROJECT_REF"
supabase db push --include-roles   # for migrations
# OR
for fn in supabase/functions/*/; do
  fn=$(basename "$fn")
  case "$fn" in _*) continue ;; esac
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done
```

This uses the values in your `.devcontainer/.env` (which already has prod URL + DB password from the original Step 4 setup).

## Post-merge actions

- [ ] **Migration 012 auto-applies via `deploy-migrations.yml`** when push:main fires — verify the workflow run lands green in the Actions tab. If red: see § Recovery if auto-deploy fails.
- [ ] Flip branch protection on `main` to require both `fast` AND `slow` status checks (Settings → Branches).

The previous "Optional: rotate `SUPABASE_URL` / `SUPABASE_ANON_KEY` off prod" todo from D8/D22 is now structural — done by the cleanup commits in this PR. CI never holds prod-grade Supabase credentials except `SUPABASE_PROD_URL` (deploy workflows only) + `SUPABASE_DB_PASSWORD` + `SUPABASE_ACCESS_TOKEN`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
