<!-- generated-by: /devshop:implement (Phase 2) -->
<!-- feature: disambig-sheet-auto-close-on-banner-symmetry -->

# Tasks: disambig-sheet-auto-close-on-banner-symmetry

Per the spec's `## Task order` section, both tasks land in **one** commit
on `fix/disambig-sheet-auto-close-on-banner-symmetry`. `pnpm turbo run
test:unit` is the local validation gate.

| #   | Task                                                                                                                                                                                                                                                                                                                                  | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Add the auto-close `useEffect` in `apps/web/components/DisambiguationSheet.tsx` AFTER the existing banner-hoist effect (lines 146-148) and BEFORE the early-return on line 150. Mirror `AddItemSheet.tsx:169-178` verbatim — comment must reference PR #49 the same way.                                                              | done   |
| 2   | Add one focused unit test in `apps/web/components/DisambiguationSheet.test.tsx` that drives the [1s, 3s, 7s] retry budget to exhaustion with fake timers and asserts `onClose` fires after `submission.banner` becomes non-null. Nested describe block to scope `vi.useFakeTimers()` so it doesn't leak into other tests in the file. | done   |

Both tasks shipped in commit:

> `fix(disambig-sheet): auto-close on Tier A2 banner escalation (parity with AddItemSheet PR #49)`

## Validation

- `pnpm turbo run test:unit` — 252/252 passed (DisambiguationSheet now has 18 tests; the new one passes alongside the original 17).
- `pnpm turbo run typecheck` — clean across `@lalista/core`, `@lalista/ui`, `@lalista/web`.
- `pnpm turbo run lint` — clean.

## Decisions

One judgment call surfaced during implementation, captured here for the audit trail:

### D-impl-1: `fireEvent` instead of `userEvent` inside the fake-timer test

**Decision:** Use `@testing-library/react`'s `fireEvent.click` (synchronous) for the radio + Confirm clicks inside the new fake-timer test, instead of `userEvent.setup({ advanceTimers })` (async).

**Rationale:** First implementation used `userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })` and the test deadlocked at the 5s vitest default timeout — `userEvent`'s async event scheduling does not reliably interoperate with vitest's `vi.useFakeTimers()` even with `advanceTimers` wired. Switching to `fireEvent` matches the canonical pattern already in use in this repo for fake-timer tests (`apps/web/components/AwaitingConfirmationCard.test.tsx`, `apps/web/components/ConfirmationToast.test.tsx`) and made the test pass in ~30ms with no flakiness. The other tests in `DisambiguationSheet.test.tsx` keep using `userEvent` because they run on real timers — the fake-timer scope is contained in a nested `describe` block with its own `beforeEach`/`afterEach`, so existing tests are unaffected.

**Trade-off accepted:** `fireEvent` skips a couple of pointer-event lifecycle steps that `userEvent` simulates (mouseover, focus). Acceptable here because the test is asserting the post-mutation banner-escalation behavior, not pointer-event semantics; the radio + Confirm click handlers don't read any of the events `fireEvent` skips.

No other judgment calls. Effect placement, comment wording, retry-budget math, and test-file location all followed the spec verbatim.
