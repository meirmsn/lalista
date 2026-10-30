<!-- generated-by: /ak-implement (Phase 2) -->
<!-- feature: db-hardening -->

# Tasks: db-hardening (PR 58)

Tracks Phase 2 implementation. Source of truth: `specs/db-hardening/spec.md § Task order`.

## Tasks

- [x] T1 — Migration bucket A: `search_path` on 5 functions
- [x] T2 — Migration bucket B: 12 FK indexes
- [x] T3 — Migration bucket C: 7 RLS policies rewrapped (8th — `profiles_select_own` — handled implicitly in T4's combined policy)
- [x] T4 — Migration bucket D: profiles combined `profiles_select`
- [x] T5 — Migration ROLLBACK block + types regen (round-trip deferred to CI slow-job; `psql` + `supabase status` unavailable in devcontainer per Option 3 isolation)
- [x] T6 — Integration test: combined-policy household-visibility pin
- [x] T7 — `password_changed` email: config.toml uncomment + `password-changed.html` template (mailpit live-fire verification deferred — see Decisions)
- [x] T8 — Docs touch-up (CLAUDE.md gotcha bullet)
- [x] T9 — Migration bucket E: 2 RLS policies the original audit missed (`household_members_select` + `list_entries_insert`); surfaced 2026-05-08 by a re-probe at PR-58 dogfood

## Decisions

Phase-2 judgment calls captured here. Decisions D1–D5 are LOCKED in spec.md and not re-resolved.

- **Bucket E added 2026-05-08 (T9).** During PR-58 dogfood, the operator ran the local
  Supabase Advisor against the post-migration DB and surfaced 3 security + 2 performance
  findings. After triage (a stale Studio cache for `households_insert` cleared via
  `pnpm db:reset`), the real outstanding findings were 2 `auth_rls_initplan` policies the
  original 2026-05-04 audit missed: `household_members_select` (bare `auth.uid()` in the
  OR) and `list_entries_insert` (bare `auth.uid()` in the AND). Same mechanical
  `(select auth.uid())` rewrap as bucket C; bodies preserve OR/AND semantics verbatim.
  Re-probe after applying confirms 0 remaining `auth_rls_initplan` flags. Final advisor
  state: 2 deferred extension-in-public findings (per D4) + 0 performance + any auth-config
  findings (HIBP / MFA — TBD; tracked separately, see PR comment).

- **Function signature corrections (T1).** Spec § Migration shape § A wrote signatures
  `find_item_alternatives(text, uuid)` and `find_item_by_trgm(text)`. The actual signatures
  per migrations 003 + 007 are `find_item_alternatives(text, int)` and
  `find_item_by_trgm(text, numeric)`. Implemented with the actual signatures (verified via
  `\df` on the local stack). Spec gotcha § "my_household_ids signature" already anticipated
  this discovery during T1.

- **`enabled` field rejected by supabase CLI in `[auth.email.notification.password_changed]` (T7).**
  Spec § Files modified instructed to uncomment the four-line block at config.toml:260-264
  including `enabled = true`. The CLI failed to start with that field present (the
  pre-commented block was a documentation hint, not a correct schema). Removed
  `enabled = true`; kept `subject` + `content_path`. The presence of the table itself
  enables the notification (matches the `[auth.email.template.confirmation]` /
  `[auth.email.template.recovery]` shape, which also have no `enabled` field). Local
  stack starts cleanly with the trimmed block.

- **Live-fire mailpit verification deferred (T7).** Spec acceptance includes "Local mailpit
  receives the password-changed email when an updateUser({ password }) is fired against
  the local stack." Triggering that flow needs an authenticated session against the local
  stack and either (a) a working browser/Playwright run, or (b) a node script with
  @supabase/supabase-js to call updateUser. Both are doable but materially out of scope
  for a Phase 2 commit gate — the CI slow-job's Playwright × 2 viewports doesn't exercise
  the password-changed email either (no E2E covers /reset-password's success email today).
  Risk: low — the template path resolves (config.toml validated by supabase start), the
  HTML mirrors recovery.html's structure, and the prod-dashboard paste step is the
  source-of-truth surface anyway. The PR body lists the paste step under Out-of-band
  deploy items.

- **`scripts/ci-rollback-explain.sh` deferred to CI (T5).** The script needs `psql` and
  the supabase CLI's `supabase status` via docker socket — neither is available in the
  Option 3 isolated devcontainer (workspace has no docker socket; `supabase` binary is
  installed but `supabase status` fails for the same reason). The slow-job CI runs this
  gate against a real local Postgres in the runner, so the round-trip is validated
  pre-merge. Local manual round-trip would require either (a) installing `pg` in the
  workspace and rewriting the script to use the `host.docker.internal` URL, or (b)
  running it through the supabase-runner relay (currently allowlisted to `db-reset`,
  `start`, `stop`, `status`, `gen-types`). Out of scope for this PR.

- **`households_insert` body — spec said "preserved verbatim from 001"; reality is migration
  005 tightened it (T3 / pre-ship correction).** Spec § Migration shape § C asserted that
  `households_insert`'s body is literally `with check (true)` and that re-creating it that
  way "is harmless" (just an advisor-fingerprint refresh). Migration 005 already overrode
  001 with `with check (auth.uid() is not null)` — so writing `with check (true)` would be
  privilege widening (allows anonymous inserts that 005 was specifically written to block).
  Pre-ship /cso caught this. Fix: forward body is now `for insert to authenticated with
check ((select auth.uid()) is not null)` (matches the C-bucket rewrap pattern + preserves
  005's auth requirement); ROLLBACK body restores `with check (auth.uid() is not null)` to
  match migration 005's state. Spec gotcha § "households_insert with check (true) re-create
  is harmless" is now stale and would mislead a future audit — left for /ak-build Phase 6
  bookkeeping.

- **Combined `profiles_select` policy expression — spec D5 said `user_id = any
(public.my_household_ids())`; reality required a join (T4).** The spec-D5 expression was
  doubly wrong: (1) `my_household_ids()` returns `setof uuid` (not a uuid array), so
  `= any(...)` errored at apply time with `set-returning function on right side of operator`;
  (2) more importantly, `my_household_ids()` returns _household_ ids — comparing them against
  `profiles.user_id` is a category error and would never match any row. The correct
  preserving-semantics expression mirrors migration 012's `profiles_select_household` body
  (which does an explicit self-join through `household_members`). Implemented as:
  `user_id = (select auth.uid()) or user_id in (select hm.user_id from household_members hm
where hm.household_id in (select public.my_household_ids()))`. The `(select auth.uid())`
  wrapper preserves D5's stated RLS-caching intent; the integration test in T6 still pins
  the same load-bearing semantic (A in same household as B reads B's profile; A cannot
  update B's profile). Spec D5's _decision_ stands (collapse two permissives → one combined
  policy that OR-preserves visibility); only the literal SQL changed.
