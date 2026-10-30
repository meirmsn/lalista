<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: ci-slow-job -->
<!-- date: 2026-04-23 -->

# Spec: ci-slow-job (PR 4)

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1g` — primary scope: packages/core unit tests, apps/web component tests, Playwright E2E, CI slow-job wiring (Supabase integration + Playwright at two viewports + edge-fn deploy + type drift + rollback SQL validation + branch protection + caching + secrets), post-merge secrets rotation (item 4).
- `PRODUCT-ROADMAP.md § v0 § 1h` — carry-forward: posted-by-someone bug fix, TODOS.md cleanup, README update, `/document-release`.
- `TODOS.md § v0 § posted-by-someone` — 7-step implementation plan for the display-name fix (profiles table + RLS + trigger + backfill + sign-up form + hydration + Settings).
- `PLAN.md § Planned` row #1 (`ship`) — PR 4 assignment (§ 1g + § 1h).
- `/devshop/kit/notes/roadmap/qa-options.md` — QA backend isolation context. Decision log says "Run PR 4 as scoped. Don't broaden it to absorb dev-side fixes."
- `specs/disambig-add-new/spec.md § Tests § Edge-function integration` — PR 5 force-create E2E carry-forward (deferred there because PR 5 had no slow-job CI to deploy the edge function against).
- `CLAUDE.md § Gotchas` — edge function deploy discipline, RLS-bypass writes principle (least privilege), migration 009 nullable `added_by` context.
- Prior spec `specs/disambig-add-new/spec.md` — style + structure reference.

PR 4 closes v0 quality-gate readiness: wires the long-planned CI slow-job
(Supabase + integration tests + Playwright E2E + edge-fn deploy against
local Supabase, so CI becomes the authoritative test bed instead of the
hosted prod Supabase the admin-API fallback has been polluting), lands
the `profiles` table + display-name plumbing so the list stops rendering
every authored row as "added by someone," closes the PR 5 force-create
E2E carry-forward, and syncs docs via `/document-release`. Unblocks the
subsequent devshop-side PR 5 (preship hardening — including the
dev-container DiD fix that closes the other half of the hosted-Supabase
QA leak).

---

## Decisions (resolved at spec time)

18 `/ak-spec`-time decisions resolved in Phase 0 (defaulted per roadmap /
qa-options / TODOS specifications; user may flip any by editing the
Decisions section before Phase 1 runs). Phase 1 preserves this section
verbatim.

### D1: Combine § 1g + § 1h in a single PR?

**Decision:** Yes. Keep the full PR 4 scope (CI slow-job + carry-forward posted-by-someone + TODOS/README update + `/document-release`) in one PR.

**Rationale:** `PLAN.md` row #1 assigns both to PR 4; `qa-options.md` decision log is explicit ("Run PR 4 as scoped. Don't broaden it to absorb dev-side fixes") — preserving the bundle. Splitting creates coordination overhead (two PRs must ship before v0 GA) without changing risk profile. The two concerns share CI as a dependency: posted-by-someone migration + trigger + RLS wants integration-test coverage, which is itself part of § 1g.

### D2: Supabase in CI slow-job: `supabase start` inside GitHub Actions runner?

**Decision:** Yes — `supabase/setup-cli@v1` + `supabase start` inside the job. No DiD gymnastics.

**Rationale:** GitHub Actions runners have native Docker (unlike the devcontainer, where DiD is inert per `qa-options.md § Current state`). The full Supabase stack (Postgres + GoTrue + Realtime + Edge runtime) runs against `127.0.0.1` inside the job — highest realism at zero cost. `PRODUCT-ROADMAP.md § 1g` is explicit.

### D3: Edge function deploy in slow-job — local Supabase only?

**Decision:** Yes. `supabase functions deploy <fn>` against the local Supabase started in the job. CI never touches prod edge functions.

**Rationale:** `CLAUDE.md § Gotchas` (edge-function deploy discipline): prod deploy is explicit and manual via `supabase functions deploy <name>` in a privileged shell. CI deploying to local-only ensures the E2E exercises the new branch code (not the stale deployed version) without introducing a CI path that could reach prod.

### D4: Carry-forward force-create E2E from PR 5?

**Decision:** Yes. Add `apps/web/e2e/add-new.spec.ts` (or extend existing `core-flows.spec.ts`) that types a uniquely-not-in-DB utterance (`xyzzy-test-{timestamp}`), clicks the add-new row in DisambiguationSheet, confirms, asserts both a new `items.name_canonical` row and a `list_entries` row via Supabase client.

**Rationale:** `§ 1g` lists this as an explicit carry-forward from PR 5; PR 5's spec deferred it because no slow-job existed. Exercises edge-fn `force_create_with_label` branch + `23505` unique-violation race fallback under real DB conditions.

### D5: posted-by-someone approach — per TODOS.md § posted-by-someone?

**Decision:** Yes. Implement the 7-step plan verbatim: (1) migration 010 creating `profiles (user_id PK FK auth.users ON DELETE CASCADE, display_name text not null, created_at)`; (2) RLS: own-row rw + household-member display_name readable via `household_members` join; (3) trigger on `auth.users` insert that inserts `profiles` with `display_name` from `raw_user_meta_data.display_name` falling back to email local-part; (4) backfill migration for existing users using email local-part; (5) sign-up form adds an optional "Your name" input, passed through `auth.signUp({ options: { data: { display_name }}})`; (6) `fetchListEntries` in `packages/core/src/api/items.ts` joins `profiles` on `added_by` and returns `addedByName: string | null` on `HydratedListEntry`; (7) Settings adds an editable display-name field wired to `profiles.display_name`.

**Rationale:** TODOS.md specifies the approach in full. The key constraint — `list_entries.added_by` already nullable post-migration 009 with `'added by someone'` as the null fallback — means non-null rows render the real name, null rows keep the fallback. No schema change to `list_entries` needed.

### D6: Sign-up "Your name" field — required or optional?

**Decision:** Optional. Empty → trigger falls back to email local-part (e.g. `meirmsn@example.com` → `"meirmsn"`).

**Rationale:** Minimum-friction for account creation; email local-part is always present and a reasonable-enough display name until the user edits it in Settings. Matches TODOS.md step 4's "email local-part as the starting `display_name`" guidance. No migration needed for existing users (backfill applies local-part on migration run).

### D7: Branch protection — flip to require slow-job in-PR or post-merge manual?

**Decision:** Post-merge manual action item. Surface in PR body under "Post-merge actions."

**Rationale:** `gh api PUT /repos/{owner}/{repo}/branches/{branch}/protection` requires `repo: administration` scope that the default CI PAT typically lacks; failing in-PR would be a silent no-op or a noisy warning. The user (as owner) flips the rule once at PR ship time via GitHub UI → Settings → Branches. With D8 now in-PR, branch protection + migration apply are the only post-merge manual steps left — a very short checklist.

### D8: `SUPABASE_URL` / `ANON_KEY` rotation — optional defense-in-depth (D22 is the structural fix)

**Decision:** Rotation is **recommended but optional**. With D22's runtime URL guard landing in this PR, rotation is no longer load-bearing — the guard throws if any `NODE_ENV=test` caller tries to instantiate a client pointing at the production project, regardless of what the GitHub Secret holds. User may rotate via `gh secret set SUPABASE_URL --body "http://127.0.0.1:54321"` + `gh secret set SUPABASE_ANON_KEY --body "<supabase-local-default-anon-jwt>"` whenever convenient (belt-and-suspenders). Surfaced as a non-blocking post-merge note in the PR body.

**Rationale:** Twice revised. (1) Original skeleton: "post-merge manual." (2) Mid-flight: flipped to "in-PR before push" — fast-job verifies rotation before merge. (3) After user question "can we automate so I don't do this every time" → added D22 (runtime URL guard) to PR 4; guard answers the question structurally, so rotation returns to "nice to have." Keeping a `gh secret set` command in the PR body for anyone who wants the tightest possible surface, but blocking the pipeline on it is no longer warranted. Session PAT lacks `secrets:write` scope anyway, which made "in-PR rotation" a user-blocking step — now that blocker drops. PR can ship without rotation and stay safe.

### D9: README update scope — new CI + required secrets section only?

**Decision:** Focus on: (a) CI gates section (fast vs slow job, what each runs), (b) required GitHub Secrets, (c) migration workflow callout pointing to `CLAUDE.md § Migration Workflow`. Defer exhaustive doc refresh to `/document-release` (auto-run by `/ship`).

**Rationale:** `§ 1h` item 3 says "new setup instructions" — the new thing is the CI slow-job + secrets. Everything else is unchanged from PR 3's README. `/document-release` will handle README drift across the rest of the codebase.

### D10: Type drift check — fail-fast on `git diff --exit-code`?

**Decision:** Yes. CI step: `supabase gen types typescript --local > packages/core/src/supabase.types.ts` → `git diff --exit-code packages/core/src/supabase.types.ts`. Non-zero exit on diff.

**Rationale:** `§ 1g` explicit. Without fail-fast, types silently drift between DB schema and app-side type imports — exactly the class of bug migration 009 introduced and PR 3 caught manually.

### D11: Rollback SQL validation — EXPLAIN wrapper (not full apply-then-revert)?

**Decision:** EXPLAIN wrapper in slow-job. Per new migration, extract the `-- ROLLBACK` block from the `.sql` file, wrap each statement in `EXPLAIN ` against local Postgres, fail on any parse/plan error.

**Rationale:** `§ 1g` explicit ("extract `-- ROLLBACK` block and parse against local Postgres (`EXPLAIN` wrapper); fail on syntax errors"). Full apply-then-revert is ~1–2 minutes per migration × N migrations — scales badly as the migration chain grows. EXPLAIN catches the 80% failure mode (typos, invalid references, missing columns) at O(ms) per migration. When PR 4 ships, migration 010 is the first one actively validated; PRs 1–9 get retroactive validation too.

### D12: Playwright E2E — both mobile + desktop projects in slow-job?

**Decision:** Yes. `playwright.config.ts` already defines mobile (375) + desktop (1440) projects; slow-job runs `npx playwright test --project=mobile --project=desktop`. Trace upload on failure via `actions/upload-artifact`.

**Rationale:** `§ 1g` explicit ("Run at both viewports"). Matches 4-combo evidence-matrix convention from `/ak-pre-ship Gate 3` — the project-level invariant "every primary screen verified at both viewports × both themes" applies equally to CI E2E.

### D13: GitHub Secrets — `SUPABASE_SERVICE_ROLE_KEY` + `ANTHROPIC_API_KEY` must be added before slow-job can go green?

**Decision:** Yes. Surface as pre-merge action item in PR body ("Add these two GitHub Secrets before the slow-job can pass. Until then, slow-job is expected-red.").

**Rationale:** `§ 1g` explicit. Integration tests need admin API (service role); edge-fn integration tests call Claude (Anthropic key). Without these, slow-job steps will fail loudly at runtime — not silently — so the failure mode is "obvious red CI" rather than "secret drift." Surface both in the PR body so the user adds them via Settings → Secrets → Actions.

### D14: CI caching — pnpm store + Turborepo outputs + Playwright browsers?

**Decision:** Yes, all three. Cache keys hash `pnpm-lock.yaml` (restore key for workspace lockfile drift tolerance). Playwright browsers use the lockfile for `@playwright/test` version pinning.

**Rationale:** `§ 1g` explicit. Expected CI minutes projection (`~260 min/month for 10 PRs`) assumes warm caches. Without them, fast-job doubles in wall time (2m → 4m) and slow-job adds ~3m on every run reinstalling Chromium.

### D15: `profiles` migration number — 010?

**Decision:** 010 (sequential after migration 009 which shipped in PR 3).

**Rationale:** Migrations 001–009 are used per `supabase/migrations/` content. No gap in the sequence; standard incrementing pattern.

### D16: `list_entries.added_by` backfill strategy — no change to existing rows?

**Decision:** No change to existing `list_entries` rows. `added_by` stays pointing to `auth.users` (or null post-09 if the user was deleted). `profiles.display_name` hydration handles the rendering.

**Rationale:** `list_entries.added_by` is a FK to `auth.users`, not a denormalized string. The rendering fix is purely hydration-side (`fetchListEntries` joins `profiles` on `added_by`). Zero risk to existing list-entry data.

### D17: Settings display-name edit UX — inline TextField with debounced save?

**Decision:** Inline TextField on Settings page. Debounce save (300ms) on blur or after user pauses typing. Optimistic UI with toast on error.

**Rationale:** Settings is simple (single-column layout); a separate edit screen adds friction for a one-field change. Debounced save avoids saving mid-keystroke. Pattern mirrors how `item-display-name-editing` (v1 TODO) will work for item-level overrides.

### D18: New METRICS.md events — none; extend existing `auth_signed_up`?

**Decision:** No new events in this PR. Extend existing `auth_signed_in` event (or equivalent) with a `has_display_name: boolean` property so cohort analysis can separate users who set a name from those who took the email-local-part fallback. If `auth_signed_up` does not exist as a distinct event, defer entirely — display-name is editable in Settings, so adoption is observable through separate DB query.

**Rationale:** Avoids event proliferation (per `METRICS.md` discipline and PR 5 D3 precedent). A boolean property on the existing event gives the same analytic signal. Deferral is safe since the data lives in `profiles.display_name` and is queryable directly.

---

<!-- /ak-spec (Phase 1) expanded below. Decisions section above is verbatim. -->

## Decisions added in Phase 1 (D19+)

### D19: Profiles migration number — 012 (not 010, skeleton-outdated)

**Decision:** Name the migration `supabase/migrations/012_profiles.sql`. Skeleton D15 said "010" but migrations 010 (`010_fix_mark_item_bought.sql`) and 011 (`011_items_insert_policy.sql`) already shipped in PR 5. Next slot is 012.

**Rationale:** Skeleton was drafted before PR 5 landed 010+011; sequential numbering convention is unchanged. All D15 guidance (sequential, no gap) still holds — only the digit shifts. Phase 1 preserves D1–D18 verbatim but surfaces this numeric drift here so the tracker/implementer don't carbon-copy "010" from the skeleton.

### D20: Shell scripts directory — new top-level `scripts/`

**Decision:** Create `scripts/` at repo root. House CI helpers there: `scripts/ci-type-drift.sh` + `scripts/ci-rollback-explain.sh`. Shell, not JS — these run once in CI and shell is the lingua franca of `.github/workflows/ci.yml`.

**Rationale:** No prior `scripts/` convention exists (checked — `/workspace/scripts/`, `/workspace/apps/web/scripts/`, `/workspace/packages/core/scripts/` all absent). Root `scripts/` is conventional for repo-wide CI helpers; package-local scripts would fragment across workspaces. Keeps the slow-job YAML readable (one-line invocations) and the logic testable locally (`bash scripts/ci-type-drift.sh` reproduces what CI does).

### D21: Profile display-name read strategy — single join, not N+1

**Decision:** Extend `fetchListEntries` + `fetchListEntryById` queries with `profiles!list_entries_added_by_fkey(display_name)` (or equivalent PostgREST left-join syntax). Null `added_by` → `profiles` join returns null → `addedByName: null` → UI falls back to "someone". No separate `fetchProfile` call from the list view.

**Rationale:** Supabase PostgREST supports explicit FK joins by constraint name — `list_entries.added_by` has `list_entries_added_by_fkey` referencing `auth.users`. To join `profiles` on `added_by` we need either (a) a new FK from `list_entries.added_by` → `profiles.user_id`, or (b) a join using the existing FK chain. Cleanest is (c): declare the join via the `profiles.user_id` FK to `auth.users(id)` — PostgREST traverses `list_entries.added_by → auth.users.id ← profiles.user_id`. D21 commits to this approach — no new FK on `list_entries`. If PostgREST struggles with the two-hop join, fall back to a view `list_entries_hydrated` (deferred; only if migration-010 integration test reveals the join doesn't resolve).

### D22: Runtime URL guard — fold qa-options.md Enforcement #3 into PR 4

**Decision:** Add `assertNotProdUrlInTestEnv(url)` helper in `packages/core/src/supabase.ts`. Call from all four Supabase client factory sites: core's `createClient`, `apps/web/lib/supabase/client.ts` (browser), `apps/web/lib/supabase/server.ts` (RSC), `apps/web/middleware.ts` (edge middleware). Guard throws when `NODE_ENV === 'test'` **and** URL contains the production project ref (`nzfdfjctpotjyuxdfcpw.supabase.co`); no-ops otherwise (dev + prod runtimes + any non-prod URL in test). Covered by 5 new unit tests in `packages/core/src/supabase.test.ts` (prod-in-test throws × 2 — factory + helper; no-ops on non-prod-in-test × 3 — localhost/staging/fake; no-ops in prod env; no-ops in dev env).

**Rationale:** `qa-options.md § Deferred` originally queued a runtime URL guard as a separate narrow follow-up PR ("tiny (3 lines) but deserves its own narrow PR with proper verification, not mixed into PR 4 or 5"). User asked mid-flight: "can we make this automatic so I don't do the manual rotation process again?" Correct answer: the actual bug isn't "secrets are prod" — it's "a test could silently dial prod." The guard fixes the bug structurally. Once in, rotation becomes cosmetic (D8 softens to optional). Cost: ~20 lines of code across 4 files + 5 unit tests. Small enough not to grow PR scope meaningfully, and it eliminates the user-blocking "you must rotate before push" step that `gh secret set` 403 made painful. Defense-in-depth logic: rotate IF convenient; guard catches the bug either way. Future PRs get the same protection automatically — exactly what the user asked for.

## Core user story

1. Sign up with display name "Meir."
2. Add "leche" from the list.
3. See the new row render "added by Meir."
4. Edit display name to "Dad" in Settings; reload the list.
5. See the same row render "added by Dad."

Five verbs (sign-up, add, see-row-with-name, edit-name, see-row-with-new-name). Each produces a verifiable artifact Gate 9's qa-walk harness can capture. Migration + CI-pipeline work is internal scaffolding; this is the observable user flow that proves the `profiles` plumbing actually renders.

_(Gate 9 scope note: the CI slow-job itself has no user-visible surface — it is infrastructure. The Core user story covers the posted-by-someone half of PR 4 scope, which does. Gate 9 artifact coverage is satisfied by the 5 verbs above.)_

---

## In scope

**CI slow-job (`§ 1g`):**

1. New slow job in `.github/workflows/ci.yml` — runs on pull requests only, `needs: fast`, sets up Supabase locally in the runner.
2. Supabase stack in CI: `supabase/setup-cli@v1` + `supabase start` + `psql` load of `supabase/seed.sql`.
3. Integration test runner: `pnpm turbo run test:integration` (new filter — `*.integration.test.ts` files). Full matrix includes existing unit tests already in `fast`.
4. Edge function deploy: `supabase functions deploy add-item` against local Supabase (so E2E exercises current branch code, not stale deploy).
5. Playwright E2E at mobile (375) + desktop (1440) projects, uploading `playwright-report/` + `test-results/` on failure.
6. Type drift check: regenerate `packages/core/src/supabase.types.ts` via `supabase gen types typescript --local` and fail on `git diff --exit-code`.
7. Rollback SQL EXPLAIN check: per migration, extract `-- ROLLBACK:` block and wrap each statement in `EXPLAIN` against local Postgres; fail on plan/parse error.
8. Caching (new): pnpm store, Turborepo outputs, Playwright browsers. Cache key hashes `pnpm-lock.yaml`.
9. Secret masking: `echo "::add-mask::$SUPABASE_SERVICE_ROLE_KEY"` before any step consumes it.
10. Force-create E2E (carry-forward from PR 5): `apps/web/e2e/add-new.spec.ts` types `xyzzy-test-{timestamp}`, clicks add-new row in `DisambiguationSheet`, confirms, asserts new `items.name_canonical` + `list_entries` rows via Supabase client. Runs at both viewports.
11. In-PR CI-secrets rotation (per D8): `gh secret set SUPABASE_URL --body "http://127.0.0.1:54321"` + `gh secret set SUPABASE_ANON_KEY --body "<supabase-local-default-anon-jwt>"`. Run before the first push (Task H). Verified by fast-job green on this PR.

**Posted-by-someone (`§ 1h` item 1):**

11. Migration 012 (`supabase/migrations/012_profiles.sql`): `profiles (user_id uuid PK → auth.users(id) ON DELETE CASCADE, display_name text NOT NULL, created_at timestamptz DEFAULT now())` + RLS (own-row rw, household-member read) + trigger on `auth.users` insert that reads `raw_user_meta_data.display_name` (fallback: email local-part) + backfill existing users.
12. `packages/core/src/api/profiles.ts` — new module: `fetchMyProfile(client): Promise<Profile | null>`, `updateMyProfile(client, displayName): Promise<Profile>`. Register in `packages/core/src/index.ts` barrel.
13. `Profile` model in `packages/core/src/models/index.ts`: `{ userId: string, displayName: string, createdAt: string }`.
14. `HydratedListEntry` gains `addedByName: string | null` (derived from joined `profiles.display_name`).
15. `fetchListEntries` + `fetchListEntryById` queries extended with the profiles join; map layer returns `addedByName`.
16. `signUpWithPassword` grows an optional `displayName` parameter, threaded into `auth.signUp({ options: { data: { display_name } } })`.
17. Sign-in page: new "Your name (optional)" field on the signup fallback branch; passed to `signUpWithPassword` when the sign-up path runs.
18. `ListRow` renders `entry.addedByName ?? 'someone'` in the "added by X" line (replacing today's static `'added by someone'`).
19. Item detail page renders the same (`entry.addedByName ?? 'someone'`).
20. Settings: new "Your name" inline editable field wired to `fetchMyProfile` + `updateMyProfile`, debounced 300ms save on blur or pause; optimistic UI with toast on error.

**Carry-forward docs (`§ 1h` items 2–4):**

21. README setup section updated with (a) CI gates (fast vs slow), (b) required GitHub Secrets, (c) pointer to `CLAUDE.md § Migration Workflow`.
22. TODOS.md: remove resolved `posted-by-someone` entry; any tactical drift captured by `/document-release`.
23. `/document-release` invoked as part of `/ak-pre-ship` Phase 3 (not a spec line — it runs automatically).

**Out of scope:**

- Apple SSO (TODOS.md v1)
- Item-level display-name overrides (`item-display-name-editing`, v1)
- Per-household items catalog (v1)
- Branch-protection API flip — post-merge manual action per D7
- A `display_name` uniqueness constraint (two users can share "Meir"; attribution uses user_id internally, display_name is UI-only)
- New METRICS.md events (D18 deferred; display-name adoption is queryable via `profiles` directly)

---

## Screens

| Screen                 | Change                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                | Sign-up fallback branch gains a "Your name (optional)" `<Input>` between email and password (or above password). Empty → trigger falls back to email local-part per D6. Login branch: unchanged.                      |
| List (`/list`)         | Every `ListRow` "added by X" line now renders the real name when `addedByName` is set, fallback "someone" when null. No layout change.                                                                                |
| Item detail            | "Added by" row reads `entry.addedByName ?? 'someone'`. No layout change.                                                                                                                                              |
| Settings (`/settings`) | New `ACCOUNT` subsection item: "Your name" inline editable `<Input>` above the Sign out button. Debounced save (300ms) on blur or typing-pause. Inline toast on error (reuse existing `ConfirmationToast` component). |

All four screens keep 375 + 1440 viewport × light + dark mode matrix (4-combo evidence gate unchanged; hero screenshots captured at Phase 6).

---

## Data model changes

### New table: `profiles`

```sql
-- 012_profiles.sql

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Own row: read + write
create policy "profiles_select_own" on profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy "profiles_update_own" on profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Household-member read: see display names of anyone in any of my households
create policy "profiles_select_household" on profiles
  for select to authenticated
  using (
    exists (
      select 1
      from household_members hm_self
      join household_members hm_other
        on hm_other.household_id = hm_self.household_id
      where hm_self.user_id = auth.uid()
        and hm_other.user_id = profiles.user_id
    )
  );

-- Trigger: auto-create profile on auth.users insert
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing users
insert into profiles (user_id, display_name)
select id, split_part(email, '@', 1)
from auth.users
on conflict (user_id) do nothing;

-- ROLLBACK:
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop policy if exists "profiles_select_household" on profiles;
-- drop policy if exists "profiles_update_own" on profiles;
-- drop policy if exists "profiles_select_own" on profiles;
-- drop table if exists profiles;
```

**Unchanged tables:** `list_entries`, `purchase_history`, `items`, `stores`, `households`, `household_members`, `brand_preferences`. `list_entries.added_by` stays nullable (migration 009 behavior preserved). No FK additions on `list_entries`.

**Generated types:** `pnpm supabase gen types typescript --local > packages/core/src/supabase.types.ts` regenerates `Tables<'profiles'>`. Type drift check in CI validates this.

---

## API contracts

### New models

```typescript
// packages/core/src/models/index.ts (additions)

export type Profile = Tables<'profiles'>;

/** HydratedListEntry additions */
export interface HydratedListEntry {
  // ...existing fields...
  /**
   * Display name of the user who added this entry, sourced from
   * profiles.display_name via a left join on added_by. Null when
   * added_by is null (original user deleted) or the profiles row
   * is unreadable by the current caller (RLS boundary). UI falls
   * back to "someone" in both cases.
   */
  addedByName: string | null;
}
```

### New API module: `packages/core/src/api/profiles.ts`

```typescript
/**
 * Fetch the current user's profile (or null if unauthenticated /
 * profile row missing — the latter shouldn't happen post-migration
 * 012 but is handled defensively).
 */
export async function fetchMyProfile(client: Client): Promise<Profile | null>;

/**
 * Update the current user's display_name. Trims whitespace; rejects
 * empty string (UI should prevent submit; wrapper throws ValidationError
 * if caller bypasses). Returns the updated profile row.
 */
export async function updateMyProfile(
  client: Client,
  displayName: string
): Promise<Profile>;
```

### Auth API change

```typescript
// packages/core/src/api/auth.ts — signUpWithPassword gains displayName

export async function signUpWithPassword(
  client: Client,
  email: string,
  password: string,
  displayName?: string // NEW — threaded into options.data.display_name
): Promise<AuthResponse>;
```

When `displayName` is provided, call: `client.auth.signUp({ email, password, options: { data: { display_name: displayName } } })`. When absent, fall back to the existing shape. Trigger picks up `display_name` from `raw_user_meta_data` or falls back to email local-part.

### Items API change

```typescript
// packages/core/src/api/items.ts — fetchListEntries + fetchListEntryById
// extended select string + map layer adds addedByName
```

Select string changes: append `, profiles!list_entries_added_by_fkey(display_name)` (or whichever relationship alias PostgREST uses — verify via `supabase gen types`). Map layer adds `addedByName: row.profiles?.display_name ?? null`. No API-signature change for callers.

### No changes

- `mark_item_bought` RPC — unchanged
- `invokeAddItem` — unchanged
- `household_members` queries — unchanged
- Realtime subscription surface — unchanged (list realtime events carry `added_by` uuid; list view re-fetches hydrated row which picks up profile name)

---

## Offline behavior

**Online-only with error state.** Unchanged from PR 3 per `PRODUCT-ROADMAP.md § 1e`. `fetchMyProfile` + `updateMyProfile` throw on network error; Settings surfaces a toast. No local cache of the profile; the app is v0 and online-only.

---

## Metrics

**No new events** (per D18). Existing event `auth_signed_in` covers sign-in. `METRICS.md` unchanged.

Display-name adoption is queryable directly:

```sql
-- Percent of users who set a non-default display_name
select
  count(*) filter (where display_name <> split_part(email, '@', 1))::float / count(*) as custom_pct
from profiles
join auth.users on auth.users.id = profiles.user_id;
```

If a future PR adds an `auth_signed_up` event distinct from `_signed_in`, a `has_display_name: boolean` property can be threaded — deferred.

---

## Files to create / modify

### Create

| Path                                                 | Purpose                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `supabase/migrations/012_profiles.sql`               | Profiles table + RLS + trigger + backfill + rollback block                       |
| `packages/core/src/api/profiles.ts`                  | `fetchMyProfile`, `updateMyProfile` wrappers                                     |
| `packages/core/src/api/profiles.test.ts`             | Unit tests for wrappers (mocked Supabase client)                                 |
| `packages/core/src/api/profiles.integration.test.ts` | Integration tests — trigger fires on signup, RLS own-row + household-member read |
| `packages/core/src/api/items.integration.test.ts`    | Integration tests — profiles join returns display_name; null path returns null   |
| `apps/web/e2e/add-new.spec.ts`                       | Force-create E2E — carry-forward from PR 5                                       |
| `apps/web/components/DisplayNameField.tsx`           | Shared inline editable field for Settings (debounced save, optimistic UI)        |
| `apps/web/components/DisplayNameField.test.tsx`      | Component tests                                                                  |
| `scripts/ci-type-drift.sh`                           | `supabase gen types typescript --local` + `git diff --exit-code`                 |
| `scripts/ci-rollback-explain.sh`                     | Extract `-- ROLLBACK:` blocks, EXPLAIN each statement, fail on error             |

**Modified in Task I (D22 — runtime URL guard):**

| Path                                 | Change                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| `packages/core/src/supabase.ts`      | Add `assertNotProdUrlInTestEnv(url)` helper; call from `createClient` |
| `packages/core/src/supabase.test.ts` | Add 5 unit tests (throw-on-prod-in-test × 2, no-op cases × 3)         |
| `packages/core/src/index.ts`         | Export `assertNotProdUrlInTestEnv` alongside `createClient`           |
| `apps/web/lib/supabase/client.ts`    | Import + call guard before `createBrowserClient`                      |
| `apps/web/lib/supabase/server.ts`    | Import + call guard before `createServerClient`                       |
| `apps/web/middleware.ts`             | Import + call guard before `createServerClient`                       |

### Modify

| Path                                        | Change                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                  | Uncomment + expand slow job: Supabase setup, deploy edge fn, integration tests, Playwright, type drift, rollback EXPLAIN, caching, secret masking |
| `packages/core/src/models/index.ts`         | Add `Profile` type; add `addedByName: string \| null` to `HydratedListEntry`                                                                      |
| `packages/core/src/api/auth.ts`             | `signUpWithPassword` gains optional `displayName` param → `options.data.display_name`                                                             |
| `packages/core/src/api/auth.test.ts`        | Cover the `displayName` thread-through                                                                                                            |
| `packages/core/src/api/items.ts`            | `fetchListEntries` + `fetchListEntryById` — extend select + map to populate `addedByName`                                                         |
| `packages/core/src/api/items.test.ts`       | Cover the new mapping (both populated and null)                                                                                                   |
| `packages/core/src/index.ts`                | Export `profiles` module + new `Profile` type                                                                                                     |
| `packages/core/src/supabase.types.ts`       | Regenerated (CI enforces)                                                                                                                         |
| `apps/web/app/(auth)/sign-in/page.tsx`      | Add "Your name (optional)" input; pass to `signUpWithPassword` on sign-up fallback                                                                |
| `apps/web/app/(auth)/sign-in/page.test.tsx` | Cover the new input + display_name pass-through                                                                                                   |
| `apps/web/components/ListRow.tsx`           | Replace `ADDED_BY_FALLBACK` constant with `entry.addedByName ?? 'someone'` (prefix "added by ")                                                   |
| `apps/web/components/ListRow.test.tsx`      | Cover both display-name and null fallback rendering                                                                                               |
| `apps/web/app/item/[id]/page.tsx`           | Replace static `'someone'` with `entry.addedByName ?? 'someone'`                                                                                  |
| `apps/web/app/settings/page.tsx`            | Add display-name section with `<DisplayNameField>` above sign-out button                                                                          |
| `apps/web/app/settings/page.test.tsx`       | Cover the new field + save wiring                                                                                                                 |
| `README.md`                                 | CI gates section, GitHub Secrets, migration workflow pointer                                                                                      |
| `TODOS.md`                                  | Remove `posted-by-someone` pre-ship entry (resolved); any drift via `/document-release`                                                           |
| `PLAN.md`                                   | Flip row #1 from Planned → Active (see § PLAN.md flip below)                                                                                      |
| `PRODUCT-ROADMAP.md`                        | (if `/document-release` surfaces drift) Mark § 1g + § 1h as shipped in a later phase; no change here                                              |

---

## Tests

### Unit (Vitest, part of `fast` job)

- `packages/core/src/api/profiles.test.ts` — `fetchMyProfile` returns profile, returns null when unauth; `updateMyProfile` trims + rejects empty string + forwards to `.update().eq().select()`.
- `packages/core/src/api/auth.test.ts` — `signUpWithPassword(c, e, p, 'Meir')` passes `options.data.display_name: 'Meir'`; `signUpWithPassword(c, e, p)` omits it.
- `packages/core/src/api/items.test.ts` — `fetchListEntries` maps `addedByName` from the joined `profiles.display_name`, falls back to null when the join returns null.
- `apps/web/components/ListRow.test.tsx` — renders "added by Meir" when `addedByName: 'Meir'`; renders "added by someone" when `addedByName: null`.
- `apps/web/components/DisplayNameField.test.tsx` — debounced save (300ms) on blur; optimistic update; rollback + toast on error.
- `apps/web/app/(auth)/sign-in/page.test.tsx` — sign-up branch passes `displayName` input value to `signUpWithPassword`; empty input → omits `displayName` (trigger fallback owns the default).
- `apps/web/app/settings/page.test.tsx` — renders DisplayNameField wired to current profile; save invokes `updateMyProfile`.
- `apps/web/app/item/[id]/page.test.tsx` (if exists; else add) — renders profile name when present, "someone" when null.

### Integration (`*.integration.test.ts`, part of `slow` job)

- `packages/core/src/api/profiles.integration.test.ts`:
  - Trigger fires: `supabase.auth.signUp(...)` with `display_name` in `options.data` → `profiles` row exists with that name after the signup resolves.
  - Trigger fallback: signup without `display_name` → profile created with email local-part.
  - Own-row RLS: user A reads own profile. User A updates own profile. User A tries to update user B's profile → rejected.
  - Household-member read: user A + user B in same household → A reads B's profile (display_name column). User A + user C in DIFFERENT households → A reading C's profile returns no row.
  - Backfill (smoke): pre-existing auth.users rows get profiles during migration 012 apply.

- `packages/core/src/api/items.integration.test.ts`:
  - Insert a list_entry authored by user A; fetch via `fetchListEntries` as user A (same household) → `addedByName === A's display name`.
  - Delete user A (CASCADE clears profile row via `ON DELETE CASCADE`; list_entries.added_by → NULL via migration 009) → fetch → `addedByName: null`.

- Force-create path (already integration-covered by PR 5 unit tests, but slow-job adds real-DB coverage):
  - Edge function `force_create_with_label: true` with a novel utterance → new items row + list_entries row; `disambiguation_log` unchanged.
  - Simultaneous force-create of same label → second call trips `23505`, falls through to existing-item path.

### E2E (Playwright, part of `slow` job)

- `apps/web/e2e/core-flows.spec.ts` — still passes at both viewports after migration 012 + UI changes.
- `apps/web/e2e/add-new.spec.ts` (NEW):
  1. Sign in, go to `/list`.
  2. Type `xyzzy-test-item-${Date.now()}` in AddItemSheet → submit.
  3. `DisambiguationSheet` opens with the "None of these — add as new" row.
  4. Click the add-new row → confirm.
  5. Assert new `list_entries` row appears in the list with that item name.
  6. Assert via Supabase admin client that both a new `items.name_canonical = 'xyzzy-test-item-*'` row AND a `list_entries` row exist.
- Runs at `--project=mobile` and `--project=desktop`.

### Manual / non-automated (Phase 6 evidence)

- Hero screenshots at 375+1440, light+dark for: sign-in w/ display-name field, list with real names visible, settings display-name edit, item-detail with real name.

---

## Dependencies

- Local Supabase stack runs in GitHub Actions runner (D2). Requires runner-native Docker (GH Actions has it).
- `supabase/setup-cli@v1` action.
- GitHub Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` — must be added before slow-job can pass (D13). Surface in PR body as pre-merge action.
- `@playwright/test` version already installed (PR 3).
- No new runtime dependencies on any app package (no new npm/pnpm packages needed).
- No cross-PR dependencies — PR 4 can ship atomically once secrets are added.

---

## Task order

Eight tasks, roughly mirroring the live tracker. Small delta callouts flagged.

- **A. Profiles migration (`supabase/migrations/012_profiles.sql`)** — table + RLS + trigger + backfill + ROLLBACK block. Regenerate `supabase.types.ts`. _Tracker: "profiles migration (010)" — number is 012, name stays "profiles migration"._
- **B. Posted-by-someone UI** — `signUpWithPassword` displayName param, sign-in page input, `profiles.ts` API wrappers, `Profile` + `addedByName` models, `fetchListEntries` + `fetchListEntryById` join extension, `ListRow` + `item/[id]` render, Settings display-name field. Unit tests per component/wrapper.
- **C. Integration test harness** — ensure Vitest integration config exists (`*.integration.test.ts` glob) + `pnpm turbo run test:integration` filter; author the first two integration files (`profiles.integration.test.ts`, `items.integration.test.ts`).
- **D. CI slow-job YAML** — uncomment + expand `.github/workflows/ci.yml`: Supabase setup, seed load, edge-fn deploy, integration tests, Playwright at both viewports, caching (pnpm + turbo + playwright), trace upload on failure, secret masking.
- **E. Type drift + rollback EXPLAIN scripts** — `scripts/ci-type-drift.sh`, `scripts/ci-rollback-explain.sh`; wire both into the slow-job YAML.
- **F. Force-create E2E (PR 5 carry-forward)** — `apps/web/e2e/add-new.spec.ts` with Supabase-client assertions. Runs at both viewports.
- **G. Unit + component test coverage** — close gaps surfaced during B/F: `DisplayNameField.test.tsx`, updates to `ListRow.test.tsx`, `page.test.tsx` for settings + sign-in + item-detail.
- **H. README + TODOS update + PRODUCT-ROADMAP rewrite + (optional) in-PR CI-secrets rotation (D8)** — README CI-gates + secrets section; TODOS close `posted-by-someone`; rewrite `PRODUCT-ROADMAP.md § 1g` item 4 to reflect D8 (optional rotation) + D22 (URL guard). Optional rotation: if session PAT allows, execute `gh secret set SUPABASE_URL` + `SUPABASE_ANON_KEY` to localhost placeholder values and capture `gh secret list` in the commit; if PAT scope blocks (HTTP 403), mark partial and surface as a recommended-but-optional post-merge note — D22's guard provides the load-bearing protection regardless. `/document-release` handles the long tail (runs automatically in Phase 3).
- **I. Runtime URL guard (D22)** — `assertNotProdUrlInTestEnv(url)` helper in `packages/core/src/supabase.ts`; wired into all four client factories (core `createClient`, `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/middleware.ts`); 5 new unit tests in `packages/core/src/supabase.test.ts`. Lands the Enforcement #3 work `qa-options.md § Deferred` had queued as a separate narrow PR. Answers the user's "can we automate this?" question — rotation becomes optional thereafter.

**Delta callouts for the live tracker:**

- Task A's "(010)" should be "(012)" — see D19. Tracker-label tweak only, no scope change.
- No task renaming beyond A; all eight tasks line up 1:1 with tracker entries.
- Phase 6 hero screenshots are captured by `/ak-pre-ship`, not a task line here.

---

## Gotchas

- **Migration 012, not 010** (D19). Skeleton's D15 predated PR 5. Do NOT use 010 — it's `010_fix_mark_item_bought.sql` already in tree. Do NOT use 011 — it's `011_items_insert_policy.sql`.
- **`list_entries.added_by` nullable is load-bearing** (`CLAUDE.md § Gotchas`). Migration 009 set `ON DELETE SET NULL`; the `addedByName` join must handle null gracefully (no inner join — use left-join semantics). UI must continue to render "someone" for null — the real-name code path is additive, not a replacement.
- **RLS least privilege** (`CLAUDE.md § Gotchas`). Profiles RLS: own-row rw + household-member read. Do NOT grant service-role-write access or a blanket `authenticated` read. D19 encodes the three policies explicitly; the integration test exists specifically to prove the household boundary holds.
- **Edge-function deploy discipline** (`CLAUDE.md § Gotchas`). PR 4's slow-job deploys `add-item` to **local** Supabase (D3). It must NOT deploy to prod. The `supabase functions deploy` invocation in CI explicitly targets the local instance (no `--project-ref` flag, runs after `supabase start`). Post-merge: production still needs a manual `supabase functions deploy add-item` — surface in PR body if add-item has changed since last prod deploy. (For PR 4 specifically, no edge-function code changes in this PR; the deploy step exists to prove the pipeline works for future PRs and to run the carry-forward E2E against current-branch code.)
- **Principle of least privilege for RLS-bypass writes** (`CLAUDE.md § Gotchas`). Profiles inserts are trigger-driven (`SECURITY DEFINER` on `handle_new_user` per the canonical pattern). Do NOT add a blanket `profiles_insert` policy. Trigger is the auth-bound insertion path; update is user-driven via `profiles_update_own`.
- **`@source` directive** (`CLAUDE.md § Gotchas`). New `DisplayNameField` component lives in `apps/web/components/`, already covered by existing `@source`. No new `@source` line needed.
- **PostgREST FK join syntax.** D21 notes the two-hop join: `list_entries.added_by → auth.users → profiles.user_id`. PostgREST may require an explicit hint (`profiles!inner(display_name)` vs `profiles(display_name)` or naming the FK constraint). Verify during implementation; fall back to a view (`list_entries_hydrated`) only if the join resolution fails (flagged — not expected).
- **Rollback-EXPLAIN quirk.** EXPLAIN cannot plan statements against non-existent objects (e.g. rollback to drop a table that wasn't created in this session). The script must `apply migration → EXPLAIN rollback → rollback-applied`, not just `EXPLAIN rollback` against pristine DB. D11 states the EXPLAIN strategy; implementation must take this subtlety — the script applies the forward migration first, then EXPLAINs each rollback statement.

---

## Acceptance / rollout / rollback

### Acceptance criteria

- [ ] Signing up a new user with "Your name: Meir" creates a `profiles` row with `display_name = 'Meir'` (verified via Supabase SQL editor or integration test).
- [ ] Signing up without a name creates a profile with `display_name = <email local-part>`.
- [ ] List view renders "added by Meir" for Meir-authored rows; "added by someone" for null-`added_by` rows (pre-existing null or user-deleted).
- [ ] Item detail renders the same.
- [ ] Settings → "Your name" → edit → saves within 300ms debounce; list refresh shows the new name.
- [ ] CI slow-job runs green on a PR with these secrets set: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
- [ ] D22 runtime URL guard prevents test-env callers from dialing the production project: `assertNotProdUrlInTestEnv('https://nzfdfjctpotjyuxdfcpw.supabase.co')` throws under `NODE_ENV=test`; no-ops in dev + prod + on any non-prod URL (covered by 5 unit tests in `packages/core/src/supabase.test.ts`).
- [ ] CI slow-job fails loudly (not silently) when: (a) migration 012 is modified without regenerating types, (b) a migration's `-- ROLLBACK:` block has syntax error, (c) Playwright test fails at either viewport.
- [ ] Force-create E2E passes: typing `xyzzy-test-*` + add-new → new items row + list_entries row observable.
- [ ] `/ak-pre-ship` Gate 9 (qa-walk) captures the 5-verb Core user story with artifacts.

### Rollout

1. Merge PR to `main`.
2. Vercel auto-deploys front-end (automatic, no action).
3. `supabase db push` to apply migration 012 to prod (per `CLAUDE.md § Migration Workflow`; **manual** step, documented in PR body's "Post-merge actions").
4. (Optional) `supabase functions deploy add-item` to prod if add-item has drifted — NOT required for PR 4 (no edge-function code change), but included in PR body as a reminder for the convention.
5. Verify prod: sign in, confirm list renders real name for authored row.

### Rollback

- **Database rollback:** run the `-- ROLLBACK:` block from `012_profiles.sql` via Supabase SQL editor. Drops trigger, function, policies, table. Safe because (a) no data depends on `profiles` in other tables, (b) trigger removal restores previous auth.users-insert behavior, (c) list rendering falls back to "added by someone" for all rows without UI changes (the fallback is already implemented — PR 4's code reads `addedByName ?? 'someone'` which evaluates to `'someone'` when the join returns no profile row).
- **Front-end rollback:** Vercel "Instant Rollback" to the previous deploy. Front-end expects `addedByName` in `HydratedListEntry` type; rolling back the front-end without the migration is safe (front-end gracefully falls back). Rolling back the migration without the front-end is safe (profiles join becomes no-op; `addedByName: null`; UI falls back to "someone").
- **Order of operations:** roll back front-end first if both are needed, then migration. Either in isolation is safe.

### Pre-merge actions (surface in PR body — must land before merge)

1. **Add GitHub Secrets** (blocker for green slow-job): `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.

### Post-merge manual actions (surface in PR body)

1. **Flip branch protection** to require `slow` status check alongside `fast` (GitHub UI → Settings → Branches → main → require status checks → add `slow`).
2. **Apply migration 012 to prod:** `supabase db push` from a privileged shell.
3. **Regenerate prod types (optional sanity check):** `supabase gen types typescript --project-id <ref> > packages/core/src/supabase.types.ts` and confirm no drift from the CI-generated file.
4. **(Optional, defense-in-depth) Rotate CI secrets off prod** (per D8 + D22): `gh secret set SUPABASE_URL --body "http://127.0.0.1:54321"` + `gh secret set SUPABASE_ANON_KEY --body "<supabase-local-default-anon-jwt>"`. D22's runtime URL guard makes this non-load-bearing — tests that would dial prod throw regardless of secret contents — but rotating also removes prod creds from the CI env surface. Do it whenever convenient.
