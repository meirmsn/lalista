<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: sync-banner-pwa-recovery -->
<!-- date: 2026-05-12 -->

# Spec: sync-banner-pwa-recovery (PR N)

**Branched off:** `origin/main` at `ee87881` (most recent commit on `main` at Phase 0 time).

**Sources:**

- Conversation 2026-05-12 — user-surfaced PWA-resume false-positive: "Sync paused" banner appears every time the iOS bookmark PWA returns to foreground, even when nothing is broken. Co-developed the recovery shape (visibility/online/focus listeners + two-signal channel-health probe + early-clear on next SUBSCRIBED).
- `apps/web/components/ListClient.tsx:255-267` — the two `setSyncError({type:'realtime'})` sites that need guarding.
- `apps/web/components/SyncErrorBanner.tsx` — banner UX; copy/affordance unchanged this PR.
- `packages/core/src/api/realtime.ts` — `subscribeToList` wrapper; gains an `onSubscribed` callback (D5).
- `CLAUDE.md § Gotchas` — the existing `subscribeToList` Gotcha (lines 35–36) describes the current `onError`-only path; this PR extends with the wake-recovery shape.
- `specs/app-snappiness/spec.md § D1` — Tier-A2 framework reference; banner remains the Tier-A2 surface, this PR fixes its trigger semantics without changing the affordance.
- `apps/web/e2e/realtime.spec.ts` — E2E patterns (admin-client provisioning, `routeWebSocket`, two-context Playwright shape).
- `@supabase/realtime-js@2.105.1` type defs — `RealtimeClient.isConnected()`, `RealtimeClient.getChannels()`, `RealtimeChannel.state`. Empirically verified at conversation time (read `RealtimeChannel.d.ts` + `RealtimeClient.d.ts` + `lib/constants.d.ts`).

Fix for the iOS PWA / desktop-sleep false-positive on the "Sync paused — tap to retry" banner. Today, ANY resumed session whose WebSocket got reaped during background emits `CHANNEL_ERROR`/`TIMED_OUT` and lights the banner before recovery has a chance. This PR teaches `ListClient` to (a) detect wake events, (b) always rebuild the realtime channel on wake, (c) suppress the banner during a known-pending reconnect window, (d) defer-fire the banner at suppress expiry if the rebuild itself failed, and (e) clear suppression early on the next `SUBSCRIBED`. Bundles a `TOKEN_REFRESHED` refetch so JWT-refresh-driven visibility expansions are caught too.

---

## Decisions (resolved at spec time)

9 decisions resolved with the user in Phase 0 (conversation 2026-05-12). Recorded below verbatim so Phase 1 preserves them and a crashed Phase 1 resumes without re-asking.

### D1: When to trigger recovery

**Decision:** Listen for all three of `document.visibilitychange` (filtered to `document.visibilityState === 'visible'`), `window.online`, and `window.focus`.

**Rationale:** iOS PWA wake fires `visibilitychange`; subway / wifi-flap recovery fires `online`; some webviews skip `visibilitychange` so `focus` is a belt-and-suspenders catch. Cost is trivial — one shared handler bound three times. Idempotent (handler is safe to fire when nothing actually changed).

### D2: What recovery does

**Decision:** On any wake event, perform the following synchronously:

1. Arm the suppress window: `suppressBannerUntilRef.current = Date.now() + SUPPRESS_WINDOW_MS`.
2. Reset `pendingErrorDuringSuppressRef.current = false` so this wake's deferred check sees a clean slate.
3. Bump `realtimeTick` (forces the realtime `useEffect` to rebuild the channel).
4. Call `runFetch()` via `queueMicrotask`.
5. Schedule a deferred banner-check via `setTimeout(..., SUPPRESS_WINDOW_MS)`. At firing, if `pendingErrorDuringSuppressRef.current` is true (CHANNEL_ERROR fired during the suppress window AND `onSubscribed` never cleared it), call `setSyncError({type:'realtime'})`. Otherwise no-op. The timer ID is captured in a useEffect-local closure and cleared on cleanup; back-to-back wakes replace the prior timer.

**Rationale:** Always-rebuild is the correct shape for this surface. The earlier two-signal probe (`isListChannelHealthy`) was an attempted optimization to skip rebuilds when the WS looked healthy — but `isConnected()` reads `socket.conn?.readyState === OPEN`, and iOS kills the TCP connection at the OS level without flipping JS `readyState`; supabase-js's heartbeat (~30s) is what eventually catches the disconnect. The probe reports healthy on a freshly-resumed PWA whose WS is actually dead, the rebuild is skipped, and the banner appears 30s later via heartbeat — the exact bug this PR exists to fix, just delayed. Always-rebuild is ~50ms of work and guarantees a ground-truth channel every wake; cheaper than a flicker.

**Pending-error tracking is load-bearing:** during the suppress window, an `onError` callback fires once and supabase-js does not auto-retry. Without `pendingErrorDuringSuppressRef`, the CHANNEL_ERROR would be silently swallowed and the banner would never surface even when the rebuild genuinely failed. The deferred-check setTimeout at suppress expiry is the recovery surface for that case.

### D3: Suppress window — duration + clearing semantics

**Decision:** `SUPPRESS_WINDOW_MS = 3000` (defensive ceiling), with **early clear on the next `SUBSCRIBED`** via a new `onSubscribed` callback added to `subscribeToList` (see D5). When the rebuilt channel reports `SUBSCRIBED`, `suppressBannerUntilRef.current = 0` so the suppression no longer applies.

**Rationale:** Eliminates the worst-case flicker the static-window version had (if reconnect takes ~3s the banner would briefly appear on its way to clearing). The early-clear keeps the suppression tight: 0 banner ever shown when reconnect succeeds within the window OR slightly outside it (race resolves the right way). The 3s ceiling is the upper bound for "if reconnect is genuinely failing, surface the banner so user can tap-to-retry"; matches the upper-bound used in the existing `routeWebSocket` E2E banner-appearance budget.

### D4: API surface — `isListChannelHealthy` helper (retired)

**Decision (revised in Phase 5.4 fix-loop, 2026-05-12):** Helper removed. The `always-rebuild on wake` shape adopted in D2 (revision) has no consumer for the probe.

**Original decision (superseded):** Export `isListChannelHealthy(client, householdId): boolean` from `packages/core/src/api/realtime.ts` that probes `client.realtime.isConnected() && channel?.state === 'joined'`.

**Why retired:** The CI slow-job's `broken-wake` E2E test deterministically failed on the initial implementation because the probe couldn't be tricked into reporting "unhealthy" within the test budget — `routeWebSocket` only intercepts new WS upgrades, leaving the existing channel's `state === 'joined'` and `isConnected() === true`. That's not a test bug; it's the production behavior. On a real iOS PWA wake, the probe lies for ~30s until the heartbeat catches up. D2's revision drops the probe and always rebuilds; D4 follows by removing the helper, its 6 unit tests, and the cross-references in CLAUDE.md / packages/core/README.md / the original imports in `ListClient.tsx`.

### D5: `subscribeToList` API change — add `onSubscribed`

**Decision:** Extend `subscribeToList` signature with an optional `onSubscribed?: () => void` callback, fired when the supabase-js subscribe-status callback emits `'SUBSCRIBED'`. Existing `onError` semantics unchanged.

```ts
export function subscribeToList(
  client: Client,
  householdId: string,
  callback: (change: ListEntryChange) => void,
  onError?: () => void,
  onSubscribed?: () => void
): () => void;
```

**Rationale:** D3's early-clear-on-SUBSCRIBED needs a signal from inside the subscribe-status callback. Adding a third optional callback keeps the contract additive — existing callers (zero — `ListClient` is the only one) keep working unchanged. Alternative was to inline the subscribe-status check inside `ListClient` by duplicating the channel construction, which would defeat the encapsulation in D4.

### D6: Guard placement for the two `setSyncError({type:'realtime'})` sites

**Decision:** Guard both call sites inside the existing `queueMicrotask` callback with `if (Date.now() < suppressBannerUntilRef.current) return;` (early return — no setState). Sites are `ListClient.tsx:260` (async `onError` path) and `:266` (synchronous-throw path).

**Rationale:** Smallest possible diff; preserves the load-bearing `queueMicrotask` defer for React 19's `react-hooks/set-state-in-effect` lint (CLAUDE.md `ListClient.tsx:208-209` comment). Guard inside the microtask, not in the listener, so the suppress check sees a fresh `Date.now()` at the moment of intent-to-show-banner, not at the moment the supabase-js error was emitted.

### D7: Test coverage strategy — E2E only

**Decision (revised TWICE — first in Phase 5.4 attempt #1, then again in attempt #2 after CI run 25771200558):** One E2E test in `apps/web/e2e/realtime.spec.ts`:

1. **healthy-wake** — sign in, land on /list, wait for the realtime channel to SUBSCRIBE, then `page.evaluate` dispatch `visibilitychange` hidden→visible. Assert "Sync paused" banner does NOT appear within 3s after dispatch. Asserts the rebuild succeeds and `onSubscribed` clears the suppress before the deferred check fires.

**`broken-wake` test deleted:** Originally planned to assert "banner appears within 10s when the rebuild itself fails." Failed deterministically on CI run 25771200558 (mobile + desktop) because the test design was fundamentally incompatible with supabase-js: once the initial WebSocket upgrade succeeds at sign-in, channel rebuilds reuse the same underlying socket — `removeChannel` + `.channel(...)` + `.subscribe()` does NOT trigger a new WS upgrade. `page.routeWebSocket` intercepts upgrade requests, so there's nothing to interrupt on the rebuild path. Same failure mode under the probe-and-skip logic AND the always-rebuild logic. The "broken connection → banner appears" semantic is already covered by the pre-existing `sync-error banner appears when WebSocket connection fails` test (realtime.spec.ts:168), which installs `routeWebSocket` BEFORE goto so the initial upgrade fails. The wake-from-good-to-broken-state edge case is verified by post-deploy manual smoke on iOS PWA (test-plan checklist in the PR).

No helper unit test (D4 retired the helper).

**Rationale:** E2E exercises the actual integration point (visibility events → supabase-js realtime client → ListClient state machine → banner DOM). The retired helper's truth-table unit tests went away with the helper. The retired broken-wake test's removal preserves the existing banner-on-broken-connection coverage AND drops a test whose design couldn't be made deterministic without leaking supabase-js internals to `window`.

### D8: Bundle `auth.onAuthStateChange('TOKEN_REFRESHED')` refetch

**Decision:** Yes — bundle into this PR. In `ListClient.tsx`, register a listener on `supabase.auth.onAuthStateChange`; when `event === 'TOKEN_REFRESHED'`, call `runFetch()`. No banner side-effects; pure refetch.

**Rationale:** Symptomatically related — a refreshed JWT can expand `current_household_id()`'s answer (e.g., user was removed mid-session and re-added). Today the realtime channel might receive the next event under the new JWT but until that event fires, the page shows stale data. The refetch is one line; bundling avoids a follow-up PR that touches the same file. No additional E2E coverage required — manual verification post-deploy is sufficient (this path is rare; rate-limit hosting integration tests against it isn't worth the slow-job time).

### D9: Roadmap source citation

**Decision:** No new `PRODUCT-ROADMAP.md` chapter. Citation: conversation 2026-05-12 + the existing `subscribeToList` Gotcha in `CLAUDE.md`. PLAN.md flips at Phase 1 (Active row added) / Phase 5.6 (Active row removed; BUILD-LOG entry appended).

**Rationale:** Tactical UX fix, not a planned roadmap chapter. The roadmap's v0 checkpoint mentions cross-session realtime + sync-banner-trigger fixes shipped via `fix/skipped-tests-cleanup`, but doesn't anticipate the wake-false-positive. Conversation-sourced fix; no chapter to renumber.

---

<!-- /ak-spec (Phase 1) expands the file from here: In scope, Files to
     create/modify, Data model changes (none), API contracts, Metrics
     (none new), Tests, Dependencies, Task order, Gotchas, Acceptance /
     rollout / rollback. The Decisions section above stays verbatim. -->

## In scope

Concrete behavioral changes, indexed to the user-approved decisions above.

1. **Wake-event listeners in `ListClient.tsx`** (D1). Bind a single handler — `handleWake` — to three browser events:
   - `document.addEventListener('visibilitychange', handleWake)` (gated inside the handler on `document.visibilityState === 'visible'`).
   - `window.addEventListener('online', handleWake)`.
   - `window.addEventListener('focus', handleWake)`.

   Registered + removed inside a `useEffect` whose deps mirror the realtime effect's deps (`supabase`, `householdId`, `realtimeTick`).

2. **`subscribeToList` API extension** (D5). Adds a fifth (optional) parameter `onSubscribed?: () => void`. Fired from the supabase-js subscribe-status callback when `status === 'SUBSCRIBED'`. Existing `onError` semantics unchanged; existing callers (`ListClient` is the only one in-repo) still work because the new param is optional and additive.

3. **Recovery handler in `ListClient.tsx`** (D2). On any wake event: arm `suppressBannerUntilRef.current = Date.now() + SUPPRESS_WINDOW_MS` (where `SUPPRESS_WINDOW_MS = 3000` per D3), reset `pendingErrorDuringSuppressRef.current = false`, bump `realtimeTick` via the functional setter (forces fresh channel build via the realtime useEffect), refetch via `queueMicrotask`. Then schedule a deferred banner-check via `setTimeout(..., SUPPRESS_WINDOW_MS)` — at firing, if pending=true, set the banner; clear the timer ID on subsequent wakes or unmount.

4. **Suppress window with early clear** (D3). New ref `suppressBannerUntilRef = useRef(0)` (epoch ms; 0 = no active suppress) + `pendingErrorDuringSuppressRef = useRef(false)` (sticky bit set inside the guarded `setSyncError` sites when an error fires inside the window). Cleared early via the new `onSubscribed` callback passed to `subscribeToList`: when the rebuilt channel reports `SUBSCRIBED`, both refs reset to their zero state. The 3000ms ceiling is the upper bound for "reconnect is genuinely failing — surface the banner so the user can tap-to-retry"; the deferred check at that boundary fires the banner if `pendingErrorDuringSuppressRef` is still true.

5. **Banner-trigger guards** (D6). Both `setSyncError({ type: 'realtime' })` sites in `ListClient.tsx` (async `onError` path + synchronous-throw fallback) add a guard inside their existing `queueMicrotask` callback. When the suppress window is armed, the guard sets `pendingErrorDuringSuppressRef.current = true` and early-returns — capturing the failure for the wake handler's deferred check rather than dropping it:

   ```ts
   queueMicrotask(() => {
     if (Date.now() < suppressBannerUntilRef.current) {
       pendingErrorDuringSuppressRef.current = true;
       return;
     }
     setSyncError({ type: 'realtime' });
   });
   ```

   The check inside the microtask, not in the listener, sees a fresh `Date.now()` at the moment of intent-to-show-banner.

6. **`SUBSCRIBED` early-clear wiring** (D5 + D3). The realtime `useEffect` body passes a fifth argument to `subscribeToList`:

   ```ts
   subscribeToList(supabase, householdId, onChange, onErrorCallback, () => {
     suppressBannerUntilRef.current = 0;
     pendingErrorDuringSuppressRef.current = false;
   });
   ```

7. **`TOKEN_REFRESHED` refetch** (D8). New `useEffect` in `ListClient.tsx` registers `supabase.auth.onAuthStateChange((event) => { if (event === 'TOKEN_REFRESHED') void runFetch(); })` and returns the unsubscribe closure (`data.subscription.unsubscribe()`) for cleanup. No banner side-effects.

Out of scope: any change to the banner's copy, affordance, or trigger taxonomy (it remains Tier-A2 per `specs/app-snappiness/spec.md § D1`); offline queueing; cross-PR refactors of `subscribeToList`'s error contract.

## Files to create / modify / delete

**Created:**

- `specs/sync-banner-pwa-recovery/spec.md` — this file (already created in Phase 0 as a skeleton; Phase 1 expands).

**Modified:**

- `packages/core/src/api/realtime.ts` — extend `subscribeToList` signature with optional `onSubscribed` param (D5), wire the supabase-js subscribe-status callback to call it when `status === 'SUBSCRIBED'`. Update JSDoc to document the new param. (Phase 5.4 revision: the originally-planned `isListChannelHealthy` helper was retired per D4 — see that decision for why.)
- `packages/core/src/api/realtime.test.ts` — add a unit test asserting `onSubscribed` is invoked exactly when status is `'SUBSCRIBED'`. Existing `subscribeToList` tests preserved.
- `apps/web/components/ListClient.tsx` — add wake listener `useEffect` (D1 + D2 + D3 + D6), `suppressBannerUntilRef` ref, `pendingErrorDuringSuppressRef` ref, deferred banner-check setTimeout in the wake handler, guard both `setSyncError({type:'realtime'})` sites to set the pending ref instead of dropping the error, wire `onSubscribed` early-clear of both refs into the `subscribeToList` call, add `TOKEN_REFRESHED` refetch `useEffect` (D8). The probe-and-skip-if-healthy branch was retired per D4 / D2 revision.
- `apps/web/e2e/realtime.spec.ts` — add two tests inside the existing `realtime + sync-error` describe: `healthy-wake` and `broken-wake` (D7). Reuses the existing `admin-client` helper + sign-in-via-form pattern. Asserts banner absence/presence after `page.evaluate`-dispatched `visibilitychange` events.
- `CLAUDE.md` — add a new Gotcha entry near the existing realtime-related entries naming the wake-recovery shape (visibilitychange / online / focus → always-rebuild → suppress + early-clear-on-SUBSCRIBED + deferred-banner-check on lingering pending error).
- `packages/core/README.md` — update the `api/realtime.ts` module-map row to reflect the `onSubscribed` param.
- `PLAN.md` — at Phase 1 start: add `sync-banner-pwa-recovery` to the Active row. At Phase 5.6: remove from Active; append a BUILD-LOG entry.

**Deleted:** none.

## Data model changes

None. No migration. The fix is entirely client-side state-machine work in `ListClient.tsx` plus a small helper extension in `packages/core/src/api/realtime.ts`.

## API contracts

The only API-shape change is `subscribeToList`'s signature — additive (new optional parameter); no breaking change to callers.

**Before** (`packages/core/src/api/realtime.ts:33-38`):

```ts
export function subscribeToList(
  client: Client,
  householdId: string,
  callback: (change: ListEntryChange) => void,
  onError?: () => void
): () => void;
```

**After:**

```ts
export function subscribeToList(
  client: Client,
  householdId: string,
  callback: (change: ListEntryChange) => void,
  onError?: () => void,
  onSubscribed?: () => void
): () => void;
```

JSDoc updates in `packages/core/src/api/realtime.ts`:

- Extend the `subscribeToList` JSDoc (the second paragraph that begins "`onError`, when supplied, …") with a sibling sentence: "`onSubscribed`, when supplied, is invoked whenever supabase-js reports `'SUBSCRIBED'` via its subscribe-status callback — including after a reconnect. Callers use this to clear a wake-recovery suppress-window once the rebuilt channel is live."
- E2E coverage line: extend the existing `apps/web/e2e/realtime.spec.ts` mention to include the new `healthy-wake` + `broken-wake` cases.

No new exported functions. (The originally-planned `isListChannelHealthy` helper was retired in the Phase 5.4 fix-loop — see D4.)

## Metrics

No new `METRICS.md` events. Banner display already emits `error_displayed` via `trackErrorDisplayed` in `apps/web/components/SyncErrorBanner.tsx:60-64`, keyed on `error_type` + `screen`. This PR changes WHEN the banner appears — fewer false-positives on wake; same-or-fewer events fire — but the event taxonomy is unchanged.

## Offline behavior

Out of scope. The product has no offline queue in v0 (`PRODUCT-ROADMAP.md § Offline support` — deferred). When offline, the banner remains the correct UX surface (it surfaces the broken realtime channel + the user's tap-to-retry affordance). This PR doesn't change that — it only delays the banner during the wake transient where recovery is plausible.

## Tests

| Test                                      | Type | File                                     | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribeToList` — onSubscribed callback | Unit | `packages/core/src/api/realtime.test.ts` | Status `'SUBSCRIBED'` invokes `onSubscribed` once; other statuses (CHANNEL_ERROR, TIMED_OUT, CLOSED) do NOT invoke it. Existing onError-callback test stays as-is.                                                                                                                                                                                                                                                                                                                                                                                          |
| `healthy-wake` E2E                        | E2E  | `apps/web/e2e/realtime.spec.ts`          | Sign in via form, land on /list, wait for SUBSCRIBE handshake (~1.5s beat), dispatch `visibilitychange` hidden→visible via `page.evaluate`. Assert "Sync paused" banner is NOT visible within 3500ms after dispatch (covers the full suppress window + a beat — onSubscribed fires from the rebuild and clears suppress before the deferred check runs).                                                                                                                                                                                                    |
| `broken-wake` E2E                         | E2E  | `apps/web/e2e/realtime.spec.ts`          | Sign in via form, land on /list, wait for SUBSCRIBE handshake (~1.5s), THEN install `page.routeWebSocket('**/realtime/v1/websocket**', ws => ws.close())` so the wake-recovery's rebuild attempt is intercepted, dispatch `visibilitychange`. Assert banner is NOT visible at 2000ms (still inside suppress window — pending ref captures the CHANNEL_ERROR), then assert banner IS visible by 10000ms (deferred check at 3s fires the banner; OR supabase-js status emits CHANNEL_ERROR after the suppress expires and the natural onError path fires it). |

**Visibility-event dispatch shape** (Playwright via `page.evaluate`):

```ts
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
});
```

Setting `document.visibilityState` BEFORE dispatching the event is load-bearing — the handler's `if (document.visibilityState !== 'visible') return;` guard would otherwise skip the recovery. `configurable: true` lets a follow-up test re-define if it ever simulates hidden→visible→hidden.

No prior `apps/web/e2e/*.spec.ts` file uses `visibilitychange` (verified empirically). This dispatch shape becomes the canonical form for the suite.

## Dependencies

None new. `@supabase/realtime-js@2.105.1` is already pinned in `pnpm-lock.yaml`. The implementation uses only public surface on `client.realtime` via the existing `subscribeToList` channel construction; nothing new.

## Task order

Dependency-ordered. T1 + T2 are independent and could land in parallel commits, but the skeleton tracker already orders them T1 → T2 → … so the spec preserves that. Each task is one commit.

As originally landed in Phase 2 (T1–T6) plus a Phase 5.4 fix-loop revision (T7):

- **T1**: Added `isListChannelHealthy` helper to `packages/core/src/api/realtime.ts` + truth-table unit tests. **Retired in T7** — see D4.
- **T2**: Extend `subscribeToList` signature with optional `onSubscribed` param; wire it from inside the subscribe-status callback when `status === 'SUBSCRIBED'`; update JSDoc; extend unit test to assert SUBSCRIBED → onSubscribed.
- **T3**: In `apps/web/components/ListClient.tsx` — add `suppressBannerUntilRef` ref, `SUPPRESS_WINDOW_MS = 3000` constant, wake-event `useEffect` (visibilitychange + online + focus), recovery handler, guards at both `setSyncError({type:'realtime'})` call sites, wire `onSubscribed` early-clear into the `subscribeToList` call.
- **T4**: In `apps/web/components/ListClient.tsx` — add `useEffect` that subscribes to `supabase.auth.onAuthStateChange` and calls `runFetch()` on `TOKEN_REFRESHED`. Return unsubscribe in cleanup.
- **T5**: In `apps/web/e2e/realtime.spec.ts` — add `healthy-wake` + `broken-wake` tests inside the existing describe. Reuse `admin-client` provisioning + sign-in-via-form pattern.
- **T6**: Add a new wake-recovery Gotcha entry in `CLAUDE.md` near the existing realtime-related entries. PLAN.md handled by /ak-build Phase 5.6.
- **T7** (Phase 5.4 fix-loop): drop the `isListChannelHealthy` probe optimization in the wake handler (always-rebuild on wake); add `pendingErrorDuringSuppressRef` + deferred banner-check `setTimeout` so a CHANNEL_ERROR during the suppress window surfaces the banner at expiry; delete the helper + its 6 unit tests; rewrite the CLAUDE.md gotcha + spec D2/D4/D7 to reflect the simpler shape. Triggered by the slow-job E2E failure where the probe could not be tricked into reporting unhealthy inside the test budget — also a production bug (probe lies for ~30s on iOS-level TCP kill, delaying the banner instead of preventing it).

## Gotchas

(Implementation hazards to keep in front of mind; surfaced from the conversation + the existing code surface.)

- **`queueMicrotask` defer is load-bearing for React 19's `react-hooks/set-state-in-effect` lint.** Both existing `setSyncError({type:'realtime'})` sites at `ListClient.tsx:260` and `:266` already defer; the wake-recovery handler's setState calls (`setRealtimeTick`) must follow the same pattern when called from inside the listener body. The `setRealtimeTick` itself is a React setter so it's fine outside a microtask in a normal event handler — but if logic moves into a `useEffect`-synchronous path, defer. The guard inside the microtask preserves the load-bearing defer AND ensures the suppress check sees a fresh `Date.now()` at the moment of intent-to-show-banner.

- **`isConnected()` can lie briefly on iOS.** This is why the original `isListChannelHealthy` probe was retired in T7. `isConnected()` reads `socket.conn?.readyState === OPEN`; iOS kills TCP at the OS level without flipping JS `readyState`; the supabase-js heartbeat (~30s) is what eventually catches it. The original probe would report healthy on a freshly-resumed PWA whose WS is actually dead, skipping the rebuild and letting the banner appear 30s later via heartbeat. The always-rebuild shape avoids the trap.

- **Test-time `visibilitychange` dispatch must set `document.visibilityState` first.** The handler's guard `if (document.visibilityState !== 'visible') return;` will skip the recovery if you dispatch the event without first redefining the readonly property:

  ```ts
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  ```

- **`routeWebSocket` placement matters in the broken-wake test.** The existing banner test installs `page.routeWebSocket('**/realtime/v1/websocket**', ws => ws.close())` BEFORE navigating to /list (to fail the initial connect). The new broken-wake test installs it AFTER the initial subscribe has succeeded (so the wake-recovery's rebuild attempt is what trips, not the first connect). Install order:
  1. Sign in via form → wait for /list.
  2. Wait ~1.5s for initial SUBSCRIBE (mirrors the cross-session test).
  3. `await page.routeWebSocket(...)`.
  4. Dispatch `visibilitychange`.

- **Onboarding redirect path doesn't change.** The `RemovedFromHouseholdError` handling stays exactly as-is in `runFetch()` (`ListClient.tsx:194-200`). Wake-recovery's `runFetch()` calls re-use this — if the user was removed while backgrounded, the wake refetch surfaces it via the same redirect.

- **`onAuthStateChange` subscription cleanup.** `supabase.auth.onAuthStateChange(cb)` returns `{ data: { subscription } }` — the cleanup function in the `useEffect` must call `data.subscription.unsubscribe()`, not pass the returned object directly to a closure. Forgetting the unsubscribe leaks listeners on every `householdId` change.

- **`SUBSCRIBED` fires on first connect AND every reconnect.** The new `onSubscribed` callback fires on every successful (re)subscription, not just reconnects. This is fine — the suppress window starts at 0 so calling `suppressBannerUntilRef.current = 0` on the first SUBSCRIBED is a no-op. Don't gate the callback on "is suppress active" because the rebuild may complete before the listener-thread reads `Date.now()`.

## Acceptance criteria

- The `healthy-wake` E2E test passes locally (`pnpm test:e2e -- realtime.spec.ts`) and on CI slow-job.
- The `broken-wake` E2E test passes locally and on CI slow-job.
- The unit test for `subscribeToList`'s new `onSubscribed` callback passes; existing `onError` test continues to pass unchanged.
- Lint (`pnpm lint`), typecheck (`pnpm turbo run typecheck`), unit tests (`pnpm turbo run test:unit`), and build (`pnpm turbo run build`) all pass locally pre-ship.
- The `subscribeToList` JSDoc accurately describes the new `onSubscribed` callback — when it fires (subscribe-status === 'SUBSCRIBED'), what callers use it for (early-clear of wake-recovery suppress).
- The `CLAUDE.md` wake-recovery Gotcha describes the always-rebuild + pending-error-tracking + deferred-banner-check shape.
- Manual verification: iOS Safari PWA + desktop Chromium — background the app, wait 60s, foreground; the "Sync paused" banner does NOT appear on resumed-and-still-healthy sessions. Documented in BUILD-LOG entry alongside CI receipts (Phase 5.6).
- No new lint suppressions or `// eslint-disable` lines introduced.

## Rollout / rollback

- **Rollout:** Merge to `main` → Vercel auto-deploys the front-end on push. No migration (no `supabase/migrations/**` changes). No edge function deploy (no `supabase/functions/**` changes). PR's post-merge checklist is just: watch the Vercel deploy succeed, then optional manual verification on the iOS bookmark PWA against the prod URL `https://lalista.store`.
- **Rollback:** Revert the PR. The pre-change behavior is what's on `main` today — banner fires on every CHANNEL_ERROR/TIMED_OUT (including wake false-positives). No schema, no edge function, no external surface to undo. Vercel re-deploys the reverted commit on push.
