# apps/web

> Next.js 15 App Router web app for lalista. Up to [OVERVIEW.md](../../OVERVIEW.md) for the product context, [ARCHITECTURE.md](../../ARCHITECTURE.md) for where this fits in the system.

## What's here

The user-facing surface. Renders public landing, auth flows, the list view, item detail, and settings. Built on Next.js 15 App Router (React Server Components by default, "use client" components for interactive surfaces). Talks to Supabase through `@lalista/core`; never calls `supabase.from(...)` directly.

Auth gating is enforced by `middleware.ts` — allow-lists `/`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, and `/auth/callback`; blocks all else without a session. RSC redirects (`apps/web/app/page.tsx`) handle the authenticated→`/list` flow. The `(auth)` route group shares an `_email-context.tsx` provider so a typed email survives intra-flow navigation between sign-in / sign-up / forgot-password without leaking through query params.

## Route map

| Path               | File                                                           | Purpose                                                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` (unauth)       | `app/page.tsx` + `components/PublicLanding.tsx`                | Public marketing landing for unauthed visitors                                                                                                                                                                                                                                                                      |
| `/` (auth)         | `app/page.tsx`                                                 | RSC redirect to `/list` via `supabase.auth.getUser()` + `redirect()`                                                                                                                                                                                                                                                |
| `/sign-in`         | `app/(auth)/sign-in/page.tsx`                                  | Email + password sign-in (no signup fallback post-1l)                                                                                                                                                                                                                                                               |
| `/sign-up`         | `app/(auth)/sign-up/page.tsx`                                  | Email + password sign-up → AwaitingConfirmationCard or `/onboarding`                                                                                                                                                                                                                                                |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx`                          | No-enumeration reset-link request, 60s resend, edit-email round-trip                                                                                                                                                                                                                                                |
| `/reset-password`  | `app/(auth)/reset-password/page.tsx`                           | New password + confirm — finalizes recovery, lands on /list                                                                                                                                                                                                                                                         |
| `/auth/callback`   | `app/auth/callback/route.ts`                                   | Magic-link exchange (recovery → /reset-password; signup → /onboarding)                                                                                                                                                                                                                                              |
| `/onboarding`      | `app/(auth)/onboarding/page.tsx`                               | Post-signup household-provisioning landing                                                                                                                                                                                                                                                                          |
| `/list`            | `app/list/page.tsx`                                            | Authed home — list view grouped by store, real-time subscription                                                                                                                                                                                                                                                    |
| `/item/[id]`       | `app/item/[id]/page.tsx`                                       | Item detail + `Mark bought` (calls `mark_item_bought` RPC)                                                                                                                                                                                                                                                          |
| `/settings`        | `app/settings/page.tsx`                                        | Display-name editor + sign out + household info                                                                                                                                                                                                                                                                     |
| `/join/[token]`    | `app/join/[token]/page.tsx` + `JoinClient.tsx` + `_states.tsx` | Server-component invite-acceptance flow (7-step decision tree per spec D20). Colocated state pages: `<InviteUnavailable>` (token used/expired), `<AlreadyInHousehold>` (signed in to a different household), `<OwnInviteLink>` (inviter clicked own link). Unauthed visitors redirect to `/sign-up?invite=<token>`. |

Each authed route under `/list`, `/item/[id]`, `/settings`, and `/(auth)/onboarding` ships a sibling `loading.tsx` (Tier C of the latency-feedback framework) that paints the page chrome plus a `<LoadingArea>` block within ~100ms of a `<Link>` tap, so route transitions never show a blank frame. See `CLAUDE.md § Gotchas § Latency feedback tiers` for the framework.

## Component map

Page-level components live here (in `apps/web/components/`); design-system primitives live in [`packages/ui`](../../packages/ui/README.md). Page components compose primitives; primitives never import page components.

| Component                    | Purpose                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PublicLanding`              | Unauth-only landing                                                                                             |
| `ListClient`                 | Client wrapper for `/list` — Realtime subscription + optimistic insert                                          |
| `ListRow`                    | One pending list entry — name, brand, qty, "added by", tap-to-detail                                            |
| `StoreSection`               | Per-store group header on `/list`                                                                               |
| `EmptyListState`             | Empty-state for `/list`                                                                                         |
| `AddItemSheet`               | Add-item input — calls `invokeAddItem`, opens disambig sheet on follow-up                                       |
| `DisambiguationSheet`        | Multi-candidate picker + force-create option                                                                    |
| `ConfirmationToast`          | Generic toast (success / error)                                                                                 |
| `SyncErrorBanner`            | Banner shown on Realtime channel-error or sync failure                                                          |
| `HouseholdInfo`              | `/settings` household block (legacy — being replaced by `HouseholdSection`)                                     |
| `HouseholdSection`           | `/settings` Household section — owner-editable name field vs read-only + caption (D12, household-collaborators) |
| `MemberRow`                  | One row in `MembersSection` — avatar + name + RoleBadge + owner-only remove button                              |
| `MembersSection`             | `/settings` Members section — list, pending invites, "invite someone" CTA, member "Leave household" button      |
| `HouseholdAuditSection`      | `/settings` Activity collapsible feed of household_audit_events                                                 |
| `MyStoresSection`            | `/settings` My Stores section — manage-mode picker with Tier A1 rollback latency (migration 016, D10)           |
| `InviteLinkSheet`            | Modal sheet showing an invite URL after `createInvite()`; copy + share buttons                                  |
| `RemovedFromHouseholdNotice` | `/onboarding?removed=1` notice card (D15)                                                                       |
| `DisplayNameField`           | Editable display-name input (shared)                                                                            |
| `DisplayNameSection`         | `/settings` wrapper around `DisplayNameField`                                                                   |
| `SignOutButton`              | Calls `signOut`, redirects to `/`                                                                               |
| `ThemeProvider`              | Tailwind theme provider                                                                                         |
| `AuthErrorDisplay`           | Auth-screen inline error — same DOM/class for client + server errors                                            |
| `AwaitingConfirmationCard`   | Hard-gate after sign-up — listens for SIGNED_IN, 60s resend countdown                                           |

Auth-only helpers (under `apps/web/components/auth/`):

| Helper               | Purpose                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `friendlyAuthError`  | Map raw Supabase auth errors to user-facing copy                                                                                 |
| `useResendCountdown` | Shared 60s countdown for resend buttons (`AwaitingConfirmationCard` + `/forgot-password`)                                        |
| `validatePassword`   | Client-side mirror of Supabase's `lower_upper_letters_digits_symbols` policy — returns the first failing rule's friendly message |

## Public assets

Files under `public/` are served verbatim from the Vercel deploy at `https://lalista.store/<filename>`. Each asset earns its place by being referenced from a specific consumer — usually the Next root metadata, the PWA manifest, or one of the Supabase email templates. The list also exists so anyone touching the email templates or the PWA shell can discover what's available without digging through the deploy.

| File                     | Consumer                                                                            | Source-of-truth                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `manifest.json`          | `app/layout.tsx` (`metadata.manifest`)                                              | Hand-edited                                                                                |
| `icon.svg`               | `manifest.json` (PWA icon, scalable)                                                | Hand-edited                                                                                |
| `icon-192.png`           | `manifest.json` (PWA icon, 192×192)                                                 | Hand-edited                                                                                |
| `icon-512.png`           | `manifest.json` (PWA icon, 512×512, maskable)                                       | Hand-edited                                                                                |
| `apple-touch-icon.png`   | `manifest.json` (iOS home-screen icon, 180×180)                                     | Hand-edited                                                                                |
| `lalista-email-logo.png` | `supabase/templates/{confirmation,recovery}.html` (referenced by absolute prod URL) | Generated — `node design/gen-email-logo.mjs` (one-off; deps install ad-hoc per its header) |

The middleware matcher in `middleware.ts` deliberately excludes common image extensions (`.png`/`.jpg`/`.svg`/`.webp`/`.ico`) so unauth requests to these assets — including Gmail's image proxy fetching `lalista-email-logo.png` for emails — pass through without hitting the auth wall. See `CLAUDE.md § Gotchas` and PR #45 for the regression that motivated that exclusion.

## Conventions

- **Server-first by default**: every component is a Server Component unless it needs interactivity. Add `"use client"` only when the component subscribes to Realtime, holds form state, or uses browser APIs.
- **Auth gating in middleware, not in components**: `middleware.ts` is the source of truth. Don't sprinkle `redirect('/sign-in')` calls in pages — they create races against middleware.
- **Tokens via `@lalista/ui`**: never hard-code colors or sizes. Reference tokens or use the primitive components.
- **API calls via `@lalista/core`**: never `supabase.from('table').select(...)` directly in this app. Add a wrapper to `packages/core/src/api/` and import it.
- **E2E pairing**: every page under `app/**/page.tsx` has at least one E2E spec in `e2e/` exercising its primary verb. New page → new or extended spec in the same PR. See `CLAUDE.md § Testing § E2E-per-surface invariant`.
- **Tests colocate**: `Foo.test.tsx` next to `Foo.tsx`; `page.test.tsx` next to `page.tsx`. Vitest + Testing Library for unit; Playwright for E2E.
- **Sentry capture is at the boundary**: `instrumentation.ts` registers Sentry; component code uses helper modules in `apps/web/lib/` (e.g. `reportAddItemValidationError.ts`). Don't import `@sentry/nextjs` directly in business logic — that belongs in apps/web only.
- **Tailwind `@source` for `@lalista/ui`**: `app/globals.css` must contain `@source "../../../packages/ui/src/**/*.{ts,tsx}";` — without it, token utilities used only in `packages/ui` get stripped silently. See `CLAUDE.md § Gotchas`.

## See also

- [OVERVIEW.md](../../OVERVIEW.md) — product context
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — system view
- [`packages/core/README.md`](../../packages/core/README.md) — API wrappers consumed here
- [`packages/ui/README.md`](../../packages/ui/README.md) — design primitives consumed here
- [`supabase/functions/README.md`](../../supabase/functions/README.md) — the edge function `invokeAddItem` calls
- `CLAUDE.md § Where Things Happen` — full path index
- `CLAUDE.md § Gotchas` — Next.js + Tailwind + Supabase load-bearing rules
- `e2e/` — Playwright spec coverage per the E2E-per-surface invariant. Includes `e2e/helpers/inbucket.ts` for following magic links from the local Supabase mail relay (port 54324) — used by `sign-up.spec.ts` and `forgot-password.spec.ts`.
