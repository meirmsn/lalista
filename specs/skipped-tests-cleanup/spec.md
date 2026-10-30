<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: skipped-tests-cleanup -->
<!-- date: 2026-04-26 -->

# Spec: skipped-tests-cleanup (cleanup PR)

**Sources:**

- `TODOS.md § v0 § Carry-forward` — primary scope; the 4 actionable entries:
  - `realtime-cross-session-publication-setup` (un-skips realtime.spec.ts:27)
  - `realtime-banner-ws-abort-trigger` (un-skips realtime.spec.ts:184)
  - `email-not-confirmed-bounce-e2e` (un-skips auth-edge-cases.spec.ts:215)
  - `auth-rate-limit-e2e` (un-skips auth-edge-cases.spec.ts:222)
- `password-reset-e2e` is **out of scope** — blocked on devshop `/auth/callback` helper shipping.
- `apps/web/e2e/realtime.spec.ts`, `apps/web/e2e/auth-edge-cases.spec.ts` — the test files
- `packages/core/src/api/realtime.ts` — `subscribeToList` (extended in D2)
- `apps/web/components/ListClient.tsx:159-165` — the catch path that surfaces the banner
- `apps/web/app/(auth)/sign-in/page.tsx:28-41` — `friendlyAuthError` (mappings already exist for both rate-limit and not-confirmed strings)
- `supabase/migrations/012_profiles.sql` — last migration; new is 013
- Prior spec `specs/e2e-audit-fill-gaps/spec.md` — same author/style + skipped-test rationale

Single cleanup PR that retires 4 carry-forward entries by un-skipping their E2E tests, plus a small production-code fix that the banner test forced into scope (real WS failures didn't surface CHANNEL_ERROR before — only synchronous constructor throws did).

---

## Decisions (resolved at spec time)

5 `/ak-spec`-time decisions resolved in Phase 0 with the user. Recorded below
so Phase 1 preserves them verbatim and a crashed Phase 1 resumes without
re-asking.

### D1: How to add `list_entries` to `supabase_realtime` publication?

**Decision:** New migration `013_realtime_publication.sql` that adds `list_entries` to the publication idempotently (DO block guarded by `pg_publication_tables` check). Includes a `-- ROLLBACK:` comment block per migration convention so `scripts/ci-rollback-explain.sh` validates the round-trip.

**Rationale:** Trace evidence in TODOS.md says newer Supabase CLI versions don't auto-include all tables. Idempotent guard means the migration is safe to re-run on stacks where the table is already in the publication (e.g., older CLIs). Standard alter-publication is the canonical fix.

### D2: How to reliably trigger CHANNEL_ERROR for the sync-error banner E2E?

**Decision:** Two-part fix.

(a) **Production code:** Extend `subscribeToList(client, householdId, callback, onError?)` to pass a status callback to `.subscribe()` and invoke `onError` on `'CHANNEL_ERROR'` or `'TIMED_OUT'`. Wire `ListClient.tsx` to pass `() => setSyncError({type: 'realtime'})`. Real WS failures now surface the banner — not just synchronous constructor throws.

(b) **Test trigger:** Use Playwright 1.59.1's `page.routeWebSocket('**/realtime/v1/websocket**', ws => ws.close())` to close the WS upgrade. supabase-js fires CHANNEL_ERROR via the subscribe-status callback; the new wiring sets `syncError` and the banner renders.

**Rationale:** The trace evidence showed `route.fulfill 503` doesn't reliably reach the supabase-js error path because the realtime client's onerror→onclose→retry loop swallows it before any user-visible signal fires. `routeWebSocket` is Playwright's purpose-built WS interception API and triggers a clean close that supabase-js converts to CHANNEL_ERROR. The production fix is forced into scope: today's wiring would let real prod WS failures pass silently, and the test would fail without the wiring.

### D3: How to test the "email not confirmed" path?

**Decision:** Reframe the test from "bounced from /list" to "email-not-confirmed user can't sign in" and assert that the friendly error copy ("Check your email to confirm your account first") is visible on `/sign-in` after a sign-in attempt with `admin.createUser({email_confirm: false})`.

**Rationale:** Supabase rejects sign-in for unconfirmed users at `/auth/v1/token` — they never get a session and never reach `/list`. The middleware-bounce framing in TODOS.md was based on a misread of the auth flow. `friendlyAuthError` already has a mapping for `/email.*not.*confirmed/i` (sign-in/page.tsx:32), so the assertion is end-to-end without any prod code change.

### D4: How to test the rate-limit path?

**Decision:** Per TODOS.md option (b): `page.route('**/auth/v1/signup', route => route.fulfill({status: 429, body: '{"code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}'}))`. Drive the form with a fresh email so the signup-fallback branch is exercised (sign-in fails first → fallback signup hits the mock → friendly error renders).

**Rationale:** `friendlyAuthError` already maps `/email.*rate.*limit|rate.*limit.*email/i` (sign-in/page.tsx:29). Network-level mock keeps the test isolated from real Supabase rate-limit windows (option (a) was the alternative — adds CI complexity for no extra coverage). Same shape as the existing `realtime.spec.ts` route-mock pattern.

### D5: Is fixing the production-code subscribe-status wiring (D2 part a) safe to bundle in this cleanup PR?

**Decision:** Yes. Bundle in this PR with a clear commit message; surface in the audit trail. The change is < 10 LoC, additive (optional `onError` parameter), and forced by D2's test requirement — splitting it into a separate PR would mean the banner test stays skipped after this PR ships.

**Rationale:** Per the dual-goal principles, fixes that the test forces into scope belong in the test's PR. The wiring gap was always a latent bug (real WS failures didn't surface the banner); we're closing it because the test verification requires it. The unit test `SyncErrorBanner.test.tsx` already covers the rendering side; the new wiring is the missing trigger side.

---

<!-- /ak-spec (Phase 1) expands the file from here: In scope, Screens, Data
     model changes, API contracts, Offline behavior, Metrics, Files to
     create/modify, Tests, Dependencies, Task order, Gotchas, Acceptance /
     rollout / rollback. The Decisions section above stays verbatim. -->

## In scope

- **`supabase/migrations/013_realtime_publication.sql`** — new migration. Idempotent add of `list_entries` to the `supabase_realtime` publication via a `do $$ begin ... end $$` block guarded by a `pg_publication_tables` check. Includes a `-- ROLLBACK:` comment block with the inverse `alter publication ... drop table list_entries` statement so `scripts/ci-rollback-explain.sh` round-trips it.
- **`packages/core/src/api/realtime.ts`** — extend `subscribeToList(client, householdId, callback)` with an optional fourth parameter `onError?: () => void`. Wire `.subscribe(status => ...)` (the variant that accepts a status callback) and invoke `onError()` when supabase-js reports `'CHANNEL_ERROR'` or `'TIMED_OUT'`. Backwards-compatible: the new parameter is optional, existing callers keep working.
- **`apps/web/components/ListClient.tsx`** — pass `() => setSyncError({ type: 'realtime' })` as the new fourth argument to `subscribeToList(supabase, householdId, onChange, onError)`. The synchronous-throw guard at lines 158-165 stays for safety; the new wiring covers the (much more common) async-failure path.
- **`apps/web/e2e/realtime.spec.ts`** — un-skip BOTH tests:
  - **Cross-session test (line 27)**: remove the `test.skip(true, 'TODO: ...')` block + the lengthy "skipped pending publication setup" comment paragraph (lines 30-44). With migration 013 the publication is in place and the test exercises the real WS path.
  - **Banner test (line 184)**: remove the `test.skip(true, 'TODO: ...')` block + the "skipped pending WS-abort trigger" comment paragraph (lines 187-199). Replace the `page.route('**/realtime/v1/websocket**', route => route.fulfill({status: 503}))` setup with `page.routeWebSocket('**/realtime/v1/websocket**', ws => ws.close())`. Update the in-test comment block (lines 232-242) to explain the new approach: clean WS close → supabase-js fires `CHANNEL_ERROR` via the subscribe-status callback → ListClient's new onError wiring sets `syncError({type:'realtime'})` → banner renders.
- **`apps/web/e2e/auth-edge-cases.spec.ts`** — replace 2 of the 3 skipped stubs (lines 215, 222) with active bodies. Keep line 229 (password-reset) as-is per "out of scope" below.
  - **Line 215**: rename `'email-not-confirmed user is bounced from /list'` → `'email-not-confirmed user can\'t sign in until confirmed'`. Add an inline comment explaining the reframe: Supabase rejects sign-in at `/auth/v1/token` for users with `email_confirmed_at: null`, so the user never reaches `/list` to be bounced — the gate is the auth call itself, not middleware. Provision an unconfirmed user via `admin.auth.admin.createUser({email_confirm: false})`, drive the form, assert the friendly copy `Check your email to confirm your account first` is visible.
  - **Line 222**: keep the test name. Replace stub with: `page.route('**/auth/v1/signup', route => route.fulfill({status: 429, body: '{"code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}'}))`. Drive the form with a fresh email so the sign-in fails (no such user) → fallback signup hits the mocked 429 → `friendlyAuthError` translates and the friendly copy `Too many attempts. Please try again in a few minutes.` renders.
- **`TODOS.md`** — DELETE the 4 retired carry-forward entries (per `/workspace/.claude/skills/ak-build/SKILL.md` Phase 5.6 step 4 — entries get deleted, not strikethrough). Specifically:
  - `realtime-cross-session-publication-setup`
  - `realtime-banner-ws-abort-trigger`
  - `email-not-confirmed-bounce-e2e`
  - `auth-rate-limit-e2e`

  Other carry-forward entries STAY: `auth-ux-refactor-to-adopt`, `password-reset-e2e`. The `core-flows-happy-path-ci-investigation` (Pre-ship section) is unrelated to this spec and stays.

## Out of scope

- **`password-reset-e2e` carry-forward** — blocked on devshop's `/auth/callback` route handler shipping (`/devshop/kit/ROADMAP.md § v0 § Auth UX conventions`). Stays in TODOS.md until that helper lands. Re-confirmed in spec one-liner; the line-229 stub stays skipped in this PR.
- **Reworking `subscribeToList`'s reconnection / retry strategy** beyond surfacing the error. The retry button (`realtimeTick` bump in `ListClient.tsx:135` + the useEffect dep) already handles user-driven retry by tearing down the channel and rebuilding it on the next render. This PR does NOT add automatic exponential-backoff or background reconnection — that's a future polish.
- **Changing `friendlyAuthError`'s mappings** at `apps/web/app/(auth)/sign-in/page.tsx:28-41`. The existing regexes (`/email.*not.*confirmed/i` line 32, `/email.*rate.*limit|rate.*limit.*email/i` line 29) are exactly what the new tests assert against — no change required and no change desired.
- **Adding new analytics events** for realtime errors. The existing `error_displayed` event in METRICS.md already covers banner-visibility tracking and is fired by `SyncErrorBanner` on render. No new event is added; see Gotchas.
- **Updating other CI scripts**. `ci-type-drift.sh` and `ci-rollback-explain.sh` already cover the migration round-trip and type-drift surface; no script changes needed.

## Screens

No new screens. Two visible UX changes:

- **Sync-error banner appears on real WebSocket failures now**. Today the banner only fires on synchronous WebSocket-constructor throws (the try/catch around `subscribeToList` in `ListClient.tsx:158-165`). After this PR, supabase-js's async `CHANNEL_ERROR` and `TIMED_OUT` events also surface the banner. The banner copy itself is unchanged: "Sync paused — tap to retry" (rendered by `SyncErrorBanner.tsx`).
- **No change to sign-in copy**. The friendly error mappings already exist in `friendlyAuthError`. The new tests just assert against text the production code already emits.

## Data model changes

- **Migration 013 (`supabase/migrations/013_realtime_publication.sql`)**: idempotent `alter publication supabase_realtime add table list_entries` guarded by a check against `pg_catalog.pg_publication_tables` so it's safe to re-run on stacks where older Supabase CLIs already added it via `FOR ALL TABLES`. Includes a `-- ROLLBACK:` block with `alter publication supabase_realtime drop table list_entries`.
- No tables created or dropped. No columns added. No RLS changes. No data backfill.
- Type generation (`supabase gen types typescript`) produces no diff for this migration since publication membership is not part of the generated types — `ci-type-drift.sh` is a no-op for migration 013, by design.

## API contracts

- **`subscribeToList`** signature evolves from:
  ```ts
  function subscribeToList(
    client: Client,
    householdId: string,
    callback: (change: ListEntryChange) => void
  ): () => void;
  ```
  to:
  ```ts
  function subscribeToList(
    client: Client,
    householdId: string,
    callback: (change: ListEntryChange) => void,
    onError?: () => void
  ): () => void;
  ```
  The new parameter is optional; the only external caller (`apps/web/components/ListClient.tsx:159`) is updated in the same PR. No other call sites in the workspace.
- **No edge function changes.** `supabase/functions/**` is untouched, so the `supabase functions deploy` manual-deploy gate (CLAUDE.md gotcha) does NOT apply.
- **No client-API additions.** No new export from `@lalista/core`; just an extended signature on an existing one.

## Offline behavior

- **New `onError` wiring fires on the device-offline / WS-upgrade-fails path.** supabase-js's realtime client emits `CHANNEL_ERROR` (or `TIMED_OUT` for slow handshakes) when the WebSocket can't establish or drops. The new wiring catches both via the `.subscribe(status => ...)` callback. Result: the user sees "Sync paused — tap to retry" within seconds of going offline, instead of the channel silently failing in the background.
- **The existing `runFetch` query-error path is unchanged.** `ListClient.tsx:119` still sets `syncError({ type: 'query' })` when the initial REST fetch fails. The two paths are independent and route to different banner copy via `SyncErrorBanner.tsx`.
- **The retry button still does the right thing**: `setRealtimeTick(t => t + 1)` (`ListClient.tsx:293`) bumps a state token that's in the realtime useEffect's dep array, which tears down the failed channel and builds a new one. With migration 013 in place, the retry hits a working publication and the new channel succeeds; without it, the retry would also fail (and the banner would re-render).

## Metrics

- **No new events.** The existing taxonomy in `METRICS.md` is unchanged.
- The existing `error_displayed` event already covers the realtime-banner-visible signal: `error_type: 'realtime'` is emitted by `SyncErrorBanner` on render. The new wiring just makes the banner render in more cases (real WS failures, not only sync-throws); the analytics surface is the same.
- **Noted-but-not-added consideration:** because the new wiring will surface the banner more often in production (any flaky network → CHANNEL_ERROR), the `error_displayed { error_type: 'realtime' }` rate may rise post-deploy. This is correct behavior, not a regression — the prior rate was artificially low because real WS failures didn't fire the banner. If we want to distinguish "WS upgrade failed" from "CHANNEL_ERROR mid-session" in analytics, that's a future event-shape change, not part of this PR.

## Files to create/modify

| Path                                               | Change                  | Why                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/013_realtime_publication.sql` | **create**              | Idempotent add of `list_entries` to `supabase_realtime` publication. Unblocks the cross-session E2E.                                                                                                                                                        |
| `packages/core/src/api/realtime.ts`                | modify                  | Add optional `onError?: () => void` parameter to `subscribeToList`; wire `.subscribe(status => ...)` to invoke it on `CHANNEL_ERROR` / `TIMED_OUT`.                                                                                                         |
| `packages/core/src/api/realtime.test.ts`           | modify                  | Add a unit test for the new onError path (mock the channel's `.subscribe` callback and assert `onError` fires for `CHANNEL_ERROR`). Existing 3 tests stay.                                                                                                  |
| `apps/web/components/ListClient.tsx`               | modify                  | Pass `() => setSyncError({ type: 'realtime' })` as the fourth arg to `subscribeToList`. Existing sync-throw try/catch stays.                                                                                                                                |
| `apps/web/e2e/realtime.spec.ts`                    | modify                  | Un-skip both tests (cross-session at line 27, banner at line 184). Banner test rewritten to use `page.routeWebSocket(..., ws => ws.close())`. Remove the obsolete "TODO: blocked on..." comment paragraphs in both test bodies.                             |
| `apps/web/e2e/auth-edge-cases.spec.ts`             | modify                  | Replace skip stubs at lines 215 and 222 with active bodies (email-not-confirmed reframed + rate-limit network mock). Line 229 (password-reset) stays as-is.                                                                                                 |
| `TODOS.md`                                         | modify (delete entries) | Delete the 4 retired carry-forward entries: `realtime-cross-session-publication-setup`, `realtime-banner-ws-abort-trigger`, `email-not-confirmed-bounce-e2e`, `auth-rate-limit-e2e`. Per Phase 5.6 step 4 — done at finalize time, not implementation time. |

No files in `supabase/functions/**` change. No package additions to `package.json`. No env var changes.

## Tests

- **Migration 013 (publication-only)**:
  - Slow-job CI's `scripts/ci-rollback-explain.sh` parses the `-- ROLLBACK:` block and round-trips it against the local stack. Migration 013's rollback (`alter publication supabase_realtime drop table list_entries`) runs cleanly and re-application is idempotent thanks to the guard, so the round-trip succeeds.
  - `scripts/ci-type-drift.sh` runs against the local stack; since this migration produces no generated-types diff, it's a no-op for 013 (intended).
  - No new unit or integration tests added — the migration's correctness is fully covered by the cross-session E2E (it would still fail without the publication add).

- **`subscribeToList` extension**:
  - Existing unit tests in `packages/core/src/api/realtime.test.ts` (verified present, 3 tests covering channel filter, payload forwarding, unsubscribe contract) stay green — the new optional parameter is backwards compatible.
  - **NEW unit test**: assert that `onError` is called when the `.subscribe(status => ...)` callback receives `'CHANNEL_ERROR'` (or `'TIMED_OUT'`). Mock the channel's `subscribe` to capture the status callback, invoke it with each error string, expect the user-supplied `onError` mock to have been called. Minimal — single new `it(...)` block.

- **`ListClient.tsx` wiring**:
  - Existing unit tests in `apps/web/components/ListClient.test.tsx` (verified present, 8 tests covering skeleton/group/empty/realtime-INSERT/realtime-DELETE/sync-banner-on-fetch-fail/buy-handler/FAB-open) stay green. The new wiring is one line; the existing `subscribeToListMock` already returns an unsubscribe and is invoked via `subscribeToListMock.mockImplementation((_c, _h, cb) => { ... })` — the test infrastructure can be extended in-place to capture and call the new fourth argument if a unit-level assertion is desired.
  - **Decision: rely on E2E coverage for the wiring assertion.** Adding a unit-level "calls setSyncError when onError fires" test requires teaching the existing `subscribeToListMock` shape about the fourth argument and is awkward (the assertion would need to invoke the captured callback then assert banner visibility — duplicate of the new banner E2E). The E2E (`realtime.spec.ts` banner test) drives the wired path end-to-end through the real supabase-js client; that's the load-bearing assertion.

- **`realtime.spec.ts`**: both tests un-skipped, exercised in slow-job CI on both `mobile` and `desktop` projects.
- **`auth-edge-cases.spec.ts`**: 2 new active bodies (lines 215, 222), exercised in slow-job CI on both projects. Line 229 stays skipped per "out of scope."

## Dependencies

- **No new packages.** `@playwright/test ^1.59.1` (verified in `apps/web/package.json`) ships `page.routeWebSocket`, which was added in Playwright 1.48 — well within range.
- **Local Supabase is the only env that runs these tests.** The `test.skip(!isLocalSupabase(), ...)` predicate at the top of each describe block (`realtime.spec.ts:25`, `auth-edge-cases.spec.ts:29`) gates the whole suite on `SUPABASE_URL` pointing at `127.0.0.1` or `localhost`. Hosted Supabase doesn't run them — no rate-limit pollution, no Realtime allowlist friction.
- **Slow-job CI runs the local stack**. Migration 013 is applied automatically on `supabase db reset` during the slow-job's setup, so the cross-session test sees a publication with `list_entries` from run #1.

## Task order

1. **Migration 013 (publication add)** — create `supabase/migrations/013_realtime_publication.sql` with the idempotent `do $$ ... end $$` guard + `-- ROLLBACK:` block.
2. **Extend `subscribeToList` + add unit test** — extend the signature with optional `onError?: () => void`, wire `.subscribe(status => ...)`, add the unit test for the new path in `realtime.test.ts`.
3. **Wire `ListClient.tsx`** — pass the new fourth argument: `() => setSyncError({ type: 'realtime' })`.
4. **Un-skip realtime.spec.ts cross-session test** — remove the `test.skip(true, ...)` block + obsolete TODO comment paragraph at lines 30-44.
5. **Rewrite realtime.spec.ts banner test** — un-skip + replace `page.route(...).fulfill(503)` with `page.routeWebSocket(..., ws => ws.close())`. Update inline comment block to describe the new approach.
6. **Activate auth-edge-cases.spec.ts email-not-confirmed test** — rename to `'email-not-confirmed user can\'t sign in until confirmed'`, replace stub at line 215 with active body using `admin.auth.admin.createUser({email_confirm: false})`, add reframe comment.
7. **Activate auth-edge-cases.spec.ts rate-limit test** — replace stub at line 222 with active body using `page.route('**/auth/v1/signup', ... 429 ...)`.
8. **Delete 4 retired TODOS.md entries** — per Phase 5.6 step 4: `realtime-cross-session-publication-setup`, `realtime-banner-ws-abort-trigger`, `email-not-confirmed-bounce-e2e`, `auth-rate-limit-e2e`. Done at FINALIZE TIME (Phase 5.6), not during Phase 2 implementation; commit on the same feature branch as a separate cleanup commit.

Steps 1-7 are Phase 2 implementation. Step 8 is Phase 5.6 finalize. The TaskCreate tracker mirrors steps 1-4 as Phase-2 sub-tasks (migration / WS-abort / email-not-confirmed / rate-limit), with steps 4 + 5 collapsed into "WS-abort trigger" and steps 2 + 3 absorbed into the migration task's scope by Phase-2 grouping.

## Gotchas

- **Idempotent publication add — use the `pg_publication_tables` check, not raw `alter ... add`.** Older Supabase CLIs auto-included `list_entries` via `FOR ALL TABLES`, and a raw `alter publication supabase_realtime add table list_entries` errors when the table is already in the publication. Use the `do $$ begin ... end $$` guard pattern:

  ```sql
  do $$
  begin
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'list_entries'
    ) then
      alter publication supabase_realtime add table list_entries;
    end if;
  end $$;
  -- ROLLBACK:
  -- alter publication supabase_realtime drop table list_entries;
  ```

  This makes the migration safe on both stack variants.

- **`page.routeWebSocket` requires Playwright 1.48+.** Verified `^1.59.1` in `apps/web/package.json` — comfortably in range. If a Playwright downgrade ever happens, `routeWebSocket` references will fail at test-load time with a clear error.

- **Test reframe for email-not-confirmed.** The original TODOS.md entry framed it as "user is bounced from /list" — implying a middleware gate. Wrong: Supabase rejects sign-in for `email_confirmed_at: null` users at the `/auth/v1/token` endpoint, so the user never gets a session and never reaches `/list`. The friendly error `Check your email to confirm your account first` shows on `/sign-in` instead. Document this flow in the test comment so a future reader doesn't try to "fix" the test by chasing a middleware bug that doesn't exist.

- **`'CHANNEL_ERROR'` vs `'TIMED_OUT'`** — both should fire `onError`. supabase-js docs list four status strings (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`). `CLOSED` is normal teardown (e.g. unmount); `SUBSCRIBED` is success. Only `CHANNEL_ERROR` and `TIMED_OUT` are errors the user should know about.

- **Don't add a new METRICS.md event for realtime errors.** The gate is "is the banner visible?", not "did analytics fire?". The unit test `SyncErrorBanner.test.tsx` already covers the rendering side; the new banner E2E covers the trigger side. Adding a per-error-shape event (e.g. distinguishing `CHANNEL_ERROR` from `TIMED_OUT` in analytics) is a future polish, not part of this PR. Leaving as a noted consideration in this section.

- **`subscribeToList` test mock surface in `ListClient.test.tsx`.** The existing test uses `subscribeToListMock.mockImplementation((_c, _h, cb) => { emitRealtime = cb; return () => {}; })`. The new fourth argument changes the signature. The mock continues to work — `_c, _h, cb` covers the first three positional args and the new fourth arg is optional — but if any test wants to assert "onError was wired correctly", the mock needs to be updated to capture the fourth arg. Existing 8 tests don't need changes (they don't assert on the new arg).

- **Carry-forward entry deletion timing.** Per `/workspace/.claude/skills/ak-build/SKILL.md` Phase 5.6 step 4: TODOS.md deletions happen at FINALIZE time, not implementation time. Phase 2 implements the test changes; Phase 5.6 deletes the 4 retired entries as a separate commit on the same feature branch. Do NOT bundle the TODOS.md edit into the Phase 2 implementation commits — it should be its own commit so the audit trail is clean.

- **Migration 013 + auto-deploy.** `.github/workflows/deploy-migrations.yml` is path-filtered to `supabase/migrations/**` and auto-runs on push to main. Migration 013 will deploy automatically when the PR merges. The front-end deploy (Vercel) is independent. Migration 013 must run BEFORE the Vercel deploy completes for the new banner-trigger code to behave correctly in prod, but ordering is not load-bearing for this specific change because the front-end change (new `onError` wiring) is a no-op against a publication that already includes `list_entries` — the only failure mode is "new banner code shipped but old publication state means the cross-session E2E would have failed if it ran post-deploy on the prod stack," which doesn't actually run post-deploy.

- **`SUPABASE_PROD_URL` Variable**: per CLAUDE.md gotcha, the deploy-migrations workflow sed-derives the project ref from `vars.SUPABASE_PROD_URL`. Confirmed already set (PR 4 onwards has been deploying migrations); no action needed for this PR.

## Acceptance / rollout / rollback

- **Acceptance criteria**:
  - Slow-job CI green on both `mobile` and `desktop` projects with all 4 previously-skipped tests now active.
  - `realtime.spec.ts` cross-session test: page B observes the row that page A's admin INSERT creates within the 10s budget.
  - `realtime.spec.ts` banner test: `page.routeWebSocket(..., ws => ws.close())` triggers `CHANNEL_ERROR`, the new `onError` wiring fires `setSyncError({type:'realtime'})`, and `Sync paused — tap to retry` is visible within 10s.
  - `auth-edge-cases.spec.ts` email-not-confirmed test: friendly copy `Check your email to confirm your account first` is visible on `/sign-in` after the form submit.
  - `auth-edge-cases.spec.ts` rate-limit test: friendly copy `Too many attempts. Please try again in a few minutes.` is visible after the mocked 429 fires.
  - Unit tests: existing `realtime.test.ts` 3 tests + new 1 test all green. Existing `ListClient.test.tsx` 8 tests all green (no changes needed).
  - No manual smoke-check needed — the production fix path is exercised by the banner E2E.

- **Rollout**:
  - PR merges to main → `.github/workflows/deploy-migrations.yml` (path-filtered to `supabase/migrations/**`) auto-runs and applies migration 013 to prod.
  - Vercel auto-deploys the front-end (extends `subscribeToList` + ListClient wiring). Order between the two is not load-bearing for this change.
  - No edge function deploy needed (`supabase/functions/**` untouched).

- **Rollback**:
  - **If migration 013 causes regression**: the `-- ROLLBACK:` block (`alter publication supabase_realtime drop table list_entries`) reverts cleanly. Run via `supabase db push` on a manual rollback migration or directly on prod via the SQL editor. Migration 013 has no ON DELETE CASCADE, no data side-effects — rollback is risk-free.
  - **If the front-end change causes regression**: a Vercel rollback to the prior deploy is sufficient. The new front-end has no schema dependency, and the prior front-end works against migration 013's state (the prior front-end didn't read `onError`-related state at all).
  - **Combined rollback (unlikely)**: front-end rollback first (faster), then migration rollback if needed. The cross-session E2E test and the banner E2E will both be skipped again on the next CI run — that's the acceptance criterion for "fully rolled back."
