# @lalista/ui

> Design tokens + primitive components for lalista. Up to [OVERVIEW.md](../../OVERVIEW.md) for the product context, [ARCHITECTURE.md](../../ARCHITECTURE.md) for where this fits in the system.

## What's here

`packages/ui` is the design-system source of truth — color/typography/spacing/motion tokens plus the small set of primitive components every page builds on. Page-level components live in `apps/web/components/` (they may compose these primitives but aren't themselves primitives).

Tailwind v4 picks up the styled components via the `@source` directive in `apps/web/app/globals.css` — without that line, Tailwind strips the token utilities (`bg-primary`, `border-border`) used only here. See `CLAUDE.md § Gotchas` for the failure mode.

## Module map

| File                       | Exports                                                              | Purpose                                                                  |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `tokens.ts`                | colors, typography scale, spacing scale, motion durations + feedback | Single source of truth for design tokens (incl. `FEEDBACK_THRESHOLD_MS`) |
| `Button.tsx`               | `Button` (primary/secondary/ghost variants)                          | Action primitive — used in every form                                    |
| `Input.tsx`                | `Input`                                                              | Text input primitive — auto-bound to `Text` label                        |
| `Card.tsx`                 | `Card`                                                               | Container primitive (e.g. `ListRow`, `StoreSection`)                     |
| `Divider.tsx`              | `Divider`                                                            | Visual separator                                                         |
| `Text.tsx`                 | `Text` (title/body/caption variants)                                 | Typography primitive — never use raw `<p>`/`<h1>`                        |
| `useSubmitFeedback.ts`     | `useSubmitFeedback`                                                  | Tier B — 250ms threshold spinner state machine (powers `SubmitButton`)   |
| `SubmitButton.tsx`         | `SubmitButton`                                                       | Tier B button — instant disable + 250ms spinner + success label swap     |
| `LoadingArea.tsx`          | `LoadingArea`                                                        | Tier C — pulsing empty container for route loading.tsx files             |
| `useOptimisticMutation.ts` | `useOptimisticMutation`                                              | Tier A1/A2 — optimistic-commit + rollback or retry-then-banner engine    |
| `RoleBadge.tsx`            | `RoleBadge` (owner/member variants)                                  | Caption-cap role pill for member rows (D20 — household-collaborators)    |
| `StorePicker.tsx`          | `StorePicker`, `StorePickerProps`, `PickerStore`                     | Dual-mode (`select`/`manage`) picker for per-household My Stores (016)   |
| `index.ts`                 | barrel export                                                        | Public API surface                                                       |

## Conventions

- **No app-level dependencies**: this package is consumed by `apps/web` (and any future surface). It must NOT import from `apps/*` or anywhere outside `@lalista/core` (which it currently doesn't import either).
- **Token discipline**: no hard-coded hex colors / pixel sizes / durations in component bodies. Reference `tokens.ts`. The `/ak-design-conformance` gate (gstack) verifies this against `DESIGN.md`.
- **Variants over flags**: prefer `variant="primary"` over `primary={true}`. Strings are easier to grep, easier to extend, and play well with TypeScript discriminated unions.
- **Tests colocate**: `Button.test.tsx` next to `Button.tsx`. Vitest + Testing Library.
- **Updates require Tailwind `@source`**: any new component file added here must already be covered by `apps/web/app/globals.css`'s `@source "../../../packages/ui/src/**/*.{ts,tsx}";`. New top-level workspace packages need a matching `@source` line.

## See also

- [OVERVIEW.md](../../OVERVIEW.md) — product context (what the app does)
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — system view (where this package fits)
- [`apps/web/README.md`](../../apps/web/README.md) — the consumer of these primitives
- [`packages/core/README.md`](../core/README.md) — sibling package (business logic)
- `DESIGN.md` (repo root) — the canonical design contract this package implements
