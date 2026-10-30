<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: e2e-audit-fill-gaps -->
<!-- date: 2026-04-26 -->

# Spec: e2e-audit-fill-gaps (PR 5)

**Sources:**

- `TODOS.md § v0 § Pre-ship § e2e-audit-fill-gaps` — primary scope: audit current Playwright E2E coverage vs. every user-observable surface today + fill identified gaps. Goal: every Core user story verb + every RLS/auth boundary has at least one E2E scenario. Scoped to what exists today, not speculative features.
- `PLAN.md § Planned` row #1 — PR 5 assignment, gated on PR 4 merging first (slow-job must exist for the new specs to have anywhere to run).
- `/devshop/kit/ROADMAP.md § v0 § Pre-commit test-presence hook (project repo)` — paired devshop-side convention; this PR's `CLAUDE.md` doc invariant lands ahead of the hook.
- `apps/web/e2e/add-new.spec.ts` — gold-standard pattern for admin-client DB assertions in slow-job E2E (service-role JWT, `auth: { autoRefreshToken: false, persistSession: false }`, unique-per-run timestamps, `test.skip()` when `SUPABASE_URL` isn't local-stack).
- `apps/web/playwright.config.ts` — `mobile` + `desktop` projects (the new specs run in both); `qa-walk` project is isolated and not relevant here.
- `apps/web/components/ListClient.tsx:119,164` — `setSyncError({type:'query'|'realtime'})` trigger paths informing the realtime-spec banner test.
- `apps/web/components/SyncErrorBanner.tsx` + `.test.tsx` — banner unit-tested but never E2E-triggered today; this PR closes that gap.
- Prior spec `specs/ci-slow-job/spec.md` — style + structure reference (Decisions section format, Sources list, In scope / Out of scope split).

PR 5 cashes the check PR 4 wrote: slow-job CI exists + is the canonical
test bed, but covers only ~5 scenarios. This PR audits Playwright E2E
coverage against every user-observable surface today and fills the
identified gaps with 5 narrow specs (auth-edge-cases, item-detail,
settings, realtime, force-create-race). No app code, no schema, no
migrations, no METRICS events — purely test infrastructure. Pairs with
the devshop-side pre-commit test-presence hook (deferred) by landing the
"E2E-per-surface invariant" doc in `CLAUDE.md` so future PRs follow the
convention even before the hook lands.

---

## Decisions (resolved at spec time)

9 `/ak-spec`-time decisions resolved in Phase 0 with the user. Phase 1
preserves this section verbatim.

### D1: How many new spec files?

**Decision:** 5 new files under `apps/web/e2e/`: `auth-edge-cases.spec.ts`,
`item-detail.spec.ts`, `settings.spec.ts`, `realtime.spec.ts`,
`force-create-race.spec.ts`.

**Rationale:** One coherent surface per file. Mirrors existing convention
(`add-new.spec.ts`, `landing-routing.spec.ts`, `theme.spec.ts`). Smaller
files = clearer naming = easier audit-trail when a future PR adds another
gap-filler.

### D2: Direct E2E for `households` + `stores` API wrappers?

**Decision:** Skip both. Document rationale under "Out of scope" in this
spec.

**Rationale:** TODOS calls them gaps, but they're transitively covered:
`fetchUserHouseholds` / `fetchUserMemberships` / `createHousehold` are
exercised end-to-end by `auth.spec.ts`'s signup → onboarding flow;
`fetchStores` is exercised by `core-flows.spec.ts`'s disambig store-cascade.
A direct UI-level E2E for either would re-test transitively-covered paths
without coverage gain. The audit considered them and explicitly skipped —
that's the right outcome for "every Core user story verb + every RLS/auth
boundary has at least one E2E scenario": both APIs already do.

### D3: What's in `auth-edge-cases.spec.ts`?

**Decision:** 3 active + 3 skipped tests.

Active:

1. Sign-in (existing user) returns to `/list` — distinct from signup-onboarding (which `auth.spec.ts` covers).
2. Sign-out invalidates the session cookie — after click, next `/list` request redirects to `/sign-in`.
3. Duplicate-email signup surfaces the friendly error — `friendlyAuthError()` mapping, not the raw Supabase string.

Skipped (with `test.skip()` + TODO pointer):

4. Email-not-confirmed bounce — needs admin-API mock of `email_confirmed_at: null` AND verification that middleware allow-lists confirmed-only. Skip until middleware contract is verified.
5. Rate-limit rejection — no reliable trigger in CI without polluting the rate-limit window for parallel test runs.
6. Password-reset request — `/auth/callback` route doesn't exist yet; blocked on `/devshop/kit/ROADMAP.md § v0 § Auth UX conventions` shipping the route handler.

**Rationale:** Active 3 are the high-confidence gaps with reliable triggers.
Skipped 3 use `test.skip()` (not `.fail()` or commented-out) — explicit,
grep-able, and each carries a TODO pointing at its unblocker. TODOS.md gets
3 narrow carry-forward entries (one per skipped test) so the unblock is
trackable.

### D4: `realtime.spec.ts` shape

**Decision:** Two `browser.newContext()` instances signing in as two members
of the same household. Context A adds an item via the UI; context B asserts
the new row appears in its list view within 3 seconds without a manual
reload. `test.skip()` when `SUPABASE_URL` isn't a local-stack URL
(matches `add-new.spec.ts:38-42` precedent).

**Rationale:** Hosted Supabase free-tier has Realtime connection limits +
WS allowlist friction; running this against the slow-job's `supabase start`
local stack is the realistic path. Two contexts is the minimal way to
exercise cross-session realtime — single-context with two pages would still
share the auth session and the WebSocket would be reused. Provisioning two
household members per test: signup user A → create household → invite
user B (use admin-client to create the second member directly, skipping the
full invite flow which doesn't exist yet).

### D5: Sync-error banner — own spec or in `realtime.spec.ts`?

**Decision:** Folded into `realtime.spec.ts` as a separate test in the same
describe block.

**Rationale:** Banner fires from `setSyncError({type:'realtime'})` after
CHANNEL_ERROR (`ListClient.tsx:164`) — same plumbing as the cross-session
test. Trigger via `page.route('**/realtime/v1/websocket**', route =>
route.abort())` before navigating to `/list`, then assert
`getByText(/sync error/i)` (or whatever copy `SyncErrorBanner.tsx`
renders). Sharing a file = shared admin-client setup + shared
household-fixture creation → less boilerplate.

### D6: `force-create-race.spec.ts` shape

**Decision:** Two browser contexts, both sign in to the same household,
both submit force-create with the same novel utterance via `Promise.all`
on the form-submit click. Assertions:

- One context's request wins the `items.name_canonical` unique insert.
- The other context's request hits `23505` and falls through to the
  existing-candidate path (NOT an error).
- Both contexts end up with a `list_entries` row pointing at the same
  `items.id`.

**Rationale:** Real concurrency, real DB. The integration test in
`packages/core/src/api/items.integration.test.ts` (or equivalent) covers
the function-level race; the E2E here exercises the full UI path including
the toast/loading-state UX during the race. Local-stack only (same
`SUPABASE_URL.startsWith('http://127.0.0.1:')` skip as `add-new.spec.ts`).

### D7: `item-detail.spec.ts` — one walk or three small tests?

**Decision:** One walk per viewport: seed entry → navigate to `/item/[id]`
→ change store → assert DB → change brand → assert DB → delete row →
assert deletion + redirected back to `/list` (and item is gone from list).

**Rationale:** Single-walk minimizes signup overhead (each test's auth
setup is ~5s of UI). Three independent tests would triple wall-time
without coverage gain — the edits are independent in the data model but
sequential in user reality (you don't open item-detail just to change
brand alone). Each step uses admin-client DB assertions (not just
re-reading the UI) so the test fails fast if the write didn't reach
Postgres.

### D8: `settings.spec.ts` scope

**Decision:** Two tests:

1. Household-info read-only display matches DB (the read side — household
   name + member count rendered from `fetchUserHouseholds` + member list).
2. Sign-out button click → next `/list` request redirects to `/sign-in`
   (cookie invalidation; the sign-out path is also folded into D3 #2 as
   the auth-side assertion).

Display-name editing is already covered by
`ci-slow-job-qa-walk.spec.ts:132` ("walks all 5 display-name Core user
story verbs"). Don't duplicate.

**Rationale:** TODOS lists "household-info read-only view untested" and
"sign-out button click tested but no assertion that subsequent /list
request redirects to /sign-in" as gaps. Test #2 here is the redundant
counterpart to D3 #2 — keeping both because the trigger differs (Settings
UI vs. direct API call); shipping is cheap, the cost is one extra test.
Optional: collapse into D3 if pre-ship `/simplify` flags duplication;
default keep both.

### D9: `CLAUDE.md § Testing` "E2E-per-surface invariant" doc

**Decision:** Add the doc. Pre-commit hook adoption deferred to a future
PR after `/devshop/kit/ROADMAP.md § v0 § Pre-commit test-presence hook
(project repo)` ships.

Doc shape (~150-200 words):

- For every user-observable surface in `apps/web/app/**/page.tsx`, an E2E
  spec must exercise the primary action via the UI (not just the API
  wrapper).
- For every API wrapper in `packages/core/src/api/*.ts`, either (a) a
  dedicated E2E spec exercises it through the UI, OR (b) the wrapper is
  transitively covered by an existing spec (cite which one in the
  wrapper's JSDoc).
- New PRs adding a UI surface or API wrapper add a paired E2E in the same
  PR; pre-ship `/ak-test-review` flags missing pairs.

**Rationale:** TODOS step 6 explicitly asks for the invariant doc. The
hook is the enforcement mechanism; the doc is the convention. Doc lands
now so future PRs follow the convention even before the hook lands —
otherwise the next PR ships with a coverage gap and a "well, the hook
isn't live yet" excuse.

---

<!-- /ak-spec (Phase 1) expands the file from here: In scope, Out of
     scope, Per-spec test plan, Files to create/modify, Test data model,
     Wall-time budget, Dependencies, Task order, Gotchas, Acceptance /
     rollout / rollback. The Decisions section above stays verbatim. -->

## In scope

PR 5 is pure test infrastructure. No app code, no schema, no migrations,
no METRICS.md events. Seven implementation tasks, mirroring the live
tracker:

1. **`apps/web/e2e/auth-edge-cases.spec.ts`** — 3 active + 3 skipped tests covering sign-in vs. signup, sign-out cookie invalidation, duplicate-email signup surface (D3).
2. **`apps/web/e2e/item-detail.spec.ts`** — one walk per viewport: seed entry → `/item/[id]` → store change → brand change → delete → assert deletion + redirect (D7). _Note: matches PR 3's read-only item-detail surface; the "change store / change brand" steps are exercised via re-add (delete + add) since item-detail is read-only today, and via direct `list_entries` admin-client UPDATE for the DB-level assertion. See Per-spec test plan § item-detail for the precise UI path._
3. **`apps/web/e2e/settings.spec.ts`** — 2 active tests: household-info read matches DB; sign-out → next `/list` redirects to `/sign-in` (D8).
4. **`apps/web/e2e/realtime.spec.ts`** — 2 active tests in one `describe`: cross-session realtime (two `browser.newContext()` instances, A adds, B observes within 3s); sync-error banner via `page.route('**/realtime/v1/websocket**', route => route.abort())` (D4 + D5).
5. **`apps/web/e2e/force-create-race.spec.ts`** — 1 active test: two contexts force-create the same novel utterance via `Promise.all`; assert one `items` row with that `name_canonical`, two `list_entries` rows pointing at it (D6).
6. **`CLAUDE.md § Testing` "E2E-per-surface invariant" doc** — ~150-200 word convention paragraph (D9). Lands AFTER the 5 specs so it can reference the actual file layout.
7. **`TODOS.md` updates** — close the `e2e-audit-fill-gaps` pre-ship entry; add 3 narrow carry-forward entries (one per skipped test in D3) so each unblocker is trackable.

All 5 new specs are wired to both `mobile` + `desktop` projects via the
existing `playwright.config.ts` glob (no `testIgnore` entry needed —
they're picked up automatically). All 5 specs follow the gold-standard
pattern from `apps/web/e2e/add-new.spec.ts`: admin-client provisioning,
service-role JWT for DB-level assertions, unique-per-run timestamps in
emails + utterances, `test.skip()` predicate when `SUPABASE_URL` isn't
local-stack.

---

## Out of scope

Explicit non-deliverables for this PR:

- **Direct `households` API E2E.** Per D2: `fetchUserHouseholds` / `fetchUserMemberships` / `createHousehold` are exercised end-to-end by `auth.spec.ts`'s signup → onboarding flow. A direct UI-level E2E re-tests transitively-covered paths.
- **Direct `stores` API E2E.** Per D2: `fetchStores` is exercised by `core-flows.spec.ts`'s disambig store-cascade. No additional surface to test through the UI.
- **Pre-commit test-presence hook adoption.** Devshop-side. Tracked in `/devshop/kit/ROADMAP.md § v0 § Pre-commit test-presence hook (project repo)`. This PR lands the convention doc (D9); the enforcement hook lands in a later PR after the devshop helper ships.
- **Password-reset E2E** (D3 skipped #6). Blocked on `/auth/callback` route handler — devshop's "Auth UX conventions" helper ships that. Re-spec when the helper lands.
- **Email-not-confirmed bounce E2E** (D3 skipped #4). Blocked on verifying the middleware contract for `email_confirmed_at: null` users; needs an admin-API mock that lalista's middleware doesn't currently round-trip. Re-spec when the contract is verified.
- **Rate-limit rejection E2E** (D3 skipped #5). No reliable trigger in CI without polluting the rate-limit window for parallel test runs. Re-spec only if rate-limit becomes a recurring user-reported issue.
- **Retry / sharding tuning.** Defer until slow-job wall-time observed >5min on real PRs. The new specs are written as `fullyParallel: true`-friendly (each test is self-contained — its own user, household, utterance) so sharding is a config flip, not a refactor.
- **New METRICS events.** Pure testing infrastructure. If a spec discovers an analytics gap during implementation, STOP and ask — do not add silently.
- **Refactoring existing E2E.** No changes to `auth.spec.ts`, `core-flows.spec.ts`, `add-new.spec.ts`, `landing-routing.spec.ts`, `theme.spec.ts`, or any qa-walk variant. Pure additions.
- **Adding a `playwright.config.ts` `testIgnore` entry for the new specs.** The new specs run on `mobile` + `desktop` per the existing glob; only `qa-walk.spec.ts` carries a `testIgnore` (so the qa-walk-only project stays isolated).

---

## Per-spec test plan

Five new spec files. Each subsection below specifies file path, test names, setup pattern, key assertions, and skip predicate.

### `apps/web/e2e/auth-edge-cases.spec.ts`

**Path:** `apps/web/e2e/auth-edge-cases.spec.ts`

**Tests (3 active + 3 skipped):**

| #   | Name                                                 | Status         |
| --- | ---------------------------------------------------- | -------------- |
| 1   | `sign-in (existing user) returns to /list`           | active         |
| 2   | `sign-out invalidates the session cookie`            | active         |
| 3   | `duplicate-email signup surfaces the friendly error` | active         |
| 4   | `email-not-confirmed user is bounced from /list`     | skipped (TODO) |
| 5   | `rate-limited signup surfaces friendly error`        | skipped (TODO) |
| 6   | `password-reset request happy path`                  | skipped (TODO) |

**Setup pattern:**

- Admin-client at top-of-file (mirror `add-new.spec.ts` lines 24-33). Service-role JWT, `auth: { autoRefreshToken: false, persistSession: false }`.
- Tests 1+2: pre-create a confirmed test user via `supabase.auth.admin.createUser({ email_confirm: true })` in the test body (fresh per-test, unique timestamp in email). Sign in through the UI, run assertion, optional cleanup (rely on slow-job's `supabase db reset` between runs — see Test data model).
- Test 3: signup with email A succeeds; signup with email A again must surface the friendly error.
- `test.skip()` predicate (top of `describe`): mirror `add-new.spec.ts:38-42` — skip when `!SUPABASE_URL.startsWith('http://127.0.0.1:') && !SUPABASE_URL.startsWith('http://localhost:')`.

**Key assertions:**

- Test 1 (sign-in returns to /list): user already exists with a household → `/sign-in` → enter creds → land on `/list` (NOT `/onboarding`). Assert `await page.waitForURL(/\/list/)`. DB-level: `await admin.from('household_members').select('household_id').eq('user_id', userId)` returns one row.
- Test 2 (sign-out invalidates cookie): user signed in on `/settings` → click sign-out button → `await page.waitForURL(/\/sign-in/)`. Then `await page.goto('/list')` → must redirect back to `/sign-in` (cookie was invalidated, middleware kicks unauth visitor). Assert final URL matches `/sign-in`.
- Test 3 (duplicate-email): signup as `dup-${ts}@example.com` succeeds; signup again with same email → friendly error string. Assertion is on the user-facing copy from `friendlyAuthError()` in `apps/web/app/(auth)/sign-in/page.tsx` (commit `31b5637`): `await expect(page.getByText(/already registered.*check.*password/i)).toBeVisible()`. Do NOT match the raw Supabase string — that's an implementation detail.

**When to skip:** the 3 skipped tests use `test.skip(true, 'TODO: <unblocker>; see TODOS.md § <entry>')`. Each gets a paired TODOS.md entry with a one-line repro stub.

---

### `apps/web/e2e/item-detail.spec.ts`

**Path:** `apps/web/e2e/item-detail.spec.ts`

**Tests (1 active):**

| #   | Name                                                                                 | Status |
| --- | ------------------------------------------------------------------------------------ | ------ |
| 1   | `item-detail walk: seed → navigate → store-cascade re-add → delete → assert removal` | active |

**Setup pattern:**

- Admin client + signup-per-test (unique timestamp).
- Provision: signup → onboarding → land on `/list`.
- Seed an entry via the existing AddItemSheet UI flow with a known item (e.g. utterance `leche`) to keep the test exercising the real path; OR seed via admin client `list_entries.insert(...)` for speed. Default: UI add (matches D7 "Single-walk minimizes signup overhead" — but the seed itself doesn't need to be a UI add; admin-client seed is acceptable if it shaves >10s).

**Key assertions:**

- Step 1 (seed): admin-client `list_entries.insert({ household_id, item_id, store_id, status: 'pending', added_by: userId })` (using known seeded `items`/`stores` rows from `supabase/seed.sql`); UI-side reload `/list`; assert row visible.
- Step 2 (navigate to `/item/[id]`): tap the row from `/list` → `await page.waitForURL(/\/item\/.+/)`. Assert read-only attribute grid renders (label "Store", "Brand", "Quantity", "Added by", "Added").
- Step 3 (change store via re-add): `apps/web/app/item/[id]/page.tsx` is read-only today (per its `Does NOT` block: edits handled via delete + re-add). Test exercises: tap Remove → return to `/list` → tap row gone (UI-level); admin-client UPDATE the canonical entry's `store_id` to a different known store; reload `/list`; assert the item now sits under the new store's section. NOTE: this combines UI navigation + DB-level assertion; the "edit" abstraction is delete-then-re-add per the v0 product model (`item-display-name-editing` is a deferred v1 TODO that adds true edit UX). If item-detail gains true edit UX in a later PR, the spec author should update this test to drive it through the UI.
- Step 4 (delete): from `/item/[id]`, tap the Remove button → assert redirect back to `/list` → assert the row is gone from `/list`. DB-level: `admin.from('list_entries').select().eq('id', entryId)` returns empty.

**When to skip:** same `SUPABASE_URL.startsWith('http://127.0.0.1:')` predicate at the top of the `describe`.

---

### `apps/web/e2e/settings.spec.ts`

**Path:** `apps/web/e2e/settings.spec.ts`

**Tests (2 active):**

| #   | Name                                                               | Status |
| --- | ------------------------------------------------------------------ | ------ |
| 1   | `household-info read-only display matches DB`                      | active |
| 2   | `sign-out button click → next /list request redirects to /sign-in` | active |

**Setup pattern:**

- Admin client + signup-per-test.
- Sign in, navigate `/list` → tap settings (gear icon `aria-label="Open settings"`) → land on `/settings`.

**Key assertions:**

- Test 1 (household-info read): on `/settings`, the Household section renders the household name. Admin-client query: `admin.from('households').select('name').eq('id', householdId)` returns one row matching the rendered name. Assertion: `await expect(page.getByText(householdName)).toBeVisible()`.
- Test 2 (sign-out → /list redirects): `/settings` → click Sign out button → `await page.waitForURL(/\/sign-in/)` → `await page.goto('/list')` → assert final URL matches `/sign-in` (middleware kicks unauth).

**Note re D8:** Test 2 here is partial-counterpart to `auth-edge-cases.spec.ts` Test 2. D8 explicitly keeps both because the trigger differs (Settings UI button vs. direct sign-out call). Optional: collapse into D3 if pre-ship `/simplify` flags duplication; default is keep both.

**When to skip:** same `SUPABASE_URL.startsWith('http://127.0.0.1:')` predicate.

---

### `apps/web/e2e/realtime.spec.ts`

**Path:** `apps/web/e2e/realtime.spec.ts`

**Tests (2 active):**

| #   | Name                                                        | Status |
| --- | ----------------------------------------------------------- | ------ |
| 1   | `cross-session realtime: A adds, B observes within 3s`      | active |
| 2   | `sync-error banner appears when WebSocket connection fails` | active |

**Setup pattern (Test 1):**

- Admin client. Provision two users via `admin.createUser({ email_confirm: true })`.
- Provision shared household via `admin.from('households').insert({ name: 'Casa Realtime ${ts}' })` → capture `householdId`.
- Insert `household_members` rows for both users via admin client.
- Two `browser.newContext()` instances (NOT two pages on the same context — each context is a fresh browser session with its own cookies + WebSocket; same context shares auth + WS).
- Each context: navigate `/sign-in`, sign in as its assigned user, land on `/list`.

**Setup pattern (Test 2):**

- Single context.
- `await page.route('**/realtime/v1/websocket**', route => route.abort())` BEFORE `page.goto('/list')`. The abort must be in place at navigation time — Realtime's WS connect happens early in `ListClient`'s effect; intercepting after navigation misses it.
- Sign in, navigate `/list`.

**Key assertions:**

- Test 1: Context A taps FAB → AddItemSheet → submit `realtime-${ts}` → confirm. Context B (already on `/list`) waits up to 3000ms for the new row to appear: `await expect(contextB.getByText(new RegExp(utterance, 'i')).first()).toBeVisible({ timeout: 3000 })`. NO manual reload in B. DB-level: `admin.from('list_entries').select().eq('household_id', householdId)` returns one row.
- Test 2: After WS abort + navigate `/list`, the SyncErrorBanner ("Sync paused — tap to retry") must appear within ~3s: `await expect(page.getByText(/sync paused.*tap to retry/i)).toBeVisible({ timeout: 3000 })`. Copy is from `SyncErrorBanner.tsx`.

**When to skip:** local-stack predicate (D4 explicit: `Hosted Supabase free-tier has Realtime connection limits + WS allowlist friction`).

---

### `apps/web/e2e/force-create-race.spec.ts`

**Path:** `apps/web/e2e/force-create-race.spec.ts`

**Tests (1 active):**

| #   | Name                                                                                    | Status |
| --- | --------------------------------------------------------------------------------------- | ------ |
| 1   | `concurrent force-create of same novel utterance: one items row, two list_entries rows` | active |

**Setup pattern:**

- Admin client. Provision two users + shared household (same shape as `realtime.spec.ts` Test 1).
- Two `browser.newContext()` instances. Each signs in as a different household member.
- Each context navigates to `/list` and opens AddItemSheet with the same novel utterance: `force-race-${testInfo.project.name}-${Date.now()}`.

**Key assertions:**

- `Promise.all([contextA.click('button:has-text("Add")'), contextB.click('button:has-text("Add")')])` to fire both submits in parallel. Then in each context, navigate the disambig sheet's "Add as new" path (mirror `add-new.spec.ts` lines 76-98 for the cascading store-disambig handling). Both contexts WILL succeed at the UI level — the 23505 fallback path in `supabase/functions/add-item/index.ts` catches the unique-violation and re-resolves to the existing item.
- DB-level (the load-bearing assertion): `admin.from('items').select().eq('name_canonical', utterance)` returns exactly **one** row (call its id `itemId`). `admin.from('list_entries').select().eq('item_id', itemId)` returns exactly **two** rows. Both rows reference the same `items.id`. Neither write produces a UI-level error toast.
- UI-level: in both contexts, the new row is visible in `/list`.

**When to skip:** local-stack predicate.

---

## Files to create / modify

### Create

| Path                                     | Purpose                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/web/e2e/auth-edge-cases.spec.ts`   | 3 active + 3 skipped tests for sign-in / sign-out / duplicate-email / 3 deferred (D3) |
| `apps/web/e2e/item-detail.spec.ts`       | 1 active walk per viewport — seed → navigate → re-add → delete (D7)                   |
| `apps/web/e2e/settings.spec.ts`          | 2 active tests — household-info read; sign-out → /list redirect (D8)                  |
| `apps/web/e2e/realtime.spec.ts`          | 2 active tests — cross-session realtime; sync-error banner (D4 + D5)                  |
| `apps/web/e2e/force-create-race.spec.ts` | 1 active test — concurrent force-create race; admin-client DB assertions (D6)         |

### Modify

| Path           | Change                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------- |
| `CLAUDE.md`    | Add `§ Testing` "E2E-per-surface invariant" doc paragraph (D9, ~150-200 words)                |
| `TODOS.md`     | Close `e2e-audit-fill-gaps` pre-ship entry; add 3 carry-forward entries (one per D3 skip)     |
| `PLAN.md`      | Flip row #1 from Planned → Active (mirror `ci-slow-job` precedent)                            |
| `BUILD-LOG.md` | Append PR 5 entry (Phase 5 / `/document-release` handles this; not a hand-authored line here) |

### NOT modified

- `apps/web/playwright.config.ts` — new specs are picked up by the existing `mobile` + `desktop` glob; only `qa-walk` carries a `testIgnore`.
- `.github/workflows/ci.yml` — slow-job already runs Playwright at both viewports; no YAML change.
- Any `apps/web/components/**`, `apps/web/app/**`, `packages/core/src/**` — no app code changes.
- `supabase/migrations/**`, `supabase/functions/**`, `supabase/seed.sql` — no schema, no edge function, no seed changes.
- `METRICS.md` — no new analytics events.

---

## Test data model

**Pattern:** admin-client provisioning + signup-per-test, mirroring `apps/web/e2e/add-new.spec.ts` and `apps/web/e2e/helpers/test-user.ts`.

**Shared mechanics:**

- Each test creates its own users + household with unique-per-run timestamps in emails (`auth-edge-${testInfo.project.name}-${Date.now()}@example.com`). `example.com` per `auth.spec.ts:13` — Supabase rejects the `.local` TLD, `.invalid` is reserved for the qa-walk fixed account. Tests that use `auth.admin.createUser` may use `.invalid` if they bypass the email validator (mirrors `helpers/test-user.ts`'s `TEST_EMAIL`).
- Admin client: service-role JWT, `auth: { autoRefreshToken: false, persistSession: false }`. Single helper at top-of-file in each spec (or extracted into `apps/web/e2e/helpers/admin-client.ts` if duplication crosses a 5-call threshold — defer until implementation reveals it).
- Tests that need confirmed users (e.g. `auth-edge-cases.spec.ts` Test 1 sign-in flow): use `admin.auth.admin.createUser({ email, password, email_confirm: true })` — same shape as `helpers/test-user.ts:103-117`. Avoids the email-confirmation round-trip that would block automated CI.
- Tests that need two household members (`realtime.spec.ts`, `force-create-race.spec.ts`): admin-client creates the second member directly via `household_members.insert({ household_id, user_id })`, skipping the full invite flow which doesn't exist yet (per D4 rationale).

**Cleanup strategy:**

- Default: rely on slow-job's `supabase db reset` between CI runs. Each PR's slow-job spins up a fresh local Supabase via `supabase start` + `psql` seed load, so cross-test pollution within a single run is the only concern.
- Per-test cleanup: NOT required. Unique timestamps in emails + utterances mean two tests in the same run never collide on `auth.users.email` or `items.name_canonical`. Households are created fresh per-test; even if abandoned, they're garbage from the next `supabase db reset`.
- Explicit teardown: only `helpers/test-user.ts`-style cleanup (cascade-aware household deletion) is needed for the qa-walk fixed account. The new specs use throwaway-per-test users, so no afterEach hook required.

**Within-run isolation:** `playwright.config.ts` sets `fullyParallel: true` + `workers: process.env.CI ? 1 : undefined` (CI runs serially per project; local runs parallel). The new specs are designed to be parallel-safe via unique timestamps, so a future flip to `workers > 1` in CI is purely a config change.

---

## Wall-time budget

**Estimate:** +3-5 minutes added to slow-job CI. Per-spec budget:

| Spec                        | Active tests     | Per-test estimate                   | Total estimate                                       |
| --------------------------- | ---------------- | ----------------------------------- | ---------------------------------------------------- |
| `auth-edge-cases.spec.ts`   | 3                | ~25s × 2 viewports = 50s × 3 = 150s | ~2.5min                                              |
| `item-detail.spec.ts`       | 1 (long walk)    | ~40s × 2 = 80s                      | ~1.5min                                              |
| `settings.spec.ts`          | 2                | ~20s × 2 × 2 = 80s                  | ~1.5min                                              |
| `realtime.spec.ts`          | 2 (two contexts) | ~40s × 2 × 2 = 160s                 | ~2.5min                                              |
| `force-create-race.spec.ts` | 1 (two contexts) | ~35s × 2 = 70s                      | ~1.0min                                              |
| **Total**                   | **9 active**     |                                     | **~9min wall, ~5min in CI w/ retry-budget headroom** |

**Headline**: ~5min added to slow-job at `workers: 1`. TODOS.md predicted 3-5min; this lands at the upper bound but inside it.

**Flag for parallelization:** if observed slow-job wall-time exceeds 5 minutes consistently across 3 PRs, flip `workers: process.env.CI ? 2 : undefined` in `playwright.config.ts` — the new specs are written parallel-safe (unique timestamps, no shared state). Sharding (`--shard=1/2`) is the next lever; defer until 2-worker tuning is exhausted. Both are out of scope for this PR.

**Per-spec headroom:** Playwright's CI retries (`retries: 2`) absorb ~10-20% wall-time bloat on flaky runs. The 9min wall estimate already assumes one-attempt-per-test; retries push it toward 11min worst-case. Slow-job's existing budget (~10-15min from PR 4 baseline) absorbs this.

---

## Dependencies

**Already in place (PR 4):**

- ✅ Slow-job CI workflow exists (`.github/workflows/ci.yml § slow`) — runs Playwright at `mobile` + `desktop`, uploads `playwright-report/` on failure.
- ✅ Local Supabase stack runs in the slow-job (`supabase/setup-cli@v1` + `supabase start`).
- ✅ Edge function `add-item` deploys to local Supabase before E2E (so `force-create-race.spec.ts` exercises current-branch code).
- ✅ Admin-client env vars wired in slow-job: `SUPABASE_URL` (Variable, points at `http://127.0.0.1:54321`) + `SUPABASE_SERVICE_ROLE_KEY` (Secret, supabase-local default service-role JWT). Both consumed via `process.env` per `add-new.spec.ts:20-21`.
- ✅ Migration 011 (`011_items_insert_policy.sql`) — required for `force-create-race.spec.ts`'s force-create branch (the `items_insert` policy is what lets the cold-start succeed; cross-ref `CLAUDE.md § Gotchas § Principle of least privilege for RLS-bypass writes`).
- ✅ Migration 012 (`012_profiles.sql`) + display-name plumbing — `auth-edge-cases.spec.ts` and `settings.spec.ts` rely on the profiles trigger firing on signup; if it didn't, signup would 500 (FK violation on subsequent profile reads).

**No new dependencies:**

- No new GitHub Secrets (existing `SUPABASE_SERVICE_ROLE_KEY` covers all DB-level assertions).
- No new pnpm packages (`@playwright/test`, `@supabase/supabase-js` already installed).
- No `playwright.config.ts` changes (existing `mobile` + `desktop` glob picks up new specs).
- No CI YAML changes.

**Cross-PR dependencies:** none. PR 5 ships atomically once specs are written + green in slow-job CI.

---

## Task order

Seven implementation tasks, dependency-ordered. Tasks 1-5 are independent (different files, no shared helpers); tasks 6-7 land last because they reference the actual file layout produced by tasks 1-5.

- **Task 2.1 — `auth-edge-cases.spec.ts`** — 3 active + 3 skipped tests. Establishes the admin-client + signup-per-test pattern that subsequent tasks reuse. Implementing this first means tasks 2-5 can copy the boilerplate.
- **Task 2.2 — `item-detail.spec.ts`** — single-walk per viewport. Independent of Task 2.1 but copies its admin-client boilerplate. Lands second so it benefits from any pattern adjustments surfaced in Task 2.1's CI run.
- **Task 2.3 — `settings.spec.ts`** — 2 active tests. Independent. Copies admin-client boilerplate.
- **Task 2.4 — `realtime.spec.ts`** — 2 active tests, two-context provisioning. Slightly more complex than 2.1-2.3 (two `browser.newContext()`); the `WebSocket abort` test in particular needs careful timing per the gotcha below.
- **Task 2.5 — `force-create-race.spec.ts`** — 1 active test, two-context concurrent submission. Most complex of the five (concurrent `Promise.all` UI submission + DB-level assertion that the race fallback fired correctly).
- **Task 2.6 — `CLAUDE.md § Testing` "E2E-per-surface invariant" doc** — must land AFTER tasks 2.1-2.5 so it can reference the actual file layout (e.g. "see `apps/web/e2e/auth-edge-cases.spec.ts` for an example of admin-client DB assertions"). Doc is ~150-200 words per D9.
- **Task 2.7 — `TODOS.md` updates** — close the `e2e-audit-fill-gaps` pre-ship entry; add 3 carry-forward entries (one per D3 skip: email-not-confirmed, rate-limit, password-reset). Each entry mirrors the existing TODOS template (What / Why / How / Depends on). Lands last so it can reference the shipped CLAUDE.md doc as the convention pointer.

**Implementation hint for the implementer:** tasks 2.1-2.5 should each commit atomically. Task 2.1's commit message: `test(e2e): auth-edge-cases — 3 active + 3 skipped`. Tasks 2.6+2.7 may share a single commit (`docs(e2e-audit): convention doc + TODOS carry-forwards`).

---

## Gotchas

Things the spec implementer needs to know before writing code. All anchored in real codebase artifacts.

- **Local-stack `test.skip()` predicate.** Mirror the precedent in `apps/web/e2e/add-new.spec.ts:38-42`:

  ```ts
  test.skip(
    !SUPABASE_URL.startsWith('http://127.0.0.1:') &&
      !SUPABASE_URL.startsWith('http://localhost:'),
    '<spec-name> E2E requires a local Supabase stack (slow-job only)'
  );
  ```

  Place this as the first statement inside `test.describe` (NOT inside individual tests) so the entire suite skips coherently when run against hosted Supabase.

- **Two-context realtime auth provisioning.** Each `browser.newContext()` is a fresh browser session — no cookie sharing, no WebSocket sharing. The two contexts MUST go through `/sign-in` independently. Sharing auth across contexts via storageState is theoretically possible but adds a fixture; signup-per-test keeps each spec self-contained.

- **Force-create race success path.** The 23505 fallback in `supabase/functions/add-item/index.ts` catches the unique-violation and re-resolves to the existing item. Both contexts WILL succeed at the UI level — there is NO error to the user. The spec's load-bearing assertion is DB-level: exactly **one** `items` row with the novel `name_canonical`, exactly **two** `list_entries` rows pointing at it. Do NOT assert "one context shows an error" — the architecture explicitly prevents that.

- **Sync-error banner test timing.** `page.route('**/realtime/v1/websocket**', route => route.abort())` MUST be called BEFORE `page.goto('/list')`. `ListClient.tsx` opens the WebSocket inside its initial `useEffect`; intercepting after navigation misses the connect, the WS would have already been established (or attempted), and the `setSyncError({type:'realtime'})` trigger at line 164 wouldn't fire. The test would then time out waiting for a banner that never appears. Order is load-bearing.

- **`friendlyAuthError()` mapping for duplicate-email.** The user-facing copy is in `apps/web/app/(auth)/sign-in/page.tsx` (commit `31b5637`):
  - "User already registered" → `'That email is already registered. Check your password and try again.'`

  The duplicate-email assertion MUST match this user-facing copy (regex like `/already registered.*check.*password/i`), NOT the raw Supabase error string. Asserting the raw string would silently break if the friendly mapping changes — the whole point of the test is that the mapping works.

- **Item-detail is read-only today.** `apps/web/app/item/[id]/page.tsx` ships read-only attribute grid + Remove button. There is NO inline-edit UX for store/brand. D7's "change store / change brand" walks must be implemented as delete + re-add (UI-side, exercising the AddItemSheet flow with a different store) OR as direct admin-client UPDATEs (DB-side, asserting the change). When `item-display-name-editing` (v1 TODO) lands true edit UX, the spec author should refresh this test to drive it through the UI. For now, document the limitation in the test's `// What:` header.

- **Cookie invalidation in sign-out test.** Supabase's signout clears the session cookie; the next `page.goto('/list')` triggers middleware which redirects to `/sign-in?next=/list`. The assertion is `await expect(page).toHaveURL(/\/sign-in/)` — do NOT match the full URL with `next=` (that's an implementation detail of the redirect URL, brittle to middleware changes).

- **Admin-client lives outside `helpers/test-user.ts`.** That helper is for the qa-walk fixed-account lifecycle (creates + cascade-deletes one specific test user). The new specs need a generic admin-client factory; copy the inline pattern from `add-new.spec.ts:24-33` rather than extending `test-user.ts`. If duplication crosses 5+ specs (i.e. all 5 of these), extract `apps/web/e2e/helpers/admin-client.ts` during Task 2.1 and reference it from 2.2-2.5. Defer the extraction decision to implementation time.

- **`example.com` vs `.invalid` for test emails.** `auth.spec.ts:13` notes Supabase rejects the `.local` TLD; `example.com` is RFC-2606 reserved and accepted. `helpers/test-user.ts` uses `.invalid` for the qa-walk fixed account because `auth.admin.createUser` bypasses the validator. New specs should use `example.com` for any signup that goes through the public form, and may use `.invalid` only when bypassing the validator via admin API.

---

## Acceptance / rollout / rollback

### Acceptance criteria

- [ ] All 5 new spec files parse via `pnpm exec playwright test --list --config=apps/web/playwright.config.ts` — no syntax / import errors.
- [ ] All 6 active tests pass in slow-job CI at both `mobile` + `desktop` viewports:
  - `auth-edge-cases.spec.ts`: sign-in returns to /list; sign-out invalidates cookie; duplicate-email surfaces friendly error.
  - `item-detail.spec.ts`: walk passes (seed → navigate → delete + DB assertion).
  - `settings.spec.ts`: household-info read matches DB; sign-out → /list redirects to /sign-in.
  - `realtime.spec.ts`: cross-session realtime fires within 3s; sync-error banner appears on WS abort.
  - `force-create-race.spec.ts`: concurrent force-create produces 1 items row + 2 list_entries rows.
- [ ] All 3 skipped tests in `auth-edge-cases.spec.ts` use explicit `test.skip(true, '<reason>')` (not `.fail()`, not commented-out blocks). Each carries a TODO comment pointing at its TODOS.md unblocker entry.
- [ ] `CLAUDE.md § Testing` paragraph (~150-200 words) lands per D9 and references at least one of the new specs as an example.
- [ ] `TODOS.md` has the `e2e-audit-fill-gaps` pre-ship entry removed and 3 new carry-forward entries (one per D3 skip), each with What / Why / How / Depends on.
- [ ] No app code, schema, migration, edge function, seed, or METRICS.md changes (verified by `git diff --stat main..HEAD` showing only `apps/web/e2e/**`, `CLAUDE.md`, `TODOS.md`, `PLAN.md`, `specs/e2e-audit-fill-gaps/**` paths).
- [ ] Slow-job CI wall-time post-merge is within ~5min above pre-PR baseline (observed across the first 3 PRs after merge; flag for parallelization if over).

### Rollout

**No runtime changes.** Pure test infrastructure. Follow the `/ak-go-live` "no runtime changes" handoff:

1. Merge PR to `main`.
2. Vercel auto-deploys front-end (a no-op rebuild — no source changes).
3. No `supabase db push` (no migration).
4. No `supabase functions deploy` (no edge function change).
5. No canary needed — no user-visible surface changes.

The first PR after merge that touches `apps/web/**` source code will exercise the new E2E specs in slow-job; that's the de-facto post-merge verification.

### Rollback

**Revert the PR.** No migration to undo, no edge function to redeploy, no Vercel rollback needed.

```bash
git revert <merge-commit-sha>
```

The reverted PR removes the 5 spec files + the CLAUDE.md paragraph + the TODOS.md edits; slow-job CI wall-time returns to pre-PR baseline; coverage gaps re-open (acceptable — the same gaps existed pre-PR).

**No data risk.** None of the new specs leave persistent data behind in any environment except local-stack supabase (which `supabase db reset` clears between CI runs, and which dev-side tests don't write to per the dev-side prod-isolation work in `PLAN.md` row #2).
