<!-- audited-at: 926040c1a94044058f807e6a098e50ed56a7ebb8 -->

# Post-pre-ship test-coverage re-audit — app-snappiness

**Range:** `ad642e1..926040c` (7 commits)

Commits in scope:

- `287bfcf` — pre-ship Gate 6 fix: useOptimisticMutation unmount-cleanup useEffect
- `b8bc7db` — review.md + hero/qa-walk artifacts (no source)
- `f7adb4a` — `html { background-color }` route-flash fix (CSS only)
- `b9d8040` — AddItemSheet auto-close on banner truthy + AddItemSheet.test assertion update + mark-bought-feel.spec items query fix
- `63370b8` — ListClient `handleSubmissionBanner` wrap + mark-bought 200ms cleanup defer + add-item-banner.spec timeout bump
- `7aa7857` — purchase_history brand-filter fix in mark-bought-feel.spec (test-only)
- `926040c` — BUILD-LOG/PLAN bookkeeping (no source)

## Findings

### High severity

(none)

### Medium severity

- **`packages/ui/src/useOptimisticMutation.test.ts` — no test for the unmount-cleanup useEffect.** Commit `287bfcf` added the cleanup effect at `useOptimisticMutation.ts:220-224` to cancel pending retry timers on unmount. The test file has no `unmount()` test that fires `run()` in banner-mode, unmounts mid-backoff, advances timers past the next scheduled retry, and asserts that `mutate` was NOT called for that retry attempt. Recommended assertion (using `renderHook`'s `unmount` + fake timers): `unmount(); await vi.advanceTimersByTimeAsync(1000); expect(mutate).toHaveBeenCalledTimes(1);`. Why medium: the fix is small and the failure mode is bounded (React 18+ silently no-ops setState on unmount; the bigger risk is the surprise `mutate()` invocation, which IS user-visible — could double-insert if the consumer remounts). The pre-ship audit dismissed this without adding the test (`review.md:163`, "Fix … `useEffect(() => () => clearTimer(), [clearTimer])`"); flagging here as test-debt to surface.

- **`apps/web/components/ListClient.test.tsx` — no test for `handleSubmissionBanner` wrap (commit `63370b8`).** The new wrap at `ListClient.tsx:143-160` is load-bearing orchestration: when the AddItemSheet's hook unmounts after auto-close (b9d8040), the banner's Undo/Dismiss callbacks must hit the parent's `setSubmissionBanner(null)` because the hook's own `setBanner(null)` is a no-op on a torn-down component. No unit test exercises the wrapped Undo or Dismiss callback. Coverage is currently transitive via `add-item-banner.spec.ts` (E2E asserts banner hides after Undo click). Recommended assertion: a render test that simulates `onSubmissionBanner` being called with a non-null banner, then invokes the wrapped `undo()` and asserts the page-level banner DOM is removed. Why medium: single-spec E2E coverage is acceptable per the prompt's "if the spec is robust" rule, and `add-item-banner.spec.ts` IS robust (full retry + undo flow). But the unit test would catch wrap-regression in <100ms vs the E2E's ~25s, so it's high-value test-debt.

- **`apps/web/components/AddItemSheet.test.tsx` — auto-close-on-banner not pinned.** Commit `b9d8040` added the auto-close `useEffect` at `AddItemSheet.tsx:176-178`. The existing test ("network error keeps the sheet open through the first attempt") only pins the negative case (no auto-close on first failure). No test pins "submission.banner truthy → onClose() called." Coverage is transitive via `add-item-banner.spec.ts` (E2E asserts the banner's Undo is clickable, which only works if the sheet auto-closed and the backdrop went away). Recommended: a unit test that injects a hard-error rejection (status: 422) so the banner surfaces on the first attempt without waiting through retries, and asserts `onClose` was called once. Why medium: same rationale as above — single-robust-spec coverage is OK, but the unit test is cheap and the auto-close is the load-bearing UX behavior of the entire commit.

- **`apps/web/components/DisambiguationSheet.tsx` — no auto-close-on-banner symmetry with AddItemSheet, no test of either side.** Both sheets share the same z-30 backdrop overlay shape (`DisambiguationSheet.tsx:225-232`), the same Tier A2 banner-mode hook, and route through the same `handleSubmissionBanner` wrap in ListClient. AddItemSheet got the auto-close fix (b9d8040); DisambiguationSheet did not. If a user pick on the disambig sheet exhausts retries, the banner appears at the page level but the disambig sheet's backdrop will intercept Retry/Undo — same Playwright failure mode that triggered the AddItemSheet fix. This is a code-symmetry gap that a parallel E2E test (or the missing AddItemSheet auto-close unit test, generalized) would have caught. Why medium: this is more a behavior gap surfaced by the test-coverage gap than a pure test issue; flagging because the test-review skill's invariant ("API wrapper / surface paired with E2E") would have caught it. No DisambiguationSheet-failure E2E exists.

### Low severity

- f7adb4a is pure CSS with no test pair; no visual snapshot tests exist in the repo, so nothing to break and nothing reasonable to add.
- b9d8040 widened the AddItemSheet test description from "DOES NOT close" to "keeps the sheet open through the first attempt" — semantic narrowing is correct (post-fix the sheet DOES close once the banner surfaces). The kept assertion (`onClose not called` after one user.click cycle) is still load-bearing.
- 63370b8's mark-bought 200ms defer is transitively tested: ListClient.test.tsx uses `waitFor` (1000ms default) for row-removal assertion, which absorbs the 200ms; mark-bought-feel.spec.ts polls opacity-50 with a 1s window, which is the whole point of the defer. No assertion is now obsolete.
- 7aa7857 + the b9d8040 portion of the items query fix are test-only changes with no source pair needed.

---

findings: high=0, medium=4, low=4
