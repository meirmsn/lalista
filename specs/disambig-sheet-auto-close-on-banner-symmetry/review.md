<!-- audited-at: 93ca7f041424f9655eb65dd667d29e9e2ebb32b8 -->

# Review — disambig-sheet-auto-close-on-banner-symmetry

Pre-ship audit trail. See `kit/docs/guide/conventions.md § Pre-ship` for the gate
contract. Phase 5.8's idempotence check reads the latest `<!-- audited-at: <SHA> -->`
stamp at line 1.

## Router Summary

| Gate                      | Result            | Dismissals | Adversarial review |
| ------------------------- | ----------------- | ---------- | ------------------ |
| `preflight`               | pass (with note)  | None       | skipped            |
| `docs-check` (ak)         | n/a (no kit/docs) | None       | skipped            |
| `metrics-check` (ak)      | pass              | None       | skipped            |
| `rls-coverage` (ak)       | pass              | None       | skipped            |
| `slow-job-lifecycle` (ak) | pass              | None       | skipped            |
| `responsive-theme` (ak)   | n/a               | None       | skipped            |
| `simplify`                | pass              | None       | skipped            |
| `docs-and-tests-review`   | pass (Audit 1)    | None       | skipped            |
| `review`                  | pass              | None       | skipped            |
| `cso`                     | pass              | None       | skipped            |
| `design-review`           | n/a               | None       | skipped            |
| `design-conformance` (ak) | pass              | None       | skipped            |
| `qa`                      | n/a               | None       | skipped            |
| `benchmark`               | n/a               | None       | skipped            |
| `convention` (ak)         | pass              | None       | skipped            |

**Total dismissed findings**: 0 (0 LLM-reviewed, 0 shim-mapped, 0 rejected).

**Counts**: passed=8, findings_pending=0, n_a=6, blocked=0.

## Preflight

Tooling check.

- gh auth status: ok (account meirmsn).
- Chromium: ok (`/home/node/.cache/ms-playwright/chromium-1208/chrome-linux/chrome`, v147.0.7727.101).
- Local Supabase: bootstrap reused running stack but the auth service is in a degraded state ("Database error querying schema" 500 on `/auth/v1/token`, items count = 0 — pre-existing local-stack drift, not caused by this PR). Stop / start / db-reset cycle did not recover. This is documented under Gate 9's `n/a` rationale; the bootstrap state does not block any gate that this PR's diff actually exercises.

Outcome: `pass (with note)` — Chromium + gh ready; Supabase degradation is informational only since this PR has no QA happy-path to walk.

## Dismissals

None

## Gate 1: docs-check

PR does not touch `kit/`, `kit/docs/`, or any reference doc set tracked under that gate.
`git diff --name-only origin/main...HEAD` shows only `PLAN.md`, `apps/web/components/DisambiguationSheet*`, and `specs/disambig-sheet-auto-close-on-banner-symmetry/{spec,tasks}.md`.

Outcome: `n/a (no kit/docs change)`.

## Dismissals

None

## Gate 2: metrics-check

PR touches user-facing UI (`apps/web/components/DisambiguationSheet.tsx`). Per spec § Decisions D4 + § Metrics, no new `posthog.capture` calls are added. The existing analytics in `DisambiguationSheet.tsx` (`trackDisambiguationShown`, `trackStoreRouted`, `trackItemAdded`) are unchanged. No `METRICS.md` edit needed.

Outcome: `pass`.

## Dismissals

None

## Gate 2b: rls-coverage

`bash /devshop/kit/scripts/preship/rls-coverage-check.sh /workspace` → `pass`.

Outcome: `pass`.

## Dismissals

None

## Gate 2c: slow-job-lifecycle

`bash /devshop/kit/scripts/preship/slow-job-lifecycle-check.sh /workspace` → `pass`.

Outcome: `pass`.

## Dismissals

None

## Gate 3: responsive-theme

The change is a `useEffect` that fires `onClose()` after the retry budget exhausts. The disambig sheet's _visible appearance_ is identical pre/post — the only state change is _when_ the parent unmounts the sheet (after a hard 4-attempt failure on `invokeAddItem`, taking ~11s). Capturing 4 viewport/theme combos of an unchanged sheet would not produce evidence of a visual regression because there is no visual delta to measure.

Per the user's pre-ship preamble: "no visible UI changes (sheet just closes earlier on hard failure). Visual regression should be zero. Best-effort capture is sufficient; if appearance is unchanged, this can be skipped or marked `n/a` with a one-line note."

Outcome: `n/a (no visible UI change — the new useEffect modifies effect ordering and unmount timing on a hard failure path; the rendered DOM at any given pre-failure moment is unchanged)`.

## Dismissals

None

## Gate 4: simplify

Reviewed the diff vs `origin/main` for `apps/web/components/DisambiguationSheet.tsx` + `DisambiguationSheet.test.tsx`.

- **Code reuse**: the new `useEffect` is the literal symmetry pattern that is the spec's intent (D1) — mirrors `AddItemSheet.tsx:169-178` byte-for-byte. Hook abstraction would be premature for a 2-call surface.
- **Code quality**: comment is justified WHY (z-30 backdrop interception + PR #49 reference); deps `[submission.banner, onClose]` correct; nested `describe` for fake timers cleanly scoped with before/after.
- **Efficiency**: no hot-path bloat; effect only fires on `submission.banner` transition. `advanceTimersByTimeAsync` used correctly.

`pnpm turbo run test:unit` → 252/252 passed (post-gate checkpoint).

Outcome: `pass` (no fixes applied — code already clean).

## Dismissals

None

## Gate 5: docs-and-tests-review

Orchestrator computed `audit_n=1`, range `origin/main..HEAD`. Sub-skills:

- `/ak-docs-review`: Clean — no docs findings. (All four sections — coverage / adequacy / coherence / bypass — passed. No reference docs in the diff; CLAUDE.md gotcha update was explicitly waived in spec D4.)
- `/ak-tests-review`: Tests look solid — no findings. (New nested `describe` block exercises the new auto-close branch with fake timers; weak-assertion check passed; no skip/only patterns; no API-wrapper changes; existing tests untouched and still on real timers.)

Audit 1 section appended below with `<!-- audited-at: 93ca7f0... -->` stamp.

Outcome: `pass` (high=0, medium=0, low=0).

## Dismissals

None

## Gate 6: review

Pre-landing review of the diff. Verified true symmetry with `AddItemSheet.tsx:176-178` (the new useEffect is byte-for-byte equivalent, placed after the hoist effect with the same comment shape). Adversarial pass considered:

- Banner transitions while `open=false` → `onClose()` is a no-op on closed parent; not a bug.
- `onClose` identity-instability → could cause repeated `onClose` calls during banner display, but parent's `onClose` is idempotent (already-closed sheet stays closed). AddItemSheet has the exact same shape and shipped without issue in PR #49.
- Future React effect-ordering changes → source-order is the React contract.

`pnpm turbo run test:unit` → 252/252 passed (post-gate checkpoint).

Outcome: `pass` (0 critical, 0 informational findings).

## Dismissals

None

## Gate 7: cso

Daily mode (8/10 confidence gate), `--diff` semantics (scoped to the current branch's diff vs `origin/main`).

Phase 1 net attack surface delta: 0 endpoints, 0 webhooks, 0 secrets, 0 LLM calls, 0 CI/workflow changes, 0 dependency changes. The diff modifies 1 React component (`DisambiguationSheet.tsx`) + 1 test file. Phases 2–11 each evaluated and produced 0 candidates.

Outcome: `pass` (0 findings, candidates_scanned=0, reported=0).

No code changes — no test:unit checkpoint required.

## Dismissals

None

## Gate 8: design-review

UI PR by file scope, but the change is a behavioral effect — the rendered DOM at any pre-failure moment is unchanged. `useEffect` fires `onClose()` after a hard 4-attempt retry exhaustion; the visible appearance of the disambig sheet, its options, the Confirm button, the backdrop, and the typography are all unchanged. There is no visual axis for `/design-review` to audit on this PR.

Per the user's pre-ship preamble, this disposition is explicitly authorized for surfaces where "the change is internal UI behavior — no visible UI changes."

Outcome: `n/a (no visible UI change — pure effect-ordering / unmount-timing fix on a failure path; visual regression is zero by construction)`.

## Dismissals

None

## Gate 8b: design-conformance

`bash /devshop/kit/scripts/preship/design-conformance.sh run --feature disambig-sheet-auto-close-on-banner-symmetry --design /workspace/DESIGN.md` → 0 claims to verify against the diff. Report at `specs/disambig-sheet-auto-close-on-banner-symmetry/design-conformance-report.md` shows `pass` outcome.

Outcome: `pass`.

## Dismissals

None

## Gate 9: qa

The PR's only behavior change is a failure-path mechanic: `useEffect` calls `onClose()` after the retry budget exhausts (4 attempts at 1s, 3s, 7s backoff = ~11s of failing `invokeAddItem` calls). There is no happy-path UI walk that exercises this — by definition, it only fires on a sustained edge-function failure that real users never encounter on a healthy stack.

Spec § Decisions D3 explicitly chose unit test over E2E: "the existing `add-item-banner.spec.ts` E2E spec exercises the AddItemSheet variant of this exact failure path end-to-end." The new behavior is pinned by a focused unit test in `DisambiguationSheet.test.tsx` that drives the [1s, 3s, 7s] backoff to exhaustion with `vi.useFakeTimers()` and asserts `onClose` fires after `submission.banner` becomes non-null.

Local Supabase auth is also in a degraded "Database error querying schema" state on this devcontainer — but even on a healthy stack, walking this PR's behavior would require deliberate edge-function failure injection, which is what the unit test already does.

Per the user's pre-ship preamble, this disposition is authorized for this PR.

Outcome: `n/a (failure-path mechanic verified by focused unit test per spec D3; no happy-path UI walk applies; the existing add-item-banner E2E covers the AddItemSheet variant of the same useOptimisticMutation + SyncErrorBanner machinery)`.

## Dismissals

None

## Gate 10: benchmark

The diff adds one `useEffect` whose body is `if (submission.banner) onClose();` — fires only on a state transition. Zero hot-path overhead, zero bundle-size delta (no new imports in `DisambiguationSheet.tsx`; the test file adds two imports from a package that was already a direct dep).

Outcome: `n/a (no measurable perf delta — single useEffect on rare state transition; no bundle-size delta)`.

## Dismissals

None

## Gate 11: convention

- File-headers check: `bash /devshop/kit/scripts/commit-hooks/check-file-headers.sh main` → clean.
- Both `DisambiguationSheet.tsx` and `DisambiguationSheet.test.tsx` already carry `// What: / // Why: / // Does NOT:` headers (modified files; no new file added).
- No new migrations in diff.
- No new `subscribeTo<X>` helper or `postgres_changes` listener.
- PLAN.md table updated with the active branch + spec link + notes.
- No completed roadmap items left in `PRODUCT-ROADMAP.md` or `kit/ROADMAP.md` (this PR doesn't ship a roadmap-tracked item; it's a follow-on symmetry fix to PR #49).

Outcome: `pass`.

## Dismissals

None

## Audit 1: pre-polish (2026-05-06)

<!-- audited-at: 93ca7f041424f9655eb65dd667d29e9e2ebb32b8 -->
<!-- range: origin/main..HEAD -->

findings: high=0 medium=0 low=0

### Docs findings

- (none)

### Tests findings

- (none)

### Bypass trailer audit

- (none)

## Audit 2: post-polish (2026-05-06)

<!-- audited-at: 164c41a55bc43848e51a0b328c9498d2334c23e3 -->
<!-- range: 93ca7f041424f9655eb65dd667d29e9e2ebb32b8..HEAD -->

findings: high=0 medium=0 low=0

### Docs findings

- (none)

### Tests findings

- (none)

### Bypass trailer audit

- (none)
