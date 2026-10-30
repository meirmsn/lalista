# Tasks: app-snappiness

## Status

| #   | Task                                           | Status | Commit            |
| --- | ---------------------------------------------- | ------ | ----------------- |
| 1   | Add motion/feedback tokens                     | done   | 0f4d4d7           |
| 2   | Build useSubmitFeedback + tests                | done   | 5c28ae7           |
| 3   | Build SubmitButton + tests                     | done   | 3302e94           |
| 4   | Build LoadingArea + tests                      | done   | e1d7efc           |
| 5   | Build useOptimisticMutation + tests            | done   | 232d7a6           |
| 6   | Wire SyncErrorBanner retry + undo              | done   | cf31f88           |
| 7   | Add 4 loading.tsx files                        | done   | 95b7584           |
| 8   | Migrate auth screens to SubmitButton + delete  | done   | 2afaa88           |
| 9   | SignOutButton adopts SubmitButton              | done   | 72f959c           |
| 10  | AddItemSheet adopts useOptimisticMutation (A2) | done   | e92e164           |
| 11  | DisambiguationSheet adopts hook (A2)           | done   | cf3beda           |
| 12  | ListRow adopts hook (A1)                       | done   | 77a596c           |
| 13  | DisplayNameField adopts hook (A1)              | done   | aef2d20           |
| 14  | Link prefetch sweep                            | done   | n/a (empty sweep) |
| 15  | E2E specs                                      | done   | 3a0469a           |
| 16  | CLAUDE.md framework gotcha                     | done   | f053ae3           |
| 17  | DESIGN.md Motion + feedback section            | done   | 69a28df           |
| 18  | PRODUCT-ROADMAP.md updates                     | done   | 50250fa           |

## Decisions made during implementation

(Capture any judgment calls you made that the spec didn't fully resolve.
One bullet per decision: what + why + commit it landed in.)

- Added jsdom + @testing-library + @vitejs/plugin-react to `packages/ui/devDependencies` and updated `vitest.config.ts` + new `vitest.setup.ts` so component tests can render with React Testing Library. Spec § Tests requires `useSubmitFeedback`/`SubmitButton`/`LoadingArea`/`useOptimisticMutation` tests under `packages/ui/src/`, but the existing ui package only had server-rendering snapshot tests; this is the minimum infra to host the new tests there. Lands in task 1's commit (the bootstrap is required before task 1's token test can run alongside the new devDeps).
- `LoadingArea` uses `bg-surface-2/60` instead of the spec's literal `bg-muted/40` (D3 says "or token-equivalent"). The lalista token surface in `tokens.ts` doesn't expose a `muted` token; `surface-2` is the closest quiet neutral. Lands in task 4's commit (e1d7efc).
- `useOptimisticMutation`'s rollback-mode rollback uses `queueMicrotask` (not `flushSync`) per spec gotcha 1. Spec offers either as the fix; `queueMicrotask` is a strictly local concern (no React-internals coupling, no risk of nested-flushSync warnings) and matches the "schedule the rejection one tick later so the optimistic frame paints first" wording. Lands in task 5's commit.
- `useOptimisticMutation`'s default `isHardError` only treats numeric `status >= 400 && < 600` as hard. Supabase `mutate` callbacks typically resolve fetches via `supabase-js` which throws either network errors (no `status`) or `PostgrestError` objects with a `code` string but no numeric `status`. The default classifier therefore retries any non-status error — which is the correct shape for "transient network blip retries silently" per D8. Callers needing custom classification (e.g. AddItemSheet flagging a 422 validation error) override via `isHardError`. Lands in task 5's commit.
- Task 8 also migrates `OnboardingForm` (not listed in spec § Files to modify but a real `AuthSubmitButton` consumer). Without the migration, the post-task-8 codebase would have a dead `AuthSubmitButton` import. Lands in task 8's commit.
- Task 9: SignOutButton consumes `useSubmitFeedback` directly rather than `<SubmitButton>`. Reason: the existing component has a destructive (border-error + text-error + bg-transparent) style; SubmitButton wraps `Button` whose primary `bg-primary` can't be cleanly overridden via className without specificity gymnastics. The hook gives us the Tier B timing contract without forcing the primary visual treatment. Spec D1 requires Tier B affordance + post-success label "Signing out…" — both delivered. Lands in task 9's commit.
- Task 10: AddItemSheet's Tier A2 adoption uses `applyOptimistic = no-op` because the optimistic row is committed by ListClient's `handleAddResponse` after the server returns the resolved entry_id (per spec gotcha 2 — "the optimistic row uses the entry_id returned by the add-item edge function (resolved before the optimistic commit, since the function returns synchronously after the DB insert)"). The hook's value here is purely the retry budget + banner escalation; the existing optimistic-merge code in ListClient is preserved verbatim per gotcha 7 ("Don't restructure ListClient.handleAddResponse"). Banner state is hoisted to ListClient via a new `onSubmissionBanner` prop so the banner survives the sheet's unmount on Cancel/navigation. The list view's existing `SyncErrorBanner` slot for realtime/query failures is joined by a second `SyncErrorBanner` (`affordance="retry-undo"`) for submission failures, following D15. Lands in task 10's commit.
