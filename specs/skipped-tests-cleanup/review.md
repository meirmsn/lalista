# Pre-ship review: skipped-tests-cleanup

## Outcome counts

- passed: 7
- findings_pending: 0
- n_a: 4
- blocked: 0

## Per-gate results

### Gate 1: Docs check

- Outcome: findings (1) [fixed]
- Details: CLAUDE.md "Realtime for `list_entries` uses `subscribeToList`" gotcha
  showed the old 3-parameter signature `(client, householdId, callback) →
unsubscribe` — the new optional fourth parameter `onError?` and migration
  013 publication membership were undocumented. Updated the gotcha to (a)
  reflect the new signature, (b) describe the four supabase-js status
  strings (`CHANNEL_ERROR` / `TIMED_OUT` fire onError; `SUBSCRIBED` /
  `CLOSED` do not), (c) note the complementary relationship with the
  caller's try/catch for synchronous-throw failures, and (d) mention
  migration 013 + the older-vs-newer Supabase CLI publication-membership
  divergence. Migration 013's rollback contract is fully covered by
  `scripts/ci-rollback-explain.sh`'s round-trip — no separate doc needed.
  The renamed email-not-confirmed test has no external references — no doc
  change required for that. Fixed in commit `0096d09`.

### Gate 2: Metrics check

- Outcome: pass
- Details: Spec asserts "no new events." Verified by grepping `track*(` calls
  across the diff: only existing `trackItemBought` is called (unchanged in
  this PR's scope). METRICS.md table line 13 already documents the
  `error_displayed { error_type: 'realtime' }` event, which is fired by
  `SyncErrorBanner` on render. The new `onError` wiring just makes the
  banner render in more cases (real WS failures, not only sync-throws); the
  analytics surface is the same.

### Gate 3: Responsive + theme check

- Outcome: n/a
- Details: No UI changes. Banner copy (`Sync paused — tap to retry` rendered
  by `SyncErrorBanner.tsx`) is unchanged. Sign-in friendly-error copy
  (`Check your email to confirm your account first`,
  `Too many attempts. Please try again in a few minutes.`) is also
  unchanged — the new tests assert against pre-existing
  `friendlyAuthError` mappings.

### Gate 4: /simplify

- Outcome: pass
- Details: Reviewed all 7 implementation commits + the pre-ship docs commit.
  - `packages/core/src/api/realtime.ts:48-52` — the status-callback shape is
    minimal and direct. Conditional check on the two error states only,
    optional chaining preserves the no-op fast path. Clean.
  - `apps/web/components/ListClient.tsx:159-165` — `queueMicrotask` mirrors
    the synchronous-throw branch at line 170 (same defer-to-tick pattern,
    same `setSyncError({type:'realtime'})` call). Comment cites the lint
    rationale + cross-references the sister branch. No duplication concern
    — these are two distinct trigger paths. Clean.
  - `apps/web/e2e/realtime.spec.ts` — banner test reuses the
    `routeWebSocket` close pattern documented inline; cross-session test
    reuses the established two-context provisioning shape. No dead code
    left behind from the un-skip removal.
  - `apps/web/e2e/auth-edge-cases.spec.ts` — both new bodies reuse the
    `/` → "Get started" form-state-hydration-safe navigation pattern from
    sibling tests. No duplication; comments are load-bearing (reframe
    rationale, network-mock rationale).
  - `supabase/migrations/013_realtime_publication.sql` — DO-block guard +
    rollback are exactly what the spec gotcha prescribed. Idempotent on
    older + newer CLI variants. Clean.
  - `packages/core/src/api/realtime.test.ts` — new test exercises four
    status strings (CHANNEL_ERROR, TIMED_OUT, SUBSCRIBED, CLOSED) and
    asserts call-count progression. Captures the production status
    callback (not asserting on mock internals); see Gate 5.
    No dead code, unnecessary duplication, or missed abstractions found.
    Apply-as-you-go: nothing applied; no changes required from this gate.

### Gate 5: /ak-test-review

- Outcome: findings (1) [fixed]
- Details:
  - `realtime.test.ts` new unit test: captures `channel.subscribe.mock.calls[0][0]`
    (the production-supplied status callback) and invokes it with each of
    the four supabase-js statuses. This exercises the production code path
    (`subscribeToList`'s `.subscribe(status => { if (...) onError?.(); })`),
    not mock internals. The four-status sweep correctly verifies that
    SUBSCRIBED + CLOSED do NOT fire onError (call count stays at 2 after
    each), which is the load-bearing distinction. Strong assertion shape.
  - `auth-edge-cases.spec.ts` lines 215, 257: both new bodies assert on
    user-facing copy via case-insensitive regex (`/check your email to
confirm your account first/i`, `/too many attempts.*try again in a few
minutes/i`). Final URL assertion (`/\/sign-in/`) is also UI-state, not
    backend internals. Confirmed via implementation read.
  - `realtime.spec.ts` lines 27 (cross-session), 168 (banner): cross-session
    asserts on the unique brand string visible to page B + DB-level
    `list_entries` row count cross-check. Banner asserts on `/sync paused.*tap
to retry/i` regex. Both shapes match the spec's acceptance criteria.
  - **E2E-per-surface invariant** (CLAUDE.md § Testing): `subscribeToList` is
    a `packages/core/src/api/` wrapper. Per CLAUDE.md, every wrapper needs
    either dedicated E2E or documented transitive coverage. The
    cross-session + banner E2Es exercise it through ListClient, but the
    JSDoc didn't cite the covering specs. **Finding:** added an
    "E2E coverage" section to the JSDoc citing
    `apps/web/e2e/realtime.spec.ts`'s two tests. Fixed in commit `0096d09`.
  - Test-naming: no `console.log` debug artifacts. Test bodies follow the
    existing per-file convention (helper imports, project-name-stamped
    fixtures, admin-client provisioning). Clean.

### Gate 6: /review

- Outcome: pass
- Details:
  - **Migration 013 SQL safety**: idempotent guard via
    `pg_publication_tables` check; no data side-effects (publication
    membership only); no RLS change; ROLLBACK round-trips via
    `scripts/ci-rollback-explain.sh`. The rollback statement
    (`alter publication supabase_realtime drop table list_entries`) is the
    exact inverse of the forward path. ✓
  - **LLM trust boundary**: N/A — no edge function changes.
    `supabase/functions/**` is untouched.
  - **Conditional side effects**: the new onError wiring in
    `ListClient.tsx:159-165` defers via `queueMicrotask`. Verified same
    pattern as the existing line 170 sync-throw branch. setSyncError is the
    only side effect. ✓
  - **Structural**: gitleaks ran clean during the docs commit. No new
    secrets or env vars in the diff.

### Gate 7: /cso

- Outcome: pass
- Details:
  - **Migration 013**: publication membership exposes no new data —
    Realtime delivery is filtered by RLS at the per-row level via
    `household_id=eq.<id>` filter, and RLS policies on `list_entries` still
    enforce membership-only reads. Adding the table to the publication just
    enables the WAL stream to reach Realtime, which then re-applies RLS.
    No security regression. ✓
  - **Cross-session E2E security model**: the test uses the admin client to
    provision two users and one shared household, then user B (signed in
    via the public form) sees the row that the admin client INSERTed.
    User B's session has membership in the household, so RLS would have
    delivered the row to B regardless of who INSERTed it. Test models the
    real cross-member delivery shape correctly. ✓
  - **Network mocks in E2E**: `page.route` and `page.routeWebSocket` only
    intercept the Playwright-driven page's network — they're scoped to the
    `BrowserContext`, not the test runner itself. The mocks fulfill within
    the page only and have no effect on real traffic outside the test. ✓
  - **No new secrets, no new env vars**: confirmed via
    `git diff main..HEAD --name-only`; no `.env*` or workflow secret
    additions.

### Gate 8: /design-review

- Outcome: n/a
- Details: No visible UI changes. Banner copy/render is unchanged
  (the SyncErrorBanner trigger is what's new — the banner itself was
  already shipped). Sign-in friendly-error copy is unchanged.

### Gate 9: /qa

- Outcome: n/a
- Details: No UI surface to dogfood. The production fix path (new
  `onError` wiring) is exercised end-to-end by the new
  `realtime.spec.ts` banner E2E in slow-job CI. No manual smoke check
  needed per spec's acceptance criteria.

### Gate 10: /benchmark

- Outcome: n/a
- Details: No perf-relevant changes. Migration 013 adds a publication
  member (no impact on query plans). The `onError` wiring is one extra
  function-pointer assignment + one if-statement per supabase-js status
  emit; immeasurable overhead.

### Gate 11: Convention check

- Outcome: pass
- Details:
  - **Migration numbering**: `013_realtime_publication.sql` follows the
    monotonic order (`012_profiles.sql` was the prior). ✓
  - **`-- ROLLBACK:` block**: present in 013 with the inverse statement,
    matches the convention used by prior migrations. Round-trips via
    `scripts/ci-rollback-explain.sh`. ✓
  - **JSDoc preserved on `subscribeToList`**: original "Subscribe to
    list_entries..." block kept; new `onError` paragraph appended; new
    "E2E coverage" paragraph appended (per E2E-per-surface invariant).
    Style matches the rest of the file. ✓
  - **Test-naming**: no `console.log` artifacts; test names follow the
    existing pattern (descriptive phrase, not file-coupled). ✓
  - **Commit messages**: 7 implementation commits use the project's
    `feat(scope):` / `test(scope):` shape consistent with PR 5 / PR 6
    history. The pre-ship docs commit uses `docs(realtime):` matching
    the same convention. ✓

## Findings fixed during pre-ship

- **CLAUDE.md docs gap (Gate 1)** — `subscribeToList` gotcha showed the old
  3-parameter signature; updated to reflect the new `onError?` parameter,
  status-string semantics, sync-throw complementarity, and migration 013
  publication membership. Fixed in commit `0096d09`.
- **JSDoc E2E citation (Gate 5)** — `subscribeToList`'s JSDoc lacked the
  E2E-coverage citation required by CLAUDE.md § Testing's
  E2E-per-surface invariant. Added a final paragraph citing
  `apps/web/e2e/realtime.spec.ts`'s cross-session + banner tests.
  Fixed in commit `0096d09`.

## Findings pending (block advancement)

(empty)

## Notes / decisions

- The two findings fixed during pre-ship were both docs-only (CLAUDE.md
  prose + JSDoc comment block); no production code changed. Re-ran
  `pnpm turbo run test:unit` afterward — 154 tests across 24 files, all
  green. No regressions.
- The production build fails locally due to network sandbox blocking
  Google Fonts (`Failed to fetch Fraunces / Plus Jakarta Sans`) — this
  is a known sandbox limitation, not a code regression. Vercel's build
  environment fetches fonts successfully; CI's fast-job typecheck +
  test:unit + lint all pass cleanly.
- Pre-commit hook surfaced an unrelated devshop staged change
  (`kit/ROADMAP.md` on a different feature branch). Used the
  `git -c devshop.crossRepoReason="..."` flag with a clear explanation;
  the adversarial-review check accepted the cross-repo reason. The
  staged devshop change is independent v0 migration sequencing work
  with no relationship to this PR.
- All 4 previously-skipped tests now appear in `playwright test --list`
  output as active (no longer behind unconditional `test.skip(true,
...)`); they will run on slow-job CI under both `mobile` and
  `desktop` projects.
- Migration 013 is auto-deployed on push:main via
  `.github/workflows/deploy-migrations.yml` (path-filtered). Spec
  documents the rollout shape; `SUPABASE_PROD_URL` Variable already in
  place from prior PRs.
