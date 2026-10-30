<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: disambig-sheet-auto-close-on-banner-symmetry -->
<!-- date: 2026-05-06 -->

# Spec: disambig-sheet-auto-close-on-banner-symmetry (fix)

**Sources:**

- PR #49 (`feat(app-snappiness): 4-tier latency feedback framework + primitives`) — added the auto-close-on-banner effect to AddItemSheet.tsx:169–178 to unblock SyncErrorBanner Retry/Undo behind the sheet's `z-30` backdrop. The same effect was missed for DisambiguationSheet despite it sharing the Tier A2 banner slot (D10 in app-snappiness/spec.md).
- `apps/web/components/AddItemSheet.tsx` — current pattern (the one to mirror).
- `apps/web/components/DisambiguationSheet.tsx` — target (currently missing the effect).
- `CLAUDE.md § Latency feedback tiers` — both sheets are documented as Tier A2 sharing one banner slot in `ListClient`.

Symmetry fix: bring DisambiguationSheet's banner-escalation behavior in line with AddItemSheet's, so a hard-failure on a disambiguation pick auto-closes the sheet — preventing its `z-30` backdrop overlay from intercepting Retry/Undo clicks on the parent's SyncErrorBanner.

---

## Decisions (resolved at spec time)

Four decisions resolved in Phase 0 with the user. Recorded below so Phase 1 preserves them verbatim and a crashed Phase 1 resumes without re-asking.

### D1: Which surface gets the auto-close effect

**Decision:** DisambiguationSheet only — port the exact `useEffect(() => { if (submission.banner) onClose(); }, [submission.banner, onClose])` block from AddItemSheet.tsx:169–178.

**Rationale:** Pure symmetry fix. AddItemSheet already shipped the pattern in PR #49 to unblock SyncErrorBanner Retry/Undo behind the `z-30` backdrop. DisambiguationSheet has the same `z-30` backdrop, the same Tier A2 banner shape, and the same parent SyncErrorBanner consumer — every reason that motivated the AddItemSheet fix applies identically to DisambiguationSheet.

### D2: Effect ordering relative to the existing banner-hoist effect

**Decision:** Place the new auto-close effect AFTER the existing banner-hoist effect (lines 142–148). Mirror AddItemSheet's order exactly.

**Rationale:** The banner-hoist effect must push `submission.banner` to the parent BEFORE the sheet unmounts, otherwise the parent's `SyncErrorBanner` slot stays empty after auto-close and the user gets no Retry/Undo affordance. AddItemSheet's order (hoist effect → auto-close effect) is the proven pattern; React batches both effects after a single banner-state transition, but the queue order matches the source order, so hoist runs first by construction.

### D3: Test coverage for the new behavior

**Decision:** Add one focused unit test to `DisambiguationSheet.test.tsx` that drives the retry budget to exhaustion (fake timers advancing through the `[1s, 3s, 7s]` backoff) and asserts `onClose` fires once `submission.banner` becomes non-null. No new E2E spec.

**Rationale:** The existing `add-item-banner.spec.ts` E2E spec exercises the AddItemSheet variant of this exact failure path end-to-end; adding a parallel disambig E2E spec would cost ~25s of CI budget for the same banner-mechanics it already covers. The unit test pins the disambig-specific code branch and is sufficient. A future "disambig-banner" E2E spec is a nice-to-have but not part of this PR's scope.

### D4: CLAUDE.md gotcha update

**Decision:** No update needed.

**Rationale:** The existing § Latency feedback tiers gotcha already documents both surfaces sharing one banner slot. This fix doesn't add a new contract — it brings DisambiguationSheet in line with the documented pattern. The gotcha would only need an update if we were introducing a NEW banner-coordination rule, which we are not.

---

<!-- /ak-spec (Phase 1) expands the file from here: In scope, Screens, Data
     model changes, API contracts, Offline behavior, Metrics, Files to
     create/modify, Tests, Dependencies, Task order, Gotchas, Acceptance /
     rollout / rollback. The Decisions section above stays verbatim. -->

## In scope

Port AddItemSheet's auto-close-on-banner effect (PR #49 / `apps/web/components/AddItemSheet.tsx:169-178`) into `DisambiguationSheet.tsx`, so a hard failure on a disambiguation pick auto-closes the sheet once the parent's `SyncErrorBanner` slot fills. This is a pure UI symmetry fix: it prevents the sheet's `z-30` backdrop from intercepting Retry/Undo clicks on the parent banner, restoring the same Tier A2 affordance both sheets are documented to share. Adds one focused unit test pinning the new behavior with fake timers.

## Out of scope

- A parallel disambig-banner E2E spec (D3 — covered transitively by the existing `apps/web/e2e/add-item-banner.spec.ts`, since both sheets feed the same `useOptimisticMutation` + `SyncErrorBanner` machinery).
- CLAUDE.md updates (D4 — the existing § Latency feedback tiers gotcha already documents both surfaces sharing one banner slot).
- Any change to the banner-hoist effect (lines 142-148), `useOptimisticMutation` configuration, or `ListClient`'s banner consumer.
- Any change to AddItemSheet — its existing pattern is the source of truth and stays put.
- Migrations, edge functions, new packages, new metrics events.

## Screens

List view (`apps/web/app/list/page.tsx` → `ListClient`) → `DisambiguationSheet` → parent's `SyncErrorBanner` (after auto-close).

Flow on hard failure:

1. User picks a candidate in the open `DisambiguationSheet` and clicks Confirm.
2. `useOptimisticMutation` runs the [1s, 3s, 7s] retry backoff against the failing `invokeAddItem` call.
3. After the final attempt rejects, `submission.banner` becomes non-null.
4. The banner-hoist effect (already shipped) pushes that banner up to `ListClient` via `onSubmissionBanner(submission.banner)`.
5. The new auto-close effect (this PR) calls `onClose()` immediately after.
6. Sheet unmounts; `SyncErrorBanner` is the topmost interactive surface; Retry/Undo are clickable.

No visual layout changes. No new screens, no new copy.

## Data model changes

None.

## API contracts

None — this is a pure UI affordance fix. No edge-function, RPC, or wrapper signature changes.

## Offline behavior

Unchanged. Offline failures already surface through Tier A2 (the same `useOptimisticMutation` `failureMode: 'banner'` path) — this fix just unblocks the banner's interactive controls when the failure originates from a disambiguation pick.

## Metrics

No new events. The existing `disambiguation_shown` and `item_added` events (captured in `DisambiguationSheet.tsx`) are unchanged. METRICS.md needs no edit (D4 already established this).

## Files to create/modify

| Path                                               | Change | Notes                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/DisambiguationSheet.tsx`      | modify | Add ~10-line `useEffect` block + comment AFTER the existing banner-hoist effect (lines 142-148, before the early-return on line 150). Mirror `AddItemSheet.tsx:169-178` exactly. Comment must reference PR #49 the same way AddItemSheet's does.                       |
| `apps/web/components/DisambiguationSheet.test.tsx` | modify | Add one ~30-line test that exhausts the [1s, 3s, 7s] retry budget with fake timers and asserts `onClose` fires once `submission.banner` is non-null. Mirror the shape of "keeps the sheet open on a network error" (lines 296-310) but advance past `RETRY_BUDGET_MS`. |

No new files. No deletions.

## Tests

### Unit (in scope this PR)

- New test in `apps/web/components/DisambiguationSheet.test.tsx`: drives a 4-attempt rejection sequence through the [1s, 3s, 7s] backoff with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)`, then asserts `p.onClose` was called once and `p.onSubmissionBanner` was called with a non-null banner. Mirror the import + setup style of the existing "keeps the sheet open on a network error" test (`DisambiguationSheet.test.tsx:296-310`); reference `packages/ui/src/useOptimisticMutation.test.ts:112-162` for the canonical fake-timer + `act()` pattern.
- Existing tests stay green — the new effect only fires when `submission.banner` transitions to non-null, which happens AFTER the retry budget is exhausted. No existing test in this file advances the retry timer, so none of them touch the new branch.

### E2E (out of scope this PR)

NONE added in this PR (D3). The existing `apps/web/e2e/add-item-banner.spec.ts` covers AddItemSheet's variant of this exact failure path end-to-end; the disambig variant relies on the same `useOptimisticMutation` + `SyncErrorBanner` machinery, so unit-level coverage is sufficient. A future "disambig-banner" E2E spec is a `PRODUCT-ROADMAP.md`-grade nice-to-have, not a blocker.

### CLAUDE.md `E2E-per-surface` invariant

This PR does not add a new page or a new API wrapper, so the `E2E-per-surface` invariant (CLAUDE.md § Testing) does not require a new E2E spec. The disambig surface itself is already covered by `apps/web/e2e/disambiguation.spec.ts`; the failure-path mechanics are covered by `apps/web/e2e/add-item-banner.spec.ts`. `/ak-test-review` should not flag this PR.

## Dependencies

None. No migrations, no edge-function changes, no new packages, no env-var changes, no `pnpm install` needed.

## Task order

1. **Implement the auto-close effect in `apps/web/components/DisambiguationSheet.tsx`** — mirror `AddItemSheet.tsx:169-178` exactly. Place the new `useEffect` block AFTER the existing banner-hoist effect (currently ending at line 148) and BEFORE the early-return on line 150. Comment must reference PR #49 the same way AddItemSheet's does.
2. **Add the unit test in `apps/web/components/DisambiguationSheet.test.tsx`** — pin the new branch with fake timers, asserting `onClose` fires after the retry budget is exhausted.

Both tasks land in a single commit on `fix/disambig-sheet-auto-close-on-banner-symmetry`. `pnpm turbo run test:unit` is the local validation gate.

## Gotchas

- **Effect ordering is load-bearing**: the existing banner-hoist effect (`DisambiguationSheet.tsx:142-148`) MUST run BEFORE the new auto-close effect — React processes effects in source order, and if the auto-close fires first, the sheet unmounts before `onSubmissionBannerRef.current(submission.banner)` runs, so the parent's banner slot stays empty and the user gets a stranded "something failed but no Retry/Undo anywhere" state. Mirror AddItemSheet's source order (lines 161-167 hoist → 176-178 auto-close) — that ordering is the proven shape and is what the symmetry fix means.
- **Fake-timer budget**: the retry sequence is `[1000, 3000, 7000]` ms (sum = 11000ms), and `RETRY_BUDGET_MS = 15000`. The unit test must advance past 11000ms total to reach the post-final-attempt state where `submission.banner` is non-null. Use `vi.advanceTimersByTimeAsync(...)` (not the sync variant) — the retry scheduler uses a real Promise chain. See `packages/ui/src/useOptimisticMutation.test.ts:121-162` for the exact shape.
- **Token values come from `packages/ui/src/tokens.ts`**: `RETRY_BUDGET_MS = 15000`, `RETRY_BACKOFF_MS = [1000, 3000, 7000]`. Don't hard-code different numbers in the test — import them or pin to the same delay sequence the hook uses.
- **The new effect should not regress the existing "keeps the sheet open on a network error" test** (line 296). That test only fires the first rejection and asserts `onClose` has NOT been called yet — it doesn't advance any timer past the first attempt, so it doesn't reach the new auto-close branch. No change needed there.
- **The auto-close calls `onClose` directly** (not through a ref), exactly like AddItemSheet. Stale-closure concerns are handled by listing `onClose` in the dependency array — same as AddItemSheet's `[submission.banner, onClose]`.

## Acceptance

- A hard failure on a disambiguation pick (4-attempt rejection sequence exhausting [1s, 3s, 7s] backoff) auto-closes the `DisambiguationSheet`.
- The parent `SyncErrorBanner` (rendered from `ListClient`) appears with Retry and Undo controls.
- Both Retry and Undo are clickable — no `z-30` backdrop intercept.
- Unit test in `DisambiguationSheet.test.tsx` asserts `onClose` was called and `onSubmissionBanner` received a non-null banner.
- All existing `DisambiguationSheet.test.tsx` tests stay green.

## Rollout

Ships with the next deploy (Vercel auto-deploy on merge to `main`). No feature flag — the change is a pure UI affordance fix on a path that previously had no Retry/Undo affordance at all (banner present but click-blocked); flagging would only delay the fix without protecting any prior behavior.

## Rollback

`git revert` the implementation commit. No data migration to unwind, no edge-function redeploy, no env-var change. The sheet returns to its pre-fix behavior (banner present but Retry/Undo intercepted by the backdrop) — annoying but not broken in any data-integrity sense.
