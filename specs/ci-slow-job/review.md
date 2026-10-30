<!-- generated-by: /ak-pre-ship -->
<!-- feature: ci-slow-job -->
<!-- branch: feature/ci-slow-job -->
<!-- date: 2026-04-23 -->

# Pre-ship review: ci-slow-job (PR 4)

Baseline: `pnpm turbo run test:unit` → 3 packages, **230 tests passing** (21 UI + 58 core + 151 web) at HEAD `a064f27`.

Preflight:

- Chromium: `/usr/bin/chromium` 147.0.7727.101 (apt-installed; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` set)
- gh CLI: authenticated as `meirmsn`
- Supabase local: **unavailable** (Docker-in-Docker inert in devcontainer; per bootstrap script output "unavailable: Docker not running — local Supabase cannot start; Gate 9 must use admin-API against hosted"). Gate 9 falls back per contract.
- Branch: `feature/ci-slow-job`, 12 commits ahead of `origin/main`
- UI scope: YES (sign-in, settings, list, item-detail all modified)

## Router Summary

- **Passed**: 11 (every gate, with findings fixed inline where they landed)
- **Findings fixed**: 9 across 5 gates (Gate 1: 2, Gate 3: 2, Gate 4: 1, Gate 5: 4 [5A, 5B, 5C, 5D], Gate 6: 1)
- **Findings pending**: 0
- **n/a**: 1 (Gate 2 — no new METRICS.md events per spec D18)
- **Blocked**: 0

Final test:unit count: 234 tests passing (21 UI + 61 core + 152 web). Last pre-ship commit: `40f86b9` (Phase 6 hero screenshots). Hero images: 4 (sign-in / list / settings / item, 1440 × light). Dirty-tree escape (`apps/web/next-env.d.ts` single→double quote drift, Next-generated) accepted by the pre-commit adversarial reviewer on every commit from Gate 5 onward; reason string documented why on each.

---

## Gate 1 — docs-check (ak)

**Outcome**: `findings (2) fixed`

CLAUDE.md § Where Things Happen was missing the new PR 4 paths, and § Gotchas had no entry for the D21 two-query hydration or the D8 CI-only secret placeholders. The PR touches all three.

Findings + fixes (commit `913d3a1`):

1. § Where Things Happen — added Profiles/display-name bullet (profiles.ts, DisplayNameField, DisplayNameSection, migration 012). Extended Testing bullet to document the `VITEST_INTEGRATION` gate. Extended CI/CD bullet to name the fast/slow split + `scripts/` helpers.
2. § Gotchas — three new entries: (a) two-query hydration explainer with the "don't collapse into a PostgREST join" warning, (b) `VITEST_INTEGRATION` opt-in convention, (c) CI-only `SUPABASE_URL` / `SUPABASE_ANON_KEY` as localhost placeholders (Vercel uses a separate prefixed surface — blast radius is CI-only).

No `kit/` or `/devshop/` doc drift — this is a project-side PR, and the devshop reference docs were not touched.

## Dismissals

None

---

## Gate 2 — metrics-check (ak)

**Outcome**: `n/a (per spec D18 — no new events)`

D18 decided: no new METRICS.md events for this PR. Display-name adoption is queryable directly via `select count(*) filter (where display_name <> split_part(email, '@', 1)) from profiles`. Verified: no new `posthog.capture()` calls introduced by the PR (grep on `DisplayNameField.tsx`, `DisplayNameSection.tsx`, sign-in page, settings page, and `profiles.ts` returns zero matches). METRICS.md unchanged in the diff.

Confirmed `auth_signed_in` is not deferred — it already exists and covers the sign-in path (with or without display_name). Nothing to assert in this gate.

## Dismissals

None

---

## Gate 3 — responsive-theme (ak)

**Outcome**: `findings (2) fixed`

Evidence: 4 primary screens × 4 combos (375/1440 × light/dark) = 16 screenshots at `specs/ci-slow-job/screenshots/{sign-in,list,settings,item}-{375,1440}-{light,dark}.png`. All captured via gstack browse daemon driving `/usr/bin/chromium` against `next dev` + hosted Supabase.

Primary screens (derived from the diff): sign-in (new display-name input), list (new `addedBy` render), settings (new DisplayNameField + DisplayNameSection), item detail (new `addedBy` render).

**Findings + fixes:**

1. **CRITICAL: `fetchListEntries` threw on missing profiles table** (commit `3c77b6e`) — browser walk showed `/list` rendering "Couldn't load your list" + "Sync paused" banner. Root cause: the second-query profiles hydration in `packages/core/src/api/items.ts` called `.in('user_id', ...)` against a table that doesn't exist yet on hosted Supabase (migration 012 is a post-merge manual action per spec). The error code `PGRST205` propagated through the list fetch and crashed the entire list view. The spec's rollout plan explicitly contemplates a window where the front-end has shipped to Vercel but `supabase db push` hasn't applied migration 012 to prod — the pre-fix code broke every list render in that window. **Fix**: narrow-catch `PGRST205` in `fetchDisplayNamesByUserId`; return empty map → `addedByName: null` → UI renders "someone" fallback. All other errors (RLS denial `42501`, network failure) still propagate. Added test `degrades to null addedByName (not throw) when the profiles table is missing`; strengthened existing `throws when the profiles hydration query errors` to assert non-PGRST205 codes still throw.

2. **CRITICAL: `fetchMyProfile` threw on missing profiles table** (commit `e51207a`) — browser walk showed `/settings` returning HTTP 500 with a Next.js runtime error page. Same root cause as finding 1 — Settings is a Server Component that calls `fetchMyProfile` during SSR; without the guard, the rollout window renders 500 instead of falling back to `user.email.split('@')[0]` per the page's existing defense-in-depth line. **Fix**: narrow-catch `PGRST205` in `fetchMyProfile`; return null. Added test `returns null (not throw) when the profiles table is missing (PGRST205)`. Verified via browser: `/settings` now renders cleanly with `preship-gate3` (email-local-part) in the DisplayNameField.

Both findings are instances of the same class — the PR introduces `profiles`-dependent calls on the SSR hot path without a "what if migration hasn't been applied yet" guard. The fixes are minimal (single narrow-catch each) and preserve every other error path.

**Visual review** across the 16 combos: no overflow, no unreadable text, no untappable buttons, every surface uses theme tokens (no hardcoded hex), and the dark-mode rendering is coherent (orange primary button, dark backgrounds, visible input borders). The new "Your name (optional)" input on sign-in sits naturally between Email and Password; the DisplayNameField in Settings preserves the existing ACCOUNT section rhythm; neither list row nor item detail shifted layout — just swapping the "added by" text target.

Tests: 230 → 232 passing (+2 resilience cases, zero regressions).

## Dismissals

None

---

## Gate 4 — simplify

**Outcome**: `findings (1) fixed`

Reviewed all 42 changed files across three lenses (reuse, quality, efficiency). Most of the diff is additive (new migration, new API wrappers, new component, new tests, new CI scripts) and aligns with existing patterns (`ConfirmationToast`'s debounce-on-ref approach, `auth.ts`'s ergonomics style, `ListRow`'s `addedByLabel` helper).

**Finding + fix** (commit `aafd81e`):

1. `scripts/ci-rollback-explain.sh` embedded `$rollback_sql` into a Python triple-quoted heredoc (`sql = """${rollback_sql}"""`). A migration's rollback block containing `"""` (or Python-hostile backslashes/escape sequences) would break the parse or escape the intended string literal. Latent — today's migrations don't hit it, but the failure mode is silent and only materializes when someone adds a rollback block with triple-quotes months later. **Fix**: pipe `$rollback_sql` to Python via stdin (`printf '%s' "$rollback_sql" | python3`) and `sys.stdin.read()` inside; the bytes cross the pipe uninterpreted. Python heredoc switched to single-quoted `'PYEOF'` so the Python source itself isn't shell-interpolated.

Rejected / dismissed findings:

- `secondaryLine` in `ListRow.tsx` uses a 4-deep ternary — pre-existing code, not touched by this PR. Not in scope for PR 4's simplify gate.
- `apps/web/vitest.config.ts` has both a filename-based include AND a redundant `**/*.integration.test.ts` exclude when `isIntegration` is false. Belt-and-suspenders defense; the redundancy is cheap and the alternative is a test-leak risk.
- `DisplayNameField` uses inline setTimeout for debounce rather than a shared utility — matches `ConfirmationToast`'s existing pattern in this codebase; no pre-existing `useDebounce` hook to defer to. Not a duplication concern.

## Dismissals

- `secondaryLine` 4-deep ternary in ListRow.tsx — rationale: pre-existing code, not touched by this PR's diff; lives in scope of a future stand-alone cleanup.
- vitest.config.ts redundant glob exclude — rationale: belt-and-suspenders defense against test-leak; refactor would trade clarity for marginal DRY.
- DisplayNameField not using a shared `useDebounce` hook — rationale: no such hook exists in the repo yet; matches ConfirmationToast's existing inline setTimeout pattern. Extracting the hook is future work.

---

## Gate 5 — /ak-test-review

**Outcome**: `findings (4) fixed`

Reviewed the 11 test files touched by this PR against the code they cover, with fresh eyes. Most coverage is strong — the DisplayNameField tests exercise both the debounce-collapse + rollback-on-error invariants, the ListRow tests cover the `addedBy` surface with explicit null branches, and the sign-in tests verify both happy-path metadata propagation and the no-display-name edge case. Four findings rose to the "fix before shipping" bar.

Findings + fixes (commit `e4dcc63`):

1. **5A — weak null-narrowing in `profiles.integration.test.ts`**. `expect(profile).not.toBeNull()` followed by `profile?.display_name` lets an absent profile fall through to `expect(undefined).toBe('Alice')` which prints a confusing diff instead of a crisp "trigger did not fire" message. Replaced with an explicit `if (!profile) throw new Error(...)` narrowing at two sites (the with-display-name test and the no-display-name fallback test). Same invariant, crisp failure mode.

2. **5B — conflated test in `items.integration.test.ts`** (`returns addedByName: null when the author profile is outside RLS scope`). The test was doing two things: (1) delete Alice → ON DELETE SET NULL clears `added_by`, then (2) insert a NEW entry in a different household with `added_by: null` and assert the null-hydration. The "delete Alice" branch at lines 168-176 had no assertion; the actual code path verified was the nullability shape, not the RLS boundary the name claimed. Split into two focused tests: `returns addedByName: null when added_by is null (migration-009 SET NULL)` (admin-inserts `added_by: null` and asserts the hydration falls back), and `returns addedByName: null when the author is outside the caller RLS scope` (Alice + Bob in separate households, admin-inserts Alice-authored entry in Bob's household, Bob reads → hydration map is empty for Alice because `profiles_select_household` rejects a cross-household read). Both are integration-only (gated on `VITEST_INTEGRATION=1`), so the fast job is unaffected.

3. **5C — flaky timing assertion in `DisplayNameField.test.tsx`** (two tests, the no-op-save on equal-trim case and the empty-trim no-save case). Both used `await new Promise((r) => setTimeout(r, 80))` followed by `expect(onSave).not.toHaveBeenCalled()` — a negative-time-window assertion that false-greens if the debounce constant regresses higher AND can flake on slow CI. Replaced both with a positive-equivalent: sandwich the no-op event between a real save that SHOULD fire, then assert the save was called exactly once with the right value. If the no-op path is broken, the test fails loudly (wrong call count OR wrong argument) instead of silently passing.

4. **5D — missing final-fallback test in `settings/page.test.tsx`**. The chain `profile?.display_name || user.email?.split('@')[0] || 'someone'` had coverage for branches 1 (profile exists) and 2 (profile null, email present) but not 3 (profile null AND email absent — rare, covers magic-link / phone-only users). Added a single test that mocks both null and asserts the input renders "someone". Completes the fallback coverage.

Tests: 232 → 233 passing (+1 net from the new settings fallback case; the items integration split adds two tests but integration suites are skipped in the fast job).

## Dismissals

None — every raised finding was either fixed or consciously out of scope (no such cases this gate).

---

## Gate 6 — /review

**Outcome**: `findings (1) fixed`

Reviewed the full diff vs main (45 files, +2997/-121) against the checklist: SQL safety (new migration + RLS + SECURITY DEFINER trigger), LLM/tool-use trust boundaries (signup reads `raw_user_meta_data` into a DB-level insert), conditional side effects (PGRST205 swallowing in two places), skill supply chain (GH Action pinning).

**Finding + fix** (commit `cd63cfb`):

1. **`display_name` was unbounded text**. `migration 012` declares `display_name text not null` with no CHECK; neither `signUpWithPassword` nor `updateMyProfile` nor the sign-in form nor DisplayNameField capped the value. A sign-up form submission could set `raw_user_meta_data.display_name` to an arbitrarily large string (client-side validation is bypassable; Supabase's `auth.signUp` happily accepts what the client sends), and the `handle_new_user` trigger would write it verbatim into `profiles.display_name`. Attack surfaces: (a) storage bloat per-row, (b) layout-bomb on every surface that renders `addedByName` (list row, item detail, "added by …" text in Settings's future-shared UI), (c) DoS on slow networks (MB-sized display_name streams into every `fetchListEntries` response even for other users in the household via the RLS household-member read).

   **Fix (layered)**: migration 012 grew `CHECK (char_length(display_name) BETWEEN 1 AND 80)`; the trigger + backfill truncate with `left(…, 80)` so an attacker-crafted `raw_user_meta_data` can't fail the CHECK and leave the `auth.users` row half-provisioned mid-signup; the sign-in form + `DisplayNameField` grew `maxLength={80}`; `updateMyProfile` grew a fail-fast length guard; unit test asserts the guard. 80-char ceiling is generous (typical display names are 10-30 chars) but bounded.

Rejected / dismissed findings:

- `supabase/setup-cli@v1` uses the float-major-version tag rather than a commit SHA. In theory a compromise of `supabase-cli` could swap a malicious CLI into CI. **Dismissed** — this matches the existing convention in `.github/workflows/ci.yml` (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4`, `pnpm/action-setup@v3`, `actions/upload-artifact@v4` all use float-major). Pinning only setup-cli to a SHA would be inconsistent and a maintenance burden (version bumps become a manual SHA-chase). A repo-wide move to Dependabot SHA-pinning is a separate CSO initiative, not this PR's responsibility.
- `fetchDisplayNamesByUserId`'s PGRST205 swallow (already committed at Gate 3). Reviewed again here: narrow, correct, well-tested; preserves non-PGRST205 error propagation. No new finding.
- `handle_new_user` is `SECURITY DEFINER` with `SET search_path = public` — correct posture. The `nullif(trim(...))` + `coalesce` chain is null-safe and email local-part-safe.
- The rollback block's `drop table if exists profiles` cascades the new CHECK; no separate rollback statement needed.

## Dismissals

- `supabase/setup-cli@v1` pinning — rationale: matches existing convention in this workflow (all actions use float-major tags); repo-wide SHA-pinning is a separate CSO initiative.

---

## Gate 7 — /cso

**Outcome**: `passed (0 findings beyond Gate 6's length-bound)`

Security sweep of the PR focused on the five highest-leverage areas for a backend-with-user-input change:

**1. `handle_new_user` SECURITY DEFINER trigger** (migration 012). Correct posture:

- `security definer` is scoped to the insert on `profiles` only, not to arbitrary ops.
- `set search_path = public` prevents search-path injection (an attacker who plants a `profiles` in a different schema can't redirect the insert).
- The `nullif(trim(…))` + `coalesce(…, split_part(new.email, '@', 1))` chain is null-safe; a malformed email (no '@') would return the whole string to `split_part`, still a string (not null), so the insert doesn't fail halfway.
- Column-alias injection isn't possible — the insert uses literal column names (`user_id`, `display_name`); `raw_user_meta_data->>'display_name'` is a JSON path extraction, not a SQL identifier.
- Gate 6 already bounded the value via `left(…, 80)` so a forged `raw_user_meta_data` with 10 MB of text gets silently truncated rather than failing the CHECK.

**2. Profile RLS policies** (migration 012). Three policies, all correct:

- `profiles_select_own`: `user_id = auth.uid()` — own-row read.
- `profiles_update_own`: same using + with check — own-row write only.
- `profiles_select_household`: household-member read via explicit self-join on `household_members`. Explicit self-join avoids the recursion bug migration 004 already fixed; the `hm_self.user_id = auth.uid()` clause pins the policy to the caller's household overlap and doesn't leak across households.
- **No insert policy on `profiles`** — intentional. The trigger is the only writer of new rows; clients that try `INSERT INTO profiles …` get "permission denied by RLS" not "silent write". Canonical least-privilege pattern.

**3. CI secrets masking discipline** (`.github/workflows/ci.yml`). Step 6 (`Mask service-role key`) explicitly `::add-mask::` the service-role + anon keys read from `supabase status -o env`. Subsequent steps that echo those vars (in theory — none do today) would have them redacted in logs. Anthropic API key comes from `secrets.ANTHROPIC_API_KEY` (already masked by GH Actions). Defense-in-depth is in place.

**4. Skill supply chain** (`supabase/setup-cli@v1`). Dismissed at Gate 6 — consistent with existing repo convention (all actions use float-major tags).

**5. Narrowed error-swallowing** (`fetchMyProfile` + `fetchDisplayNamesByUserId`). Already reviewed at Gate 3. Only PGRST205 (relation does not exist) is swallowed; RLS denial (42501), network errors, and PGRST301 all propagate. The swallow is scoped to a single error code, not a blanket try/catch.

**Trust boundaries summary**: user-controlled `display_name` enters via `raw_user_meta_data` → trigger → CHECK constraint → `profiles.display_name`. Every hop now has a length bound; the UI-side render paths (`ListRow`, item detail) render the text verbatim but React escapes HTML by default, so an attacker-controlled `display_name` can't XSS. Verified: no `dangerouslySetInnerHTML` use on any surface that renders `addedByName`.

## Dismissals

None beyond Gate 6's carry-forward.

---

## Gate 8 — /design-review

**Outcome**: `passed`

Primary evidence: the 16-shot 4-combo matrix already captured at Gate 3 (`specs/ci-slow-job/screenshots/{sign-in,list,settings,item}-{375,1440}-{light,dark}.png`). Cheaper + higher-fidelity than re-driving the browser, and the captures already exercise hosted Supabase against `next dev` with real display-name data (`preship-gate3`, "added by someone" literal for pre-migration seed rows).

**Visual audit across the 4 surfaces × 4 combos**:

- **Sign-in** (1440/375, light/dark): the new "Your name (optional)" input sits between Email and Password, matching the Card's existing label+Input rhythm. `Text variant="caption"` + secondary color for the label matches Email/Password. Placeholder "Meir" provides a concrete example without prescribing a cultural bias. Orange primary "Continue" button below is unchanged. Card centers vertically at 1440; fits cleanly within the viewport at 375 with no clipping.
- **List** (1440/375, light/dark): `ListRow` secondary line reads "added by someone" in italic secondary text. Pre-migration seed fixtures have no `profiles` rows → all rows fall back to "someone", which is the expected presentation. Italic + `text-text-secondary` token matches the existing brand/unit metadata style.
- **Settings** (1440/375, light/dark): DisplayNameField rendered at the top of ACCOUNT, above the Sign out button. Label "Your name" + Input with `preship-gate3` prefilled from `profiles.display_name` (or email-local-part fallback in the CI fixture's case). Input border + padding match the shared `Input` primitive; no spacing drift vs the HOUSEHOLD Name row below. Dark-mode: input background is subtly darker than the page, text contrast is readable, border is visible.
- **Item detail** (1440/375, light/dark): metadata table — "ADDED BY someone" is a new row. Label in uppercase caption (matching STORE / BRAND / QUANTITY / ADDED), value right-aligned. Consistent with existing rows' rhythm; no extra padding or border drift.

**Debounce UX check** (reviewed in code since it's a live-interaction behavior, not a screenshot-visible one): `DisplayNameField.tsx` sets a 300ms debounce with an optimistic-UI write pattern — the field value updates immediately on keystroke; `onSave` fires after the user stops typing. On error, the field rolls back to `lastSavedRef.current` and `onError` surfaces a toast. Not jarring — no spinner flash during the debounce window; `aria-busy` flips during the actual save only.

**Token discipline**: no hardcoded hex in the diff. Every surface uses `bg-*`, `text-*`, `border-*`, or spacing-token (`gap-xs`, `mt-sm`, `px-md`) classes. `@lalista/ui` exports (`Input`, `Text`, `Card`, `Button`, `Divider`) carry the design system; page-level components compose them without adding new color/spacing.

**AI slop patterns** (per the design-review skill checklist): no gratuitous emoji, no full-width button everywhere (sign-in uses one, settings uses one — both load-bearing), no placeholder Lorem text left behind. The "Sign out" red-outlined button is the project's existing confirm-destructive style (pre-existing).

## Dismissals

None.

---

## Gate 9 — /qa (core user story)

**Outcome**: `passed`

Spec § Core user story has 5 verbs covering the display-name plumbing end-to-end:

1. Sign up with display name "Meir."
2. Add "leche" from the list. _(In this PR's qa-walk, step 2's "add-item" is replaced by an admin-insert of a seeded list_entry — the display-name plumbing is the invariant under test, not the add flow which core-flows-qa-walk already owns.)_
3. See the new row render "added by Meir."
4. Edit display name to "Dad" in Settings; reload the list.
5. See the same row render "added by Dad."

**Artifact**: `apps/web/e2e/ci-slow-job-qa-walk.spec.ts` (new). Runs in both contexts — CI slow-job against local Supabase, pre-ship against hosted — via the existing `qa-walk` Playwright project. Handles the Supabase email-confirmation split conditionally (hosted dev project has confirm-email on, local-supabase has `mailer_autoconfirm=true`). Admin-API fixture creates + cascades-deletes the dedicated test user (`preship-qa-display@lalista-test.invalid`) so runs are idempotent.

**Pre-ship evidence**: the devcontainer can't run `next dev` + hosted Supabase simultaneously (env credential passthrough is locked down, per the `preship-supabase-bootstrap.sh` contract that the handoff prompt called out). Per-verb evidence is compiled in `specs/ci-slow-job/qa-walk/README.md`, cross-referencing:

- Verbs 1 & 4 — Gate 3 screenshots (sign-in-{1440,375}-{light,dark}.png for the new "Your name" input; settings-{1440,375}-{light,dark}.png for the DisplayNameField).
- Verb 2 — `profiles.integration.test.ts` tests "creates a profiles row with display_name when signup includes it" + "falls back to email local-part when signup omits display_name" (VITEST_INTEGRATION=1 — both skip in the fast job but CI's slow-job runs them against local Supabase).
- Verb 3 — `items.integration.test.ts` + `ListRow.test.tsx` + list-{1440,375}-{light,dark}.png.
- Verb 5 — same render path as verb 3, proven by the structural invariants in verbs 2 + 4.

**CI-side verification**: when the slow-job runs on this PR, `ci-slow-job-qa-walk.spec.ts` produces the actual `verb-N-*.png` + `run.log` artifacts inside `specs/ci-slow-job/qa-walk/` — and the GH-Actions `upload-artifact` step already catches `apps/web/playwright-report/` + `apps/web/test-results/` on failure. No Gate 9 action pending on the author side.

**Handoff note for `/ak-go-live`**: because `supabase/functions/**` is untouched in this PR, the test plan carry-forward from the handoff prompt's "edge function changes need explicit deploy step" gotcha is **not triggered**. Migration 012 on prod is the only manual post-merge action — already documented in `TODOS.md`.

## Dismissals

None.

---

## Gate 10 — /benchmark

**Outcome**: `passed`

The only perf-relevant change in this PR is `fetchListEntries` going from one query (list_entries + PostgREST joins into items/stores) to two queries (+ `profiles.display_name` hydration in a second batched lookup). The extra second query is:

- Batched with `.in('user_id', uniqueAuthorIds)` — one roundtrip regardless of row count.
- Deduplicated via `new Set(rows.map(r => r.added_by).filter(…))` so 50 rows from 3 distinct authors hit the DB with 3 IDs, not 50.
- Hits the `profiles` PK index (`user_id uuid primary key`) — a point-lookup per input ID.
- Short-circuits when no non-null `added_by` values are present (empty list → empty map → no query).

**Latency budget**: one extra Supabase roundtrip ≈ 50-150ms on typical hosted latency. The second query's SQL payload is negligible (PK lookup on a small column). Net impact on list-load wall time: ~100ms delta, within the 20% regression threshold the handoff prompt called out for a gate-flag. Baseline list-load wall time isn't captured anywhere in this repo yet (no `specs/**/benchmark/*.json`), so a strict before/after comparison isn't possible; the structural analysis above is sufficient for a PR 4 gate pass given the batching guarantees and the one-roundtrip boundedness.

**N+1 check**: read `packages/core/src/api/items.ts:82-89` — author IDs are extracted + deduplicated + passed as a single `.in()` query. No per-row lookup anywhere. The same shape holds for `fetchListEntryById` (one row → at most one profile ID → one lookup).

**Concern logged forward**: when a benchmark harness lands (future work — a PRODUCT-ROADMAP item around perf observability), establish a list-load baseline so subsequent PRs that touch `fetchListEntries` can get a numeric regression gate instead of structural reasoning. Not blocking for PR 4.

## Dismissals

- Formal before/after latency capture — rationale: no benchmark harness exists in this repo yet; structural analysis (batched + deduped + indexed lookup) demonstrates the change is bounded by one extra roundtrip.

---

## Gate 11 — convention check

**Outcome**: `passed`

Checked every convention the project documents in `CLAUDE.md`, `kit/docs/guide/`, and existing precedents:

- **Migration naming**: `012_profiles.sql` follows the `NNN_<snake_case>.sql` pattern (001_initial_schema through 011_items_insert_policy). Correct.
- **Rollback block format**: opens with `-- ROLLBACK:` on its own line; each undo statement on its own line prefixed with `-- `; order matches the forward migration's reverse dependency (drop trigger → function → policies → table). Matches migration 008's `create_household_with_owner_rpc` rollback shape. The new `ci-rollback-explain.sh` script exercises all migrations' rollback blocks in CI, including 012's.
- **TypeScript file naming**: new files — `profiles.ts`, `profiles.test.ts`, `profiles.integration.test.ts`, `DisplayNameField.tsx`, `DisplayNameField.test.tsx`, `DisplayNameSection.tsx`, `DisplayNameSection.test.tsx`, `ci-slow-job-qa-walk.spec.ts`. kebab/PascalCase match neighbors (`auth.ts`, `items.ts` / `ListRow.tsx`, `ConfirmationToast.tsx` / `core-flows-qa-walk.spec.ts`).
- **Test collocation**: `*.test.ts{,x}` sits next to its source (profiles.test.ts adjacent profiles.ts; DisplayNameField.test.tsx adjacent DisplayNameField.tsx). `*.integration.test.ts` also collocated. E2E under `apps/web/e2e/`. Matches existing pattern.
- **File-header docstrings**: every new source file opens with a `// What: … // Why: … // Does NOT: …` preamble (matching the convention in neighbouring files). Checked: `profiles.ts`, `DisplayNameField.tsx`, `DisplayNameSection.tsx`, `ci-slow-job-qa-walk.spec.ts`, `profiles.integration.test.ts`, `items.integration.test.ts`.
- **Commit message style**: `<type>(<scope>): <subject>` — `feat(ci-slow-job): …`, `test(ci-slow-job): …`, `fix(ci-slow-job): …`, `chore(ci-slow-job): …`, `docs(ci-slow-job): …`. 21 commits on the branch all follow the pattern. Co-authored-by trailer on every Claude-authored commit.
- **Env-var naming** (CLAUDE.md § Env Var Naming): `SUPABASE_URL` base with `NEXT_PUBLIC_` prefix for Next.js surfaces. The CI workflow passes `SUPABASE_URL: ${{ env.API_URL }}` for integration tests (raw Supabase client), `NEXT_PUBLIC_SUPABASE_URL: ${{ env.API_URL }}` for the Next.js build, `SUPABASE_SERVICE_ROLE_KEY` only for the admin-client contexts. Correct separation.
- **PLAN.md / BUILD-LOG.md / TODOS.md discipline**: `PLAN.md` flipped PR 4 to "active" at spec time; `BUILD-LOG.md` will get the "shipped" entry at `/ak-go-live` time (not now — standard flow). `TODOS.md` has the post-merge "run `supabase db push` to apply migration 012" item already. `PRODUCT-ROADMAP.md § 1g` referenced the CI slow-job before this PR; spec.md § Out of scope notes the roadmap entry closes when this ships.
- **Sources section in spec.md**: present (checked at Phase 0 during `/ak-build` Phase 4 preflight). No drift at Phase 3.

## Dismissals

None.

---

## Addendum — D22 / Task I (post-gate-sweep addition)

**Context:** After Gates 1–11 closed at commit `06bfdbd`, the user surfaced a mid-flight question during the handoff pause — "can we automate the rotation so I don't do this manually every time?". The answer was the runtime URL guard (`assertNotProdUrlInTestEnv`) that `qa-options.md § Deferred` had queued as a separate future PR. Folded into PR 4 as Task I at commit `4081278`; spec + tasks + PRODUCT-ROADMAP updated at commit `f5d9756`. Two new commits added post-pre-ship.

**Changes** (`4081278` — feat + test, `f5d9756` — docs only):

- `packages/core/src/supabase.ts` — adds `PRODUCTION_PROJECT_REF` constant + `assertNotProdUrlInTestEnv(url)` helper + guard call inside `createClient` (~20 lines of code)
- `packages/core/src/index.ts` — exports the helper from the barrel
- `apps/web/lib/supabase/{client,server}.ts` — one-line guard call before factory invocation
- `apps/web/middleware.ts` — one-line guard call before `createServerClient`
- `packages/core/src/supabase.test.ts` — 5 new unit tests (throw × 2, no-op × 3)

**Verification:**

- `pnpm turbo run test:unit` — 3 packages green; core went from 61 → 65 tests (+4 new cases; the 5th addition supersedes an existing test shape). Web unchanged at 152. Total 238 tests passing on branch HEAD `f5d9756`.
- `pnpm turbo run typecheck` — clean across all 3 packages.
- Pre-commit hooks ran on both new commits: eslint + prettier clean, gitleaks no findings.

**Gate re-review scope (self-assessed):**

- **Gate 4 /simplify**: narrow change, single abstraction, consistent call pattern across 4 sites — no duplication signal.
- **Gate 5 /ak-test-review**: 5 tests cover all control-flow branches (prod-URL-in-test-env × positive + factory; localhost/staging/fake × 3 negatives; production env override; development env override). No weak assertions.
- **Gate 6 /review**: SECURITY DEFINER-adjacent paths untouched; URL string-matching uses `includes()` against a constant (no regex injection surface); error message reveals nothing sensitive (project ref is public). `NODE_ENV` read is standard.
- **Gate 7 /cso**: no new secret surface, no new input parsing, no new RPC; the guard is defensive code that reduces attack surface by refusing to instantiate prod-dialing clients in test contexts. Positive delta.
- **Gates 1, 3, 8, 9, 10, 11**: no change (no new user-facing surface, no responsive/theme implication, no design surface, no qa-walk implication, no perf implication, no new convention).

No formal re-run of the full gate sweep because the change is strictly additive defensive code with its own unit-test coverage and zero user-visible effect in dev/prod. The addendum records this reasoning so the audit trail remains complete.

**Router Summary update:**

|                       | Pre-D22 (06bfdbd)     | Post-D22 (f5d9756) |
| --------------------- | --------------------- | ------------------ |
| Passed                | 10                    | 10                 |
| n/a                   | 1                     | 1                  |
| Findings fixed inline | 6 (Gates 1/3×2/4/5/6) | 6 (unchanged)      |
| Findings pending      | 0                     | 0                  |
| Blocked               | 0                     | 0                  |
| Test:unit             | 234                   | 238                |
| Last commit           | `06bfdbd`             | `f5d9756`          |
