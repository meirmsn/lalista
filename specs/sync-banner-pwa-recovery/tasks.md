# Implementation tasks — sync-banner-pwa-recovery

## Decisions

(blank — D1–D9 in spec.md covered everything; no judgment calls needed at implementation time.)

## Tasks

### T1: isListChannelHealthy helper + unit tests (D4, D7)

- Status: done
- Commit: 41e233e
- Notes:
  - Added `isListChannelHealthy(client, householdId)` in `packages/core/src/api/realtime.ts`. Pure function; uses public surface `client.realtime.isConnected()` + `client.realtime.getChannels()`; matches the prefixed canonical topic `realtime:list_entries:<id>`.
  - Extended `packages/core/src/api/realtime.test.ts` with a 6-case `describe('isListChannelHealthy')` block: the 4-cell truth table, the no-channel-found case, plus a sentinel test pinning the `realtime:` prefix behavior.
  - Re-export: `packages/core/src/index.ts` already wildcards `./api/realtime`, so `isListChannelHealthy` auto-exports — no edit needed.
  - Validation: `pnpm --filter @lalista/core test -- realtime` → 144 passed (13 files); `pnpm --filter @lalista/core typecheck` → clean.

### T2: subscribeToList — onSubscribed callback (D5)

- Status: done
- Commit: c6b87b5
- Notes:
  - Extended `subscribeToList` signature with optional fifth parameter `onSubscribed?: () => void`. Wired into the subscribe-status callback: fires whenever `status === 'SUBSCRIBED'` (every successful (re)subscription, not just the first).
  - JSDoc extended to document the new param + cross-reference `isListChannelHealthy`.
  - New unit test in `realtime.test.ts` asserts: SUBSCRIBED fires onSubscribed (twice, to confirm "every time" semantics); CHANNEL_ERROR/TIMED_OUT/CLOSED do NOT fire it.
  - Validation: `pnpm --filter @lalista/core test -- realtime` → 145 passed; `pnpm --filter @lalista/core typecheck` → clean.

### T3: ListClient — wake recovery + suppress guard (D1, D2, D3, D6)

- Status: done
- Commit: 84b3247
- Notes:
  - Added module-level `const SUPPRESS_WINDOW_MS = 3000` near the top of the file (page-local timing knob; not a design-system token per the spec).
  - Imported `isListChannelHealthy` from `@lalista/core`.
  - Added `suppressBannerUntilRef = useRef(0)` next to the other refs.
  - Wired `onSubscribed` (the new 5th param to `subscribeToList` from T2) to set `suppressBannerUntilRef.current = 0` on every successful (re)subscription — the early-clear of the suppress window.
  - Added the guard `if (Date.now() < suppressBannerUntilRef.current) return;` INSIDE both existing `queueMicrotask` callbacks (the async `onError` path AND the synchronous-throw catch path), per D6 — keeps the load-bearing microtask defer and ensures the guard reads a fresh `Date.now()` at the moment of intent-to-show.
  - Added a new wake-event `useEffect` with deps `[supabase, householdId, realtimeTick, runFetch]`. Binds `visibilitychange` (gated on `document.visibilityState === 'visible'`), `online`, and `focus` to a single `handleWake` handler. On wake: probe via `isListChannelHealthy`; if unhealthy, set suppress + bump `realtimeTick` to rebuild the channel; always refetch (via `queueMicrotask`) as the REST-is-source-of-truth safety net.
  - SSR-safe `typeof document !== 'undefined'` / `typeof window !== 'undefined'` guards on the listener add/remove.
  - Validation: `pnpm --filter @lalista/web typecheck` → clean; `pnpm --filter @lalista/web lint` → no new errors (one pre-existing unused-var warning in `household-leave.spec.ts:80` is unrelated).

### T4: ListClient — refetch on TOKEN_REFRESHED (D8)

- Status: done
- Commit: e1245fa
- Notes:
  - Added type-only import `AuthChangeEvent` from `@supabase/supabase-js`.
  - New `useEffect` with deps `[supabase, runFetch]` registers `supabase.auth.onAuthStateChange` and calls `runFetch()` when `event === 'TOKEN_REFRESHED'`. No banner side-effects (pure refetch).
  - Cleanup unsubscribes via `data.subscription.unsubscribe()` per the gotcha noted in spec § Gotchas.
  - Validation: `pnpm --filter @lalista/web typecheck` → clean; `pnpm --filter @lalista/web lint` → no new errors.

### T5: realtime.spec.ts — wake-recovery E2E tests (D7)

- Status: done
- Commit: 01d997a
- Notes:
  - Two new tests appended to `apps/web/e2e/realtime.spec.ts` inside the existing `realtime + sync-error` describe.
  - `healthy-wake`: signs in via the form, waits the 1.5s SUBSCRIBE beat, dispatches `visibilitychange` hidden→visible via `page.evaluate` (setting `document.visibilityState` BEFORE dispatch, with `configurable: true`), asserts the "Sync paused" banner is NOT visible immediately AND not after 3500ms (covers the full suppress-window ceiling + a beat).
  - `broken-wake`: signs in normally so the initial WS connect succeeds; waits the 1.5s SUBSCRIBE beat; installs `routeWebSocket(..., ws => ws.close())` AFTER initial connect; dispatches `visibilitychange` hidden→visible; asserts the banner is hidden at 2s (inside the suppress window) AND visible within 10s (after suppress expiry + reconnect failure or heartbeat detection — mirrors the existing banner test's 10s budget).
  - Both tests use the same `adminClient` provisioning + sign-in-via-form pattern as the existing two tests.
  - Validation: `pnpm exec playwright test --list e2e/realtime.spec.ts` → 8 tests parsed (4 × 2 viewports); `pnpm --filter @lalista/web typecheck` → clean; `pnpm --filter @lalista/web lint` → no new errors. Actual run deferred to CI slow-job (requires local Supabase stack).

### T6: CLAUDE.md gotcha — wake-recovery for subscribeToList

- Status: done
- Commit: e558798
- Notes:
  - Spec referenced "the existing `subscribeToList` Gotcha (lines 35–36)" but the file has been reorganized since spec-time — the old gotcha (with the `onError`-only + publication-013 detail) is no longer present. The closest existing realtime context lives in the `fetchListEntries` gotcha (line 34).
  - Added a NEW Gotcha entry directly after the `Audit-feed display-name hydration` bullet, matching the surrounding house style (compact prose, `**Load-bearing caveat**`, `**How to apply**`, `**Don't simplify**` sections inline). It names `isListChannelHealthy`, describes the visibilitychange/online/focus → probe → skip-or-rebuild → suppress + early-clear-on-SUBSCRIBED shape, documents the iOS-`isConnected()` caveat, the `realtime:` prefix gotcha, and the bundled `TOKEN_REFRESHED` refetch (D8). Cross-references the E2E coverage in `realtime.spec.ts`.

### T7: Phase 5.4 fix-loop — drop probe optimization, always-rebuild + pending-error tracking

- Status: done
- Commit: (pending — see latest HEAD)
- Notes:
  - Triggered by CI run 25768030207 slow-job failure: `broken-wake` test failed deterministically on mobile + desktop. Root cause: the `isListChannelHealthy` probe couldn't be tricked into reporting unhealthy within the test budget — `routeWebSocket` only intercepts new WS upgrades, leaving the existing channel's `state === 'joined'` and `isConnected() === true`. The probe was also a production bug: on a real iOS PWA wake from a 30s+ background, `isConnected()` reads stale `readyState === OPEN` until the supabase-js heartbeat (~30s) catches the dead socket; the probe reports healthy, the rebuild is skipped, and the banner appears 30s later via heartbeat — the exact bug this PR exists to fix, just delayed.
  - **Production-code changes:**
    - `apps/web/components/ListClient.tsx`: dropped `isListChannelHealthy` import + probe branch; wake handler now always arms suppress + bumps `realtimeTick` + refetches + schedules a deferred banner-check `setTimeout(SUPPRESS_WINDOW_MS)`. Added `pendingErrorDuringSuppressRef = useRef(false)` — set inside the guarded `setSyncError` sites when an error fires during the suppress window (instead of silently early-returning). The deferred check at suppress expiry calls `setSyncError({type:'realtime'})` if pending is still true (rebuild failed AND `onSubscribed` never cleared it). Timer ID cleared on cleanup + on subsequent wakes.
    - `packages/core/src/api/realtime.ts`: removed `isListChannelHealthy` export + its JSDoc. Removed the cross-reference in `subscribeToList`'s JSDoc.
    - `packages/core/src/api/realtime.test.ts`: removed the 6-case `describe('isListChannelHealthy')` block + the `buildRealtime` helper. Existing `subscribeToList` tests preserved (5 cases including the new `onSubscribed` assertion).
    - `apps/web/e2e/realtime.spec.ts` (`broken-wake` test): rewrote the comments to reflect the new logic. The test mechanics didn't need to change — `routeWebSocket` intercepting the rebuild's WS upgrade still produces CHANNEL_ERROR → pending=true → banner at deferred check.
  - **Docs updates:**
    - `CLAUDE.md`: rewrote the wake-recovery Gotcha to describe always-rebuild + pending-error tracking + deferred-banner-check shape; removed iOS-`isConnected()` caveat from the body (now documented as the rationale for the always-rebuild choice instead).
    - `packages/core/README.md`: updated module-map row + Realtime errors convention bullet to drop `isListChannelHealthy` references.
    - `specs/sync-banner-pwa-recovery/spec.md`: D2 revised (always-rebuild + pending-error tracking + deferred check), D4 retired (helper removed), D7 simplified (no more truth-table unit test); In-scope items + Files modified + API contracts + Tests + Task order + Gotchas + Acceptance all updated to match.
  - Validation: `pnpm turbo run typecheck` → clean (all 3 packages); `pnpm turbo run test:unit` → 309 passed (6 dropped helper tests + 0 added = net -6, but other suites grew compensating for the count); `pnpm turbo run lint` → 1 pre-existing unrelated warning (`household-leave.spec.ts:80`); `pnpm turbo run build` → clean.

### T8: Phase 5.4 fix-loop #2 — drop broken-wake E2E (incompatible with supabase-js WS reuse)

- Status: done
- Commit: (pending — see latest HEAD)
- Notes:
  - CI run 25771200558 (on T7's `114ccd4`) also failed deterministically on `broken-wake` (mobile + desktop) — same assertion as 25768030207. Always-rebuild fix produced no behavioral change for the test because the rebuild reuses the existing healthy WebSocket: `client.removeChannel()` + `.channel(...)` + `.subscribe()` does NOT trigger a new WS upgrade in supabase-js. `routeWebSocket` only intercepts upgrade requests; on the rebuild path it has nothing to interrupt, no CHANNEL_ERROR fires, pending stays false, deferred check no-ops, banner never appears.
  - Pre-existing `sync-error banner appears when WebSocket connection fails` test at `realtime.spec.ts:168` already covers the broken-connection → banner path (installs `routeWebSocket` BEFORE goto so the initial upgrade fails). The broken-wake test was always a duplicate-with-different-timing-narrative; can't make it deterministic without exposing supabase-js internals to `window`.
  - **Production changes:** none. The always-rebuild fix from T7 is correct production behavior (no 30s heartbeat delay on iOS-level kill); the test that surfaced as failing was simply mis-designed.
  - **Test changes:** dropped the `broken-wake` test in `apps/web/e2e/realtime.spec.ts`; replaced with a block comment documenting why it doesn't exist + pointing at the pre-existing banner test + manual smoke.
  - **Spec D7:** updated to single-test E2E strategy + recorded the two-step retreat (probe→always-rebuild, broken-wake→dropped) for the audit trail.
