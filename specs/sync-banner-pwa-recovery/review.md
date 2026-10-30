# Pre-ship review — sync-banner-pwa-recovery

## Gate 1: Preflight

Result: pass
Notes: pnpm 10.33.0, git 2.53.0, gh 2.91.0 present; on branch fix/sync-banner-pwa-recovery (not main). Chromium preflight skipped per Phase 3 instructions (logic-only PR; no browser gates run this phase).

## Gate 2: Docs check

Result: findings (1) fixed
Notes: packages/core/README.md still showed the pre-PR 4-arg subscribeToList signature and didn't mention isListChannelHealthy. Fixed in commit 9273cc7 — module-map row + Realtime errors convention bullet now reflect the new onSubscribed param + isListChannelHealthy helper. CLAUDE.md gotcha was already updated in commit e558798 (T6); apps/web/README, OVERVIEW.md, ARCHITECTURE.md mentions are accurate at their abstraction level (no drift).

## Gate 3: Metrics check

Result: pass
Notes: PR adds no new events. METRICS.md untouched in feature-range diff; no new posthog.capture() / Sentry.captureException sites in changed files. Existing error_displayed event taxonomy unchanged — banner trigger semantics change does not alter event shape, only frequency.

## Gate 4: Fast-job-local (lint + typecheck + test:unit + build)

Result: findings (1) fixed
Notes: First run of `pnpm turbo run test:unit` after Gate 2 fix surfaced 10 failures in apps/web/components/ListClient.test.tsx — T4's TOKEN_REFRESHED useEffect (commit e1245fa) calls `supabase.auth.onAuthStateChange` at mount but the test's createClientMock returned a bare `{ __kind: 'client-stub' }` with no auth surface, crashing every test with "Cannot read properties of undefined (reading onAuthStateChange)". Fixed in commit bd6e494 — extended both the hoisted factory AND beforeEach mockReturnValue with a no-op `auth.onAuthStateChange` returning the expected `{data: {subscription: {unsubscribe}}}` shape. After fix: full `pnpm turbo run lint typecheck test:unit build` passes (43 test files, 304 tests, ~58s wallclock).

## Gate 5: Changed-tests-local

Result: pass
Notes: packages/core/src/api/realtime.test.ts → 11/11 pass; apps/web/components/ListClient.test.tsx → 11/11 pass after the Gate-4 mock-fix + the Audit-1 TOKEN_REFRESHED test that was added during /ak-check-docs-and-tests. Playwright parse-check via `playwright test --list e2e/realtime.spec.ts` → 8 tests parsed (4 cases × 2 viewports). Actual E2E runs deferred to CI slow-job (requires local Supabase).

## Gate 6: Responsive + theme

Result: n/a
Notes: trigger semantics change only; banner UI unchanged this PR. Same copy ("Sync paused — tap to retry"), same component (SyncErrorBanner), same affordance. No visual surface added or modified.

## Gate 7: /simplify

Result: findings (1) fixed
Notes: Wake-recovery useEffect deps included `realtimeTick` but the handler body never reads it (uses functional setter `setRealtimeTick((t) => t + 1)`). Including the dep forced a re-bind of all three event listeners every time the tick bumped — which the unhealthy-wake branch itself triggers (a self-rebuilding effect with no behavioral payoff). Fixed in commit fada4b6 — dep removed; an inline comment pins the intentional omission so a future contributor doesn't "fix" it back. No other simplification opportunities found: helper signatures are minimal, microtask defer is load-bearing for React 19's set-state-in-effect lint, guard-inside-microtask pattern is the spec-mandated D6 shape, two SSR guards are idiomatic.

## Gate 8: /ak-check-docs-and-tests (Audit 1 — pre-polish)

Result: findings (2) fixed
Notes: Orchestrator ran /ak-docs-review then /ak-tests-review against feature-only range (merge-base..HEAD). Two findings surfaced; both fixed in commit c1fc6a9. Full structured findings appear in `## Audit 1` section below per the orchestrator's parse contract.

## Gate 9: /review

Result: pass
Notes: Pre-landing diff review against origin/main. All commits in feature range adhere to: (a) atomic per-task commits with conventional-commit prefixes; (b) JSDoc on every new exported function (isListChannelHealthy in api/realtime.ts; subscribeToList signature update with extended JSDoc); (c) load-bearing comments cite the spec section (D1/D2/D3/D5/D6/D8) so a future reader can trace the rationale. No SQL changes (no migrations). No LLM trust-boundary violations (the only new exported function is `isListChannelHealthy`, a pure synchronous helper). No conditional side-effects masked behind a feature flag. The diff is contained: 5 source files (CLAUDE.md doc + 2 packages/core files + 2 apps/web files) + 1 E2E spec + spec + tasks tracker. Test-presence ratio is 1:1 (every new source file pairs with a test file update).

## Gate 10: /cso

Result: pass
Notes: Daily security audit (8/10 confidence gate). The PR adds no new SQL, no migrations, no edge-function code, no auth-boundary code, no service-role usage. Attack surface delta:

- `isListChannelHealthy` reads `client.realtime.isConnected()` + `client.realtime.getChannels()` — both public supabase-js surface; channels are scoped to the authenticated user's JWT; no PII / token leakage; no cross-household visibility risk.
- `subscribeToList`'s new `onSubscribed` callback is a notification only — no data flows through it; load-bearing for state machine in ListClient but not a privilege boundary.
- ListClient's wake-event listeners (`visibilitychange` / `online` / `focus`) are page-local; not an attacker-controllable surface.
- ListClient's TOKEN_REFRESHED useEffect triggers a refetch under the NEW JWT — this is the SECURE path (the old code path could show stale data from a JWT scope that no longer applies). Reduces an information-disclosure risk, doesn't add one.
- No new dependencies; no new env vars; no new outbound network destinations.
- No secrets in any committed file (gitleaks ran clean on every commit).

## Gate 11: /design-review

Result: n/a
Notes: trigger semantics change only; banner UI unchanged this PR (same as Gate 6).

## Gate 12: /qa

Result: n/a
Notes: behavior is fully exercised by realtime.spec.ts wake-recovery tests (healthy-wake + broken-wake); no new visual surface or user flow. Live-site QA pass adds nothing material to what the deterministic E2E + unit tests already pin.

## Gate 13: /benchmark

Result: n/a
Notes: No performance-critical change. Three event listeners (visibility/online/focus) bound once per /list mount; handler is a cheap probe (`isConnected()` + `getChannels().find()`). TOKEN_REFRESHED useEffect registers one auth listener per mount. No new render paths, no new fetch frequencies in steady state, no bundle-size growth beyond a single helper function.

## Gate 14: Preflight (final)

Result: pass
Notes: Final-state tooling attestation. `pnpm turbo run lint typecheck test:unit build` re-ran clean on HEAD c1fc6a9 (verified in Gate-8 follow-up checkpoint). No regressions from the audit-1 inline fixes. Tooling: pnpm/git/gh present and same versions as Gate 1.

## Gate 15: Convention check

Result: pass
Notes:

- File headers (// What: / // Why: / // Does NOT:) on changed source: ListClient.tsx, realtime.ts, realtime.test.ts, ListClient.test.tsx, realtime.spec.ts — all carry the convention header (pre-existed); modifications are within-file edits to existing well-headed files.
- JSDoc on new exported functions: `isListChannelHealthy` has full JSDoc (purpose, contract, iOS caveat, canonical-topic gotcha). `subscribeToList`'s new param documented inline within the existing function's JSDoc.
- No new migration files in this PR; ON DELETE + supabase_realtime publication clauses n/a.
- No new subscribeTo<X> helper added (we extended the existing one); supabase_realtime publication for list_entries already added in migration 013.
- No new SECURITY DEFINER RPCs.
- E2E-per-surface invariant: every UI-touching change (ListClient.tsx wake handler + TOKEN_REFRESHED useEffect) has E2E coverage via realtime.spec.ts (healthy-wake + broken-wake); the wrapper extensions (isListChannelHealthy, subscribeToList onSubscribed) have paired unit tests.
- Spec + tasks.md complete with SHAs backfilled; PR's BUILD-LOG entry handled by /ak-build Phase 5.
- No completed items left in PRODUCT-ROADMAP.md or kit/ROADMAP.md (this PR is a conversation-sourced tactical fix; no roadmap chapter to renumber per spec D9).

## Gate 16: Hero screenshots

Result: n/a
Notes: No visual surface change; specs/sync-banner-pwa-recovery/hero/ intentionally absent. PR body will cite the wake-recovery E2E tests (healthy-wake + broken-wake) as the durable evidence record in lieu of hero shots.

---

## Audit 1: pre-polish (2026-05-12)

<!-- audited-at: c1fc6a90dadc77f56008271d34f08094a795e236 -->
<!-- range: ee8788183710f184e02da8f45c52b4e9a6810f8f..HEAD -->

Note on range: the feature-only range used is `merge-base(origin/main, HEAD)..HEAD`, which is `ee8788183710f184e02da8f45c52b4e9a6810f8f..HEAD`. The naive `origin/main..HEAD` would have included the `my-stores` rollback that landed on main while this branch was being developed — that rollback is not in scope for this feature's audit.

findings: high=0 medium=1 low=1 (all fixed during audit)

### Docs findings

- [low] packages/core/README.md:39 — cross-reference `CLAUDE.md § subscribeToList wake-recovery` named a non-existent heading; the wake-recovery content lives as a bullet under `## Gotchas`. Corrected during audit to `CLAUDE.md § Gotchas → subscribeToList wake-recovery bullet`. (Fixed in commit c1fc6a9.)

### Tests findings

- [medium] apps/web/components/ListClient.test.tsx — initial commit shipped D8's TOKEN_REFRESHED useEffect without paired unit coverage (spec D8 deferred to "manual verification post-deploy"). The auth-event-string is a load-bearing string contract; a future contributor renaming the event or dropping the listener would silently lose the refetch-after-JWT-refresh path. Fixed during audit by adding `it('refetches the list on TOKEN_REFRESHED (D8 of sync-banner-pwa-recovery)')` — captures the registered `onAuthStateChange` callback, asserts a refetch fires when invoked with `TOKEN_REFRESHED`, and asserts no refetch on `SIGNED_IN` / `USER_UPDATED` / `SIGNED_OUT`. Baseline-relative count assertion tolerates mount-phase fetch variance. (Fixed in commit c1fc6a9.)

### Bypass trailer audit

- (none) — no `Docs-Coverage-Bypass:` or `Tests-Coverage-Bypass:` trailers in range.
