<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: app-snappiness -->
<!-- date: 2026-05-05 -->

# Spec: app-snappiness (PR N)

**Branched off:** `origin/main` at `875a73e` (chore/lalista-store-cutover merged via PR #45 between Phase 0's start and the user's "proceed").

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1m` — primary scope (App-wide snappiness)
- `BUILD-LOG.md § auth-ux-rework (2026-05-02, #43)` — chapter 1l, source of `AuthSubmitButton` being lifted
- `apps/web/components/AuthSubmitButton.tsx` — pattern this PR generalizes
- `apps/web/components/SyncErrorBanner.tsx` — pre-existing cross-screen banner this PR extends with retry/undo
- `DESIGN.md` — token surface for new motion/feedback tokens
- Conversation 2026-05-05 — user pushed back on the roadmap's uniform "adopt SubmitButton everywhere" framing; co-developed the 4-tier framework below as the right shape

App-wide tap-feedback generalization. Replaces the roadmap's uniform "adopt SubmitButton everywhere" framing with a **4-tier latency-feedback framework** that matches the affordance to the operation's actual latency and to whether we have local state to commit optimistically. Same components ship (`SubmitButton`, `LoadingArea`), plus a new `useOptimisticMutation` hook for in-app mutations. The framework itself gets codified into `CLAUDE.md` + `DESIGN.md` so future lalista work inherits it; lift to `@devshop-template/ui` is deferred per the established "ship inline → soak → extract" pattern.

---

## Decisions (resolved at spec time)

15 decisions resolved with the user in Phase 0 (conversation 2026-05-05). Recorded below verbatim so Phase 1 preserves them and a crashed Phase 1 resumes without re-asking.

### D1: 4-tier latency-feedback framework + canonical surface mapping

**Decision:** Match affordance to operation latency + whether we have local state to commit optimistically + whether failure needs cross-screen visibility.

| Tier                                  | When                                                                                              | Affordance                                                   | Failure                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **A1 — Benign optimistic**            | Mutation usually succeeds; rollback is self-explanatory in context; user stays on the same screen | Visual change instant; no spinner, no disable                | Silent rollback (reverted state IS the message)                        |
| **A2 — Banner-on-failure optimistic** | Mutation usually succeeds, but failure could be missed if user navigates; loss matters            | Visual change instant; retry ~15s in background              | `SyncErrorBanner` cross-screen ("Couldn't save 'milk' — retry / undo") |
| **B — Threshold spinner (250ms)**     | User waiting on network round-trip with no local state to commit; action gates further progress   | Instant disable + spinner-after-250ms                        | Inline error                                                           |
| **C — Route loading**                 | Tapping a link to a different page                                                                | Page chrome paints; content area soft-pulses (`LoadingArea`) | `error.tsx`                                                            |
| **D — CSS press only**                | <100ms ops, or no observable result                                                               | OS / `:active`                                               | n/a                                                                    |

Canonical surface mapping (every interactive surface in the app):

| Surface                                                      | Tier | Notes                                                                     |
| ------------------------------------------------------------ | ---- | ------------------------------------------------------------------------- |
| `/sign-in` submit                                            | B    | `SubmitButton`                                                            |
| `/sign-up` submit                                            | B    | `SubmitButton`                                                            |
| `/forgot-password` submit                                    | B    | `SubmitButton`                                                            |
| `/reset-password` submit                                     | B    | `SubmitButton`                                                            |
| `AwaitingConfirmationCard` resend                            | B    | `SubmitButton`                                                            |
| `SignOutButton` (Settings)                                   | B    | `SubmitButton`, post-success label "Signing out…"                         |
| `AddItemSheet` "Add"                                         | A2   | `useOptimisticMutation({ failureMode: 'banner' })`                        |
| `AddItemSheet` force-create "Add as new"                     | A2   | Same flow, shares banner                                                  |
| `DisambiguationSheet` option pick                            | A2   | Sheet dismisses optimistically; banner inherits from AddItem flow         |
| `ListRow` mark-bought                                        | A1   | `useOptimisticMutation({ failureMode: 'rollback' })`; realtime reconciles |
| `DisplayNameField` save                                      | A1   | Inline error on the field; user is right there                            |
| Tap `/list`, `/item/[id]`, `/settings`, `/(auth)/onboarding` | C    | `loading.tsx` + `LoadingArea`                                             |
| Theme toggle, sheet open/close, section collapse             | D    | CSS only                                                                  |

**Rationale:** The roadmap's "adopt SubmitButton everywhere" framing was uniform but wrong — spinners on actions completing in <300ms add visual noise without information; for in-app mutations the user has the rest of the list to look at, so committing the change visually says "heard you" better than a spinner does. The framework also handles the "I navigated away and the rollback fired silently" failure mode the user surfaced, by splitting Tier A into A1 (benign) and A2 (banner-on-failure).

### D2: Architecture — 3 primitives in `packages/ui`, no generic `TapFeedback` wrapper

**Decision:** New in `packages/ui/src/`:

- `useSubmitFeedback.ts` — hook with the 250ms threshold timer + success-state machine (Tier B internals)
- `SubmitButton.tsx` — Tier B component, lifted from `apps/web/components/AuthSubmitButton.tsx`
- `LoadingArea.tsx` — Tier C empty-container primitive
- `useOptimisticMutation.ts` — hook with `failureMode: 'rollback' | 'banner'`; encapsulates Tier A1+A2 mechanics including retry budget

Drop the earlier idea of a generic `TapFeedback` presentational wrapper — Tier A surfaces don't need a feedback component, they need optimistic state updates inside the existing handlers. The hooks are the reusable surface; the components are thin.

**Rationale:** Hooks separate timing/retry logic from presentation, so future surfaces in either web (this codebase) or native (future SwiftUI rewrite) can implement their own primitives obeying the same framework without inheriting React-specific component code. Keeps the "framework portable, primitives platform-specific" boundary clean.

### D3: Loading-area animation

**Decision:** Tailwind's `animate-pulse` on `bg-muted/40` (or token-equivalent). No content-shaped placeholder bars, no shimmer, no spinner.

**Rationale:** Roadmap recommendation. Matches lalista's voice (quieter than wireframe skeletons). Design review during pre-ship can swap to a custom hue-shift if pulse feels too utilitarian.

### D4: Auth screens get `loading.tsx`?

**Decision:** No. Only `list`, `item/[id]`, `settings`, `(auth)/onboarding` get `loading.tsx`.

**Rationale:** Auth screens are already snappy via `SubmitButton`; adding `loading.tsx` would add flicker on `/auth/callback` redirects that arrive with a session already created, and would conflict with the post-magic-link-exchange redirect flow. Roadmap explicitly scopes `loading.tsx` to the four authed screens.

### D5: Delete `AuthSubmitButton` after lift, no shim

**Decision:** Delete `apps/web/components/AuthSubmitButton.tsx` + `.test.tsx`. Update the 5 auth-screen imports (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `AwaitingConfirmationCard`) to import `SubmitButton` from `@lalista/ui` directly.

**Rationale:** Roadmap explicitly says "deleted." `CLAUDE.md` repo conventions tell us to avoid backwards-compat shims like re-export wrappers; a single PR that does the rename + the call-site updates is cleaner than a shim.

### D6: Test coverage strategy

**Decision:**

- Unit: `useSubmitFeedback` (250ms threshold timing + cleanup), `useOptimisticMutation` (rollback + banner + retry), `SubmitButton` post-success label, `LoadingArea` shape.
- E2E smoke: `LoadingArea` renders within 100ms of clicking `/settings` link (catches regressions if a future route forgets `loading.tsx`).
- E2E per-surface: `AddItemSheet` shows optimistic row + banner on simulated network failure (Playwright route interception); `ListRow` mark-bought feels instant + rollback on RPC error.

**Rationale:** Per spec § Tests. The route-loading invariant is structural — one E2E covers all four routes. The AddItem banner-on-network-failure path is the most complex new behavior and gets its own dedicated spec.

### D7: METRICS events

**Decision:** None added.

**Rationale:** Pure UX/timing change, no analytics impact. Per spec.

### D8: Connectivity behavior — Tier A2 retry shape

**Decision:** Optimistic commit → fire RPC in background → if network error, retry ×3 with backoff `[1000, 3000, 7000]ms` (15s total budget) → on success silent → on hard failure (retries exhausted OR 4xx/5xx server reject) surface via `SyncErrorBanner`.

`SyncErrorBanner` survives navigation because it's mounted in a layout above route changes (already true in the existing implementation; this PR confirms placement). Banner gains explicit "retry" and "undo" affordances in this PR.

**Rationale:** Bounded retry covers transient network blips silently (the common case for mobile-grocery use). Persistent banner is the cross-screen visibility mechanism for the "I added 'milk eggs bread', walked away, all 3 silently rolled back" failure mode the user surfaced. Reuses an existing component instead of inventing a new pattern.

### D9: Offline queue / IndexedDB sync engine

**Decision:** **Not in this PR.** Add a row to `PRODUCT-ROADMAP.md` for a future chapter — true offline-first means a sync engine (idempotency keys on the RPC, persistent queue across browser restarts, conflict resolution against realtime).

**Rationale:** v0 single-household + 15s retry budget covers common cases. IndexedDB queue is the right answer for "user is in a basement for 3 minutes" but it's a feature, not a polish pass. Scope discipline.

### D10: A1 vs A2 split — which surfaces get the banner

**Decision:** A2 (banner) for the AddItem family — `AddItemSheet` main, force-create, and `DisambiguationSheet` pick path (all share one banner since it's the same insert flow). A1 (rollback only) for `ListRow` mark-bought and `DisplayNameField` save.

**Rationale:** AddItem is the main app action and a silent rollback after navigation would lose user-spoken intent — banner is required. Mark-bought rollback is benign (item reappears, which is correct), and realtime reconciles automatically. DisplayName save failure self-corrects on next visit to /settings, and the field has its own inline error slot.

### D11: Codification this PR — three docs

**Decision:**

1. `CLAUDE.md § Gotchas` — new entry "Latency feedback tiers (A1/A2/B/C/D)" with the framework table from D1 + the canonical surface mapping + the decision rule. Future Claude sessions read this before adding any interactive surface.
2. `DESIGN.md` — new "Motion + feedback" section with tokens (D12) and the framework summary.
3. `PRODUCT-ROADMAP.md § Pattern lift candidates` — add row for post-soak devshop extraction (D11 + D12 deliverables).

**Rationale:** Per the user's question "is CLAUDE.md the only thing?" — no, the design system + the roadmap pattern-lift workflow are the other two layers. CLAUDE.md is for future Claude sessions; DESIGN.md is for human + Claude alike (feedback IS design); PRODUCT-ROADMAP.md is for the soak-then-extract workflow.

### D12: Motion + feedback tokens (DESIGN.md)

**Decision:**

- `FEEDBACK_THRESHOLD_MS = 250` — Tier B spinner threshold
- `RETRY_BUDGET_MS = 15000` — Tier A2 total retry window
- `RETRY_BACKOFF_MS = [1000, 3000, 7000]` — Tier A2 retry delays
- `LOADING_PULSE_OPACITY` — Tier C `animate-pulse` reference (Tailwind default unless design review tunes it)

Tokens live in `packages/ui/src/tokens.ts` (existing token surface) AND are documented in `DESIGN.md § Motion + feedback`.

**Rationale:** Feedback timing IS design system data — same surface as color and spacing tokens. Centralizing prevents drift if a future surface picks a different threshold by accident.

### D13: Devshop lift = deferred

**Decision:** Not in this PR. After 2-4 week soak in production, lift in a separate post-soak PR:

- Framework doc → `/devshop/template/CLAUDE.md` + `/devshop/kit/docs/guide/latency-feedback.md`
- Components + hooks → `@devshop-template/ui`
- (Maybe) a convention check rule that flags new `<button onClick={async ...}>` handlers not using one of the primitives

**Rationale:** Established `PRODUCT-ROADMAP.md § Pattern lift candidates` workflow: ship inline → soak → extract. Lifting before soak risks ossifying half-baked patterns. Same sequencing chapter 1l followed.

### D14: Native-version generalization

**Decision:** Framework (4 tiers + decision rule + canonical surface mapping) is platform-agnostic and reuses on native verbatim. Components/hooks are React-specific and do NOT lift to native — native gets its own primitives that obey the same tiers (SwiftUI `Button` + `Task.sleep` threshold for Tier B; SwiftUI `NavigationStack` placeholder for Tier C; `@State` optimistic updates for Tier A).

**Rationale:** "Framework portable, primitives platform-specific" is the right boundary — we don't want shared UI components across web and native, but the decision rule for which feedback to apply where is the same regardless of platform.

### D15: SyncErrorBanner gains retry + undo affordances

**Decision:** This PR extends `SyncErrorBanner` with explicit "retry" and "undo" buttons for Tier A2 failures. "Retry" re-fires the RPC. "Undo" calls the rollback handler the optimistic mutation registered.

**Rationale:** Without the affordances, the banner is just a notice — user has no clear next action. With them, it's the recovery surface for the connectivity failure mode.

---

## In scope

- New shared primitives in `@lalista/ui`:
  - `useSubmitFeedback` hook — encapsulates Tier B's 250ms-threshold spinner timer + cleanup state machine, lifted from `AuthSubmitButton`'s inline `useEffect` pattern.
  - `SubmitButton` component — Tier B affordance built on top of `useSubmitFeedback`. Replaces `AuthSubmitButton` 1:1 (same prop surface, same behavior, plus generalized for non-auth callers).
  - `LoadingArea` primitive — Tier C empty-container that paints `animate-pulse` over a `bg-muted/40` block. Used by every `loading.tsx`.
  - `useOptimisticMutation` hook — Tier A1 + A2 mechanics. Returns `{ run, isPending }`. Discriminated-union `failureMode: 'rollback' | 'banner'` selects between silent-rollback (A1) and `SyncErrorBanner` escalation (A2). A2 path runs the bounded retry shape from D8 (3 attempts, `[1s, 3s, 7s]` backoff, 15s total budget).
- Token additions in `packages/ui/src/tokens.ts` (D12):
  - `FEEDBACK_THRESHOLD_MS = 250`
  - `RETRY_BUDGET_MS = 15000`
  - `RETRY_BACKOFF_MS = [1000, 3000, 7000] as const`
- Tier C `loading.tsx` files for `/list`, `/item/[id]`, `/settings`, and `/(auth)/onboarding`.
- Tier B lift: 5 auth-screen call sites switch from `@/components/AuthSubmitButton` to `@lalista/ui`'s `SubmitButton`. `AuthSubmitButton.tsx` + `.test.tsx` get deleted with no shim (D5).
- Tier B new adoption: `SignOutButton` adopts `SubmitButton` with post-success label "Signing out…".
- Tier A2 adoption: `AddItemSheet` (main "Add" + force-create "Add as new") and `DisambiguationSheet` (option pick) all use `useOptimisticMutation({ failureMode: 'banner' })` and share a single `SyncErrorBanner` slot.
- Tier A1 adoption: `ListRow` mark-bought + `DisplayNameField` save use `useOptimisticMutation({ failureMode: 'rollback' })`.
- `SyncErrorBanner` extension (D15): adds explicit "retry" and "undo" affordances wired to the optimistic-mutation handler set, on top of the existing tap-to-retry / dismiss controls.
- E2E coverage updates (D6): one route-loading smoke test, one AddItem-banner-on-network-failure spec, one mark-bought-feels-instant spec, plus regression-pass for existing auth specs after the SubmitButton lift.
- Framework codification:
  - `CLAUDE.md § Gotchas` — new entry "Latency feedback tiers (A1/A2/B/C/D)" with the 4-tier table + canonical surface mapping + decision rule (D11).
  - `DESIGN.md` — new "Motion + feedback" section documenting the framework + the new tokens (D11/D12).
  - `PRODUCT-ROADMAP.md` — add a row under § Pattern lift candidates for the post-soak devshop extraction (D11), and add a future-chapter row for the offline-queue / IndexedDB sync engine (D9).

## Out of scope (deferred)

- **Offline queue / IndexedDB sync engine (D9).** Persistent across browser restarts, idempotency-key shape on the add-item RPC, conflict resolution against realtime — all deferred to a dedicated future chapter. v0's bounded 15s retry covers transient-network cases; the offline queue is a feature, not a polish pass.
- **Devshop lift (D13).** `@devshop-template/ui` extraction of `SubmitButton` / `LoadingArea` / `useSubmitFeedback` / `useOptimisticMutation`, plus the framework doc lift to `/devshop/template/CLAUDE.md` + `/devshop/kit/docs/guide/latency-feedback.md`, happens in a separate post-soak PR after 2-4 weeks of production use. Same "ship inline → soak → extract" sequencing chapter 1l followed.
- **Native primitives (D14).** SwiftUI equivalents (Tier B `Button` + `Task.sleep`, Tier C `NavigationStack` placeholder, Tier A `@State` optimistic updates) are not built in this PR. The framework table is platform-agnostic and reuses verbatim when the native rewrite happens; the components/hooks are React-specific and intentionally do NOT lift.
- **All explicit-non-scope items from `PRODUCT-ROADMAP.md § v0 § 1m`** still apply (no new METRICS events per D7; no analytics changes; no edge-function changes; no schema changes; no auth-flow changes).

## Files to create / modify / delete

### Create

- `packages/ui/src/useSubmitFeedback.ts` — Tier B hook (250ms threshold timer + cleanup state machine).
- `packages/ui/src/useSubmitFeedback.test.ts` — covers threshold timing (no spinner before 250ms, spinner after), cleanup on unmount/transition, multi-cycle reuse.
- `packages/ui/src/SubmitButton.tsx` — Tier B component built on `useSubmitFeedback` + `Button`. Lifted shape from `apps/web/components/AuthSubmitButton.tsx` with no behavior delta.
- `packages/ui/src/SubmitButton.test.tsx` — ports the existing `AuthSubmitButton.test.tsx` cases (idle/pending/success label, disabled-during-pending, post-success label swap, aria-busy).
- `packages/ui/src/LoadingArea.tsx` — Tier C `animate-pulse` empty-container primitive (D3). Accepts `className` override and child slot for layout-shape preservation.
- `packages/ui/src/LoadingArea.test.tsx` — renders pulse class, respects `className` override, passes through children.
- `packages/ui/src/useOptimisticMutation.ts` — Tier A hook with `failureMode: 'rollback' | 'banner'` discriminated union; encapsulates retry budget + backoff (D8) for the banner mode.
- `packages/ui/src/useOptimisticMutation.test.ts` — covers happy-path, rollback-mode silent revert, banner-mode retry sequence, banner-mode hard failure (4xx vs retries-exhausted), retry button re-fire, undo button calling rollback.
- `apps/web/app/list/loading.tsx` — Tier C route placeholder for `/list`.
- `apps/web/app/item/[id]/loading.tsx` — Tier C route placeholder for `/item/[id]`.
- `apps/web/app/settings/loading.tsx` — Tier C route placeholder for `/settings`.
- `apps/web/app/(auth)/onboarding/loading.tsx` — Tier C route placeholder for `/onboarding`.
- `apps/web/e2e/route-loading.spec.ts` — verifies `LoadingArea` paints within 100ms of clicking the `/settings` link (covers all 4 routes structurally — the assertion is "the route segment shows a Tier C placeholder before the page resolves").
- `apps/web/e2e/add-item-banner.spec.ts` — uses `page.route()` to abort the add-item edge function call and asserts the optimistic row appears + `SyncErrorBanner` surfaces with the failed item label + retry/undo affordances are wired.
- `apps/web/e2e/mark-bought-feel.spec.ts` — verifies mark-bought row fades immediately on tap (before RPC resolves) and that an injected RPC failure rolls the row back without a banner.

### Modify

- `packages/ui/src/index.ts` — export `SubmitButton`, `LoadingArea`, `useSubmitFeedback`, `useOptimisticMutation`, plus the new token names.
- `packages/ui/src/tokens.ts` — add `FEEDBACK_THRESHOLD_MS`, `RETRY_BUDGET_MS`, `RETRY_BACKOFF_MS` (D12).
- `apps/web/app/(auth)/sign-in/page.tsx` — swap `AuthSubmitButton` import for `SubmitButton` from `@lalista/ui` (D5).
- `apps/web/app/(auth)/sign-up/page.tsx` — same swap.
- `apps/web/app/(auth)/forgot-password/page.tsx` — same swap.
- `apps/web/app/(auth)/reset-password/page.tsx` — same swap.
- `apps/web/components/AwaitingConfirmationCard.tsx` — same swap (resend button).
- `apps/web/components/SignOutButton.tsx` — adopt `SubmitButton` with `successLabel="Signing out…"` (Tier B).
- `apps/web/components/AddItemSheet.tsx` — wrap submit handler with `useOptimisticMutation({ failureMode: 'banner' })` for both the main add and the force-create branch (Tier A2). Optimistic insert path stays inside `ListClient.handleAddResponse`; the hook owns the retry/undo wiring.
- `apps/web/components/DisambiguationSheet.tsx` — same hook for the option-pick path; shares the banner with AddItem (Tier A2).
- `apps/web/components/ListRow.tsx` — adopt `useOptimisticMutation({ failureMode: 'rollback' })` for mark-bought (Tier A1). Realtime DELETE remains the reconciler; rollback re-inserts the row locally on RPC failure.
- `apps/web/components/DisplayNameField.tsx` — adopt `useOptimisticMutation({ failureMode: 'rollback' })` for save (Tier A1). Inline-error slot stays.
- `apps/web/components/SyncErrorBanner.tsx` — extend with explicit "retry" and "undo" buttons (D15). Existing `onRetry` / `onDismiss` props stay; add `onUndo?: () => void` and an `affordance: 'tap-to-retry' | 'retry-undo'` discriminator so the existing realtime/query failure case keeps its current bar-tap UX.
- `CLAUDE.md` — append new gotcha "Latency feedback tiers (A1/A2/B/C/D)" with the framework table from D1 + canonical surface mapping + decision rule (D11).
- `DESIGN.md` — add "Motion + feedback" section with token list (D12) and framework summary (D11).
- `PRODUCT-ROADMAP.md` — add row under § Pattern lift candidates for post-soak devshop lift (D13); add future-chapter row for offline-queue / IndexedDB sync engine (D9).

### Delete

- `apps/web/components/AuthSubmitButton.tsx` — superseded by `@lalista/ui`'s `SubmitButton`. No shim per D5.
- `apps/web/components/AuthSubmitButton.test.tsx` — content ports to `packages/ui/src/SubmitButton.test.tsx`.

## API contracts

```ts
// packages/ui/src/useSubmitFeedback.ts

export interface SubmitFeedbackState {
  /** True while the caller's async action is in-flight. */
  isPending: boolean;
  /** True only after the threshold (default 250ms) has elapsed AND isPending is still true. */
  showSpinner: boolean;
}

export function useSubmitFeedback(
  isPending: boolean,
  options?: { thresholdMs?: number }
): { showSpinner: boolean };
```

```ts
// packages/ui/src/SubmitButton.tsx

import type { ReactNode, ButtonHTMLAttributes } from 'react';

export interface SubmitButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  children: ReactNode;
  isPending: boolean;
  /** Label swapped in once the spinner threshold elapses. Defaults to children. */
  pendingLabel?: ReactNode;
  /** True after the action resolved successfully (caller-controlled). */
  isSuccess?: boolean;
  /** Label swapped in on success. Defaults to children. Button stays disabled. */
  successLabel?: ReactNode;
}

export function SubmitButton(props: SubmitButtonProps): JSX.Element;
```

```ts
// packages/ui/src/LoadingArea.tsx

export interface LoadingAreaProps {
  /** ARIA label for the busy region. Defaults to "Loading". */
  label?: string;
  /** Tailwind class overrides for the pulse block. */
  className?: string;
  /** Optional layout-shape children rendered inside the pulse. */
  children?: ReactNode;
}

export function LoadingArea(props: LoadingAreaProps): JSX.Element;
```

```ts
// packages/ui/src/useOptimisticMutation.ts

export type OptimisticFailureMode =
  | { failureMode: 'rollback'; rollback: () => void }
  | {
      failureMode: 'banner';
      rollback: () => void;
      bannerLabel: string;
      onBannerDismiss?: () => void;
    };

export interface OptimisticMutationConfig<TArgs, TResult> {
  /** The async work that happens in the background after the optimistic commit. */
  mutate: (args: TArgs) => Promise<TResult>;
  /** Apply the optimistic state — runs synchronously when run() is called. */
  applyOptimistic: (args: TArgs) => void;
  /** Failure-mode discriminated union — see above. */
  onFailure: OptimisticFailureMode;
  /** Optional 4xx/5xx classifier — returns true for "server rejected, no retry". Defaults to status >= 400 && status < 500. */
  isHardError?: (err: unknown) => boolean;
}

export interface OptimisticMutationResult<TArgs> {
  run: (args: TArgs) => Promise<void>;
  isPending: boolean;
}

export function useOptimisticMutation<TArgs, TResult>(
  config: OptimisticMutationConfig<TArgs, TResult>
): OptimisticMutationResult<TArgs>;
```

The discriminated union shape ensures the type system enforces that banner-mode callers supply a `bannerLabel` (so `SyncErrorBanner` knows what to say) while rollback-mode callers don't have to fabricate one.

## Failure / connectivity behavior

### Tier A2 (banner mode) — `AddItemSheet` add example

```
User taps "Add"
  → applyOptimistic(args)         [row appears in list immediately]
  → isPending = true
  → mutate(args) attempt 1
       │
       ├── success → isPending = false; banner stays hidden; realtime echo dedups by id (existing logic in ListClient.hydrateFromRealtime)
       │
       ├── network error → wait 1000ms → mutate(args) attempt 2
       │      ├── success → isPending = false; banner stays hidden
       │      ├── network error → wait 3000ms → mutate(args) attempt 3
       │      │      ├── success → isPending = false; banner stays hidden
       │      │      ├── network error → wait 7000ms → mutate(args) attempt 4 (final)
       │      │      │      ├── success → silent
       │      │      │      └── any error → SyncErrorBanner shown with `bannerLabel` + retry/undo affordances
       │      │      └── 4xx/5xx → SyncErrorBanner shown immediately (no further retries)
       │      └── 4xx/5xx → SyncErrorBanner shown immediately
       └── 4xx/5xx (e.g. validation reject) → SyncErrorBanner shown immediately
```

Retry budget bookkeeping: 1000 + 3000 + 7000 = 11000ms of backoff + ~4× attempt RTT ≈ 15s total budget per `RETRY_BUDGET_MS`. If an individual attempt exceeds the remaining budget, that attempt still completes (we don't preempt in-flight requests), but no further retries are scheduled.

Banner affordances:

- **Retry** — re-fires `mutate(args)` with a fresh attempt counter. Same retry sequence on failure.
- **Undo** — calls the `rollback()` registered with the mutation. For AddItem, `rollback` removes the optimistic row from `ListClient.entries`. Banner dismisses on success of either button.

### Tier A1 (rollback mode) — `ListRow` mark-bought example

```
User taps buy button
  → applyOptimistic(args)         [row fades + buyingId set]
  → mutate(args) [single attempt; rollback mode does NOT retry]
       │
       ├── success → realtime DELETE arrives + ListClient removes row locally; idempotent dedup
       └── error   → rollback() restores the row's prior state; ConfirmationToast shows "Couldn't mark bought — try again"
```

Tier A1 deliberately skips retries — the rollback IS the message. Adding retries would re-fade-then-restore which is more confusing than a clean fail-fast.

### Tier B — auth submit example

```
User taps "Continue"
  → caller sets isPending = true
  → SubmitButton: instant disable + aria-busy
  → at 250ms (threshold): SubmitButton shows spinner + pendingLabel
  → on resolve: caller sets isPending = false (and optionally isSuccess = true)
  → SubmitButton: spinner clears via useEffect cleanup (functional setState pattern, see Gotchas)
```

Failure path is owned by the caller's existing inline error display (`AuthErrorDisplay`). `SubmitButton` is presentational — it does not retry or surface its own error UI.

## Tests

Unit tests live alongside source under `packages/ui/src/`. E2E specs live under `apps/web/e2e/`.

- `packages/ui/src/useSubmitFeedback.test.ts` — D6 unit. `vi.useFakeTimers()` to assert spinner stays hidden at 249ms and shows at 250ms; cleanup on `isPending: true → false` resets state without leaking the timer; multi-cycle (toggle pending several times) yields fresh threshold each cycle.
- `packages/ui/src/SubmitButton.test.tsx` — D6 unit. Ports every case from the existing `AuthSubmitButton.test.tsx` (idle label, pending+threshold spinner, success label, disabled flags, aria-busy). Adds a case verifying the success label persists when both `isSuccess` and `isPending` are momentarily true.
- `packages/ui/src/LoadingArea.test.tsx` — D6 unit. Renders the pulse class; respects `className` override; passes children through; sets `role="status"` + `aria-busy="true"` on the wrapper.
- `packages/ui/src/useOptimisticMutation.test.ts` — D6 unit. Covers (a) happy path commits + clears `isPending`, (b) rollback mode calls `rollback()` once on error, (c) banner mode runs the 4-attempt sequence with `[1000, 3000, 7000]` backoff (assert via `vi.advanceTimersByTime`), (d) banner mode escalates on 4xx without retries (`isHardError`), (e) retry button re-fires the mutation, (f) undo button calls `rollback()` and dismisses the banner.
- `apps/web/e2e/route-loading.spec.ts` — D6 E2E. Authenticate; navigate from `/list` to `/settings`; assert the `LoadingArea`'s `role="status"` is visible within 100ms of the click. Catches regressions if a future route forgets `loading.tsx`.
- `apps/web/e2e/add-item-banner.spec.ts` — D6 E2E. Authenticate; open `AddItemSheet`; use `page.route('**/functions/v1/add-item', route => route.abort())` to simulate a hard network failure; assert the optimistic row appears in the list AND the `SyncErrorBanner` surfaces with the item label after the retry budget expires; click "undo" and assert the row disappears.
- `apps/web/e2e/mark-bought-feel.spec.ts` — D6 E2E. Two-context provisioning (existing `auth-edge-cases.spec.ts` + `force-create-race.spec.ts` patterns). Add a list entry; tap the buy button; assert the row's opacity changes within 50ms of the click (i.e. before the RPC resolves). Inject an RPC failure via `page.route()` matching `/rest/v1/rpc/mark_item_bought`; assert the row reappears at full opacity within ~1s.
- Existing auth E2E specs (`apps/web/e2e/sign-in.spec.ts`, `sign-up.spec.ts`, `forgot-password.spec.ts`, `reset-password.spec.ts`, `auth-edge-cases.spec.ts`) — regression pass after the SubmitButton lift; no new assertions needed because `SubmitButton`'s behavior is identical to `AuthSubmitButton`. Verify they still pass after the import-path change.

## Task order

Each task commits atomically. `/ak-implement` walks this list top-down.

1. **Add motion/feedback tokens** to `packages/ui/src/tokens.ts` (`FEEDBACK_THRESHOLD_MS`, `RETRY_BUDGET_MS`, `RETRY_BACKOFF_MS`). Export from `index.ts`. No tests yet — tokens are referenced by hooks built next.
2. **Build `useSubmitFeedback`** + unit tests. Lifts the `useEffect` + `useRef` + functional-setState cleanup pattern from `AuthSubmitButton`.
3. **Build `SubmitButton`** + unit tests. Composes `useSubmitFeedback` with `@lalista/ui`'s `Button`. Port test cases from `AuthSubmitButton.test.tsx`.
4. **Build `LoadingArea`** + unit tests.
5. **Build `useOptimisticMutation`** (rollback + banner modes) + unit tests. Banner mode runs the retry sequence; rollback mode is single-attempt.
6. **Wire `SyncErrorBanner` retry + undo affordances** + unit tests. Add `onUndo?: () => void` and the `affordance` discriminator; preserve the existing tap-to-retry path so realtime/query failure UX is unchanged.
7. **Add 4 `loading.tsx` files** (Tier C) under `/list`, `/item/[id]`, `/settings`, `/(auth)/onboarding`.
8. **Migrate 5 auth screens to `SubmitButton`**, delete `AuthSubmitButton.tsx` + `.test.tsx` (Tier B lift, D5).
9. **Adopt `SubmitButton` in `SignOutButton`** with `successLabel="Signing out…"` (Tier B new).
10. **Adopt `useOptimisticMutation` (banner mode) in `AddItemSheet`** for both add + force-create paths (Tier A2). Wire shared `SyncErrorBanner` slot in `ListClient`.
11. **Adopt `useOptimisticMutation` (banner mode) in `DisambiguationSheet`** for option pick (Tier A2). Shares the AddItem banner.
12. **Adopt `useOptimisticMutation` (rollback mode) in `ListRow`** mark-bought (Tier A1). Realtime DELETE remains the reconciler.
13. **Adopt `useOptimisticMutation` (rollback mode) in `DisplayNameField`** save (Tier A1).
14. **Verify no `<Link prefetch={false}>` overrides** in `apps/web/**/*.tsx` — Tier C only fires when the destination route hasn't preloaded; an accidental `prefetch={false}` on the settings/list/item links would defeat the loading.tsx UX. Sweep + remove any found.
15. **Update E2E specs**: add `route-loading.spec.ts`, `add-item-banner.spec.ts`, `mark-bought-feel.spec.ts`. Run the existing auth E2E specs and confirm they still pass.
16. **Document framework**: append `CLAUDE.md § Gotchas` entry "Latency feedback tiers" with the D1 table + canonical surface mapping + decision rule.
17. **Document framework**: add `DESIGN.md § Motion + feedback` section with the token list (D12) + framework summary.
18. **Update `PRODUCT-ROADMAP.md`**: add post-soak devshop-lift row (§ Pattern lift candidates) + offline-queue future-chapter row.

## Gotchas surfaced during planning

- **`useOptimisticMutation` rollback timing.** When `failureMode: 'rollback'` fires after a failed mutation, the rollback handler must run AFTER the pessimistic state has been visually committed — not synchronously inside the same render that committed it. React 19's auto-batching will otherwise elide the visible "row appeared then disappeared" frame, and the user sees no feedback at all. Use `flushSync` around `applyOptimistic`, OR schedule the mutation kickoff via `queueMicrotask` so the optimistic frame paints before the rejection lands. Same pattern `ListClient.handleAddResponse`'s realtime-merge race uses.
- **AddItem optimistic insert id collision with realtime.** The optimistic row uses the `entry_id` returned by the add-item edge function (resolved before the optimistic commit, since the function returns synchronously after the DB insert). `ListClient.hydrateFromRealtime`'s INSERT branch dedups by `e.id === incoming.id` — that dedup is load-bearing for this PR. Do NOT change it. If a future iteration ever switches to a client-generated UUID inserted before the server round-trip, the realtime handler will need an idempotency-key field on `list_entries` AND a server-side merge. Out of scope here.
- **`SubmitButton`'s functional-setState cleanup is load-bearing.** The existing `AuthSubmitButton.tsx` has an inline comment (lines 51-56) explaining that the `setShowSpinner(false)` inside the `useEffect` cleanup runs as part of the next effect pass / unmount, NOT synchronously after the render that triggered it — that's what makes the threshold-then-clear sequencing race-free. Preserve this verbatim during the lift to `useSubmitFeedback`. Test coverage for this is the multi-cycle case in `useSubmitFeedback.test.ts`.
- **`SyncErrorBanner` mount placement.** The banner is currently mounted inside `ListClient.tsx` — it's NOT in a layout above route changes. For Tier A2 cross-screen visibility (D8), confirm during implementation that AddItem failures while the user is on `/list` work as-is, but if a future PR adds AddItem entry points from `/item/[id]` or `/settings`, the banner must move up to `apps/web/app/(authed)/layout.tsx` (or equivalent). For this PR the surface is `/list`-only, so the existing placement is sufficient — call this out in the test plan but don't move the banner.
- **Tailwind v4 `@source` directive.** `packages/ui/src/**/*.{ts,tsx}` is already covered by `apps/web/app/globals.css`'s `@source` line per the `CLAUDE.md` gotcha. New files in `packages/ui/src/` (`SubmitButton.tsx`, `LoadingArea.tsx`) inherit. No action needed unless `loading.tsx` files introduce new utility classes that aren't in `tokens.ts` — they don't (D3 says vanilla `animate-pulse` + `bg-muted/40`).
- **Auth-screen test port.** `apps/web/components/AuthSubmitButton.test.tsx` content moves to `packages/ui/src/SubmitButton.test.tsx` — only the import path changes (`@/components/AuthSubmitButton` → `./SubmitButton`). Don't rewrite the assertions; the lift is meant to be behavior-preserving.
- **METRICS untouched.** D7 says no new events. Resist the temptation to add `optimistic_rollback` or `retry_attempted` events even though they'd be useful — that's a follow-up concern. Existing `error_displayed` (already fired by `SyncErrorBanner`) covers banner appearances for free.
- **Don't restructure `ListClient.handleAddResponse`.** That function already encodes the realtime-arrives-first race in lines 274-285 (the `findIndex + replace OR prepend` shape). The Tier A2 hook integrates by giving `applyOptimistic` callback a path through that same code, NOT by replacing it. The hook is the retry/escalation engine; the merge logic stays in `ListClient`.
- **`mark_item_bought` is the only legal mark-bought path.** The `ListRow` Tier A1 adoption keeps using `markItemBought(client, entryId)` from `@lalista/core` (per the CLAUDE.md gotcha). Don't refactor the call into a generic `supabase.from(...).delete()` even if it would simplify the rollback shape.

## Acceptance criteria

- **Tier A1** — `ListRow` mark-bought row fades to ~50% opacity within 50ms of the buy-button tap (i.e. before the RPC resolves). On RPC error, the row restores to full opacity + the existing "Couldn't mark bought" toast appears. No spinner. No banner.
- **Tier A1** — `DisplayNameField` save shows the new value immediately on commit; on error, the field reverts to the prior value and the parent's inline-error slot displays the failure. No spinner.
- **Tier A2** — `AddItemSheet` add path optimistically inserts the row; transient network blips (3 attempts within 15s budget) resolve silently. Hard failure surfaces `SyncErrorBanner` labeled with the failed item ("Couldn't save 'milk' — retry / undo"). Retry button re-fires the mutation; undo removes the optimistic row.
- **Tier A2** — `DisambiguationSheet` option pick shares the same banner slot as AddItem. Single-banner UX even if a user adds 3 items in a row and all fail.
- **Tier B** — All 5 auth-screen submits (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `AwaitingConfirmationCard` resend) + `SignOutButton` show instant disable on click. Spinner appears only after 250ms of pending. Behavior delta from current `AuthSubmitButton` is zero.
- **Tier C** — Tapping links to `/list`, `/item/[id]`, `/settings`, `/(auth)/onboarding` paints `LoadingArea` (the pulsing block) within 100ms of the click. The page chrome (header, FAB) renders alongside the loading region rather than waiting for full content.
- **Framework codification** — `CLAUDE.md § Gotchas` contains the "Latency feedback tiers" entry with the D1 table. `DESIGN.md` contains the "Motion + feedback" section with the D12 tokens. `PRODUCT-ROADMAP.md` lists the post-soak devshop lift + offline-queue future chapter. All three docs revert cleanly with the code if the PR is reverted.
- **Test gates** — All unit tests pass (`pnpm turbo run test:unit`). All E2E specs pass at both viewports (slow-job CI). No new `error_displayed` events are added to METRICS (D7 invariant).

## Rollout / rollback

Single PR. Auto-deploys to Vercel on merge to main. No edge-function changes (per D7's analytics-untouched + D9's no-RPC-shape-change scope), so no `supabase functions deploy` step. No migration changes, so no `deploy-migrations.yml` action.

Rollback = `git revert` on the merge commit. The framework codification edits (`CLAUDE.md`, `DESIGN.md`, `PRODUCT-ROADMAP.md`) revert cleanly along with the code because they're in the same PR — no out-of-band doc updates to undo.

Risk profile: low. The Tier B lift is behavior-preserving (verified by porting existing `AuthSubmitButton.test.tsx` cases). Tier A adoption changes UX but only on the success path you can reason about visually; the failure path adds new affordances rather than removing existing ones (`SyncErrorBanner` keeps its tap-to-retry on the realtime/query path). Tier C is purely additive — `loading.tsx` is shown only during route transitions that already had a blank-frame today.
