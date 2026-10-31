<!-- System-level overview. For the product view (what the app does, who uses it),
     see OVERVIEW.md. Authoring rules: kit/docs/guide/conventions.md § Project Docs Hierarchy. -->

# ARCHITECTURE: lalista

> System-level map of how lalista is built. Components, data flow, deployment topology, package responsibilities. For the product view (what the app does), see [OVERVIEW.md](./OVERVIEW.md).

## High-level shape

lalista is a Next.js 16 App Router web app on Cloudflare Workers (built with OpenNext), talking to Supabase (Postgres + Auth + Edge Functions). The novel piece is the `add-item` edge function: a single orchestration call that runs Claude API NLP normalization, pg_trgm fuzzy matching, history-based store routing, and brand preference lookup server-side, returning either a row to optimistic-insert or a disambiguation question for the client.

```text
                ┌───────────────────────────────┐
                │  Browser (apps/web — Next 15) │
                │  React Server Components +    │
                │  client components / hooks    │
                └──────────────┬────────────────┘
                               │
            ┌──────────────────┼─────────────────────┐
            │                  │                     │
            ▼                  ▼                     ▼
   ┌───────────────┐  ┌────────────────┐   ┌──────────────────┐
   │ Supabase Auth │  │ Supabase REST  │   │ Edge Function    │
   │ (login/JWT)   │  │ (PostgREST)    │   │ add-item         │
   └───────────────┘  │  + Realtime    │   │ (Deno/Claude API)│
                      │  WebSocket     │   └─────────┬────────┘
                      └────────┬───────┘             │
                               │                     │
                               ▼                     ▼
                          ┌─────────────────────────────┐
                          │ Postgres (RLS + pg_trgm)    │
                          │ households, list_entries,   │
                          │ items, stores, profiles,    │
                          │ purchase_history, ...       │
                          └─────────────────────────────┘
                          ▲
                          │  Sentry events     PostHog events
                          │  (errors)          (metrics)
                          ▼
                   ┌────────────────┐    ┌────────────────┐
                   │ Sentry          │    │ PostHog         │
                   └────────────────┘    └────────────────┘
```

## Components

### `apps/web` — Next.js 15 web app

- **Purpose**: the user-facing surface. Renders public landing, auth flows, list view, item detail, settings.
- **Lives at**: [`apps/web/`](./apps/web/) — see [`apps/web/README.md`](./apps/web/README.md) for the route map and component conventions.
- **Stack**: Next.js 15 App Router (React Server Components by default, "use client" components for interactive surfaces), Tailwind v4, shared `@lalista/ui` primitives, Sentry (`apps/web/sentry.*.config.ts`), PostHog (`apps/web/app/providers.tsx`).
- **Auth gating**: middleware in `apps/web/middleware.ts`; allow-lists `/`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/auth/callback`, and `/join/` (with the trailing slash — `/joined` typo still requires auth), blocks all else without a session.
- **Depends on**: `@lalista/core` (API wrappers + types), `@lalista/ui` (design system).
- **Consumed by**: end users (browser).

### `packages/core` — business logic + Supabase client

- **Purpose**: framework-neutral wrappers around Supabase queries, RPC calls, real-time subscriptions, and runtime validation. Owns the generated DB types.
- **Lives at**: [`packages/core/`](./packages/core/) — see [`packages/core/README.md`](./packages/core/README.md) for the API surface.
- **Modules**: `api/auth.ts`, `api/households.ts`, `api/items.ts`, `api/profiles.ts`, `api/realtime.ts`, `api/stores.ts`, `api/addItem.ts` (validates the edge-function response with Zod). Schemas in `schemas/`. Shared types in `models/`. Supabase client factory in `supabase.ts` (with `assertNotProdUrlInTestEnv` URL guard).
- **Constraint**: NEVER reads env vars directly — `createClient(config)` takes them as arguments so each app passes prefixed vars in.
- **Depends on**: `@supabase/supabase-js`, `zod`.
- **Consumed by**: `apps/web` (every API call).

### `packages/ui` — design system

- **Purpose**: shared design tokens + primitive components (Button, Card, Divider, Input, Text). The single source of truth for colors, typography, spacing, motion.
- **Lives at**: [`packages/ui/`](./packages/ui/) — see [`packages/ui/README.md`](./packages/ui/README.md) for tokens and component conventions.
- **Stack**: React + TypeScript + Tailwind v4 (consumed via Tailwind's `@source` directive — see `apps/web/app/globals.css`).
- **Depends on**: `react`.
- **Consumed by**: `apps/web` and any future app surface.

### `supabase/functions/add-item` — NLP + disambiguation orchestrator

- **Purpose**: the only edge function. Takes a free-text utterance + household ID, returns either a row to insert or a disambiguation question. Hides Claude API + pg_trgm matching + store routing from the client.
- **Lives at**: [`supabase/functions/`](./supabase/functions/) — see [`supabase/functions/README.md`](./supabase/functions/README.md) for the contract.
- **Auth**: validates the caller's JWT before any write. Force-create branch (PR 5) bypasses NLP/trigram, inserts `items(name_canonical = utterance)` verbatim — uses the `items_insert` RLS policy (migration 011), not service-role escalation.
- **External services**: Anthropic Claude API (NLP), Postgres (via REST), Sentry.
- **Depends on**: Postgres schema + Anthropic API key (`ANTHROPIC_API_KEY` at runtime; see `CLAUDE.md § Anthropic API key split` for the QA/PROD split).
- **Consumed by**: `apps/web` via `packages/core/src/api/addItem.ts`.

### `supabase/migrations/` — schema + RLS policies + RPCs

- **Purpose**: source of truth for the Postgres schema. Each migration is forward-runnable; every one with structural changes ships a `-- ROLLBACK:` block validated by CI's `scripts/ci-rollback-explain.sh`.
- **Tables**: `households`, `household_members`, `household_invitations` (single-active per household — chapter 1m, migration 015), `household_audit_events` (member/rename/invite events — migration 015), `items`, `list_entries`, `stores`, `purchase_history`, `profiles`, `disambiguation_log`, `brand_preferences`, `config`.
- **Indexes**: pg_trgm GIN on `items.name_canonical` for fuzzy-matching; `(household_id, item_id, store_id, bought_at DESC)` on `purchase_history` for time-weighted store routing.
- **RPCs**: `mark_item_bought(p_entry_id)` is the canonical write path for purchase events (atomic delete from `list_entries` + insert into `purchase_history`); `create_household_with_owner` provisions household + owner-membership atomically at signup. Chapter 1m (migration 015) adds 7 SECURITY DEFINER RPCs for collaboration: `is_household_owner` (helper used by the others' policy checks), `create_invite` / `revoke_invite` (owner-only), `accept_invite` (uses `select … for update` on the invitation row so Postgres EPQ semantics serialize concurrent accepts — load-bearing single-use guarantee, sentinel-commented + pinned by a pure-file unit test), `remove_member` / `leave_household` (with owner-cannot-leave + cannot-orphan-household guards), `rename_household` (1-60 char name validation).
- **Realtime publication**: `list_entries` is in `supabase_realtime` (migration 013) so cross-session updates work. Newer Supabase CLIs don't auto-include all tables; explicit add is mandatory.

## Data flow

### Add-item flow (the core capture path)

1. User types into `AddItemSheet` (`apps/web/components/AddItemSheet.tsx`). Form submit calls `invokeAddItem(client, { utterance, household_id })` from `@lalista/core`.
2. `invokeAddItem` calls `client.functions.invoke<unknown>('add-item', { ... })` → Supabase routes to the deployed `supabase/functions/add-item` edge function.
3. Edge function: validates JWT → calls Claude (NLP) + pg_trgm match (parallel) → either returns `{ entry_id, canonical_item, store, ... }` (silent insert) or `{ needs_followup: true, followup_type, followup_options }` (disambiguation needed).
4. Client `safeParse`s response against `AddItemResponseSchema`. On schema drift → `AddItemValidationError` thrown, captured by `apps/web/lib/reportAddItemValidationError.ts` → Sentry, with raw payload truncated.
5. On silent-insert path: row already in DB; Realtime broadcasts to every subscribed session; `ListClient` re-renders.
6. On disambig path: client opens `DisambiguationSheet` with the candidates; user picks → `invokeAddItem` re-fires with the chosen `candidate_item_id` or `force_create_with_label`.

### Mark-bought flow

1. User taps a row → routes to `/item/[id]`.
2. `RemoveEntryButton` (or "Mark bought") calls `markItemBought(client, entryId)` from `@lalista/core` → `client.rpc('mark_item_bought', { p_entry_id: entryId })`.
3. Postgres RPC atomically deletes from `list_entries`, inserts into `purchase_history`. RLS on both tables enforces household membership.
4. Realtime broadcasts the delete to every subscribed `list_entries` session → list view updates everywhere.

### Auth flow

1. `/sign-in` calls `signInWithPassword` and routes to `/onboarding` on success; failures map to friendly copy via `friendlyAuthError`. New accounts go through the dedicated `/sign-up` screen instead, which renders `<AwaitingConfirmationCard email={...} />` until Supabase fires `SIGNED_IN` post-link-click. `/forgot-password` calls `resetPasswordForEmail` (no-enumeration — never inspects the response shape) and `/reset-password` finalizes via `updateUser({ password })` then routes to `/list`. `/auth/callback` is the server-side route handler at `apps/web/app/auth/callback/route.ts` that calls `exchangeCodeForSession(code)` and redirects (recovery → `/reset-password` ALWAYS, even with a pre-existing session per spec D10; signup → `/onboarding`; failures → `/sign-in?reset-error=expired` or `?confirm-error=expired`). All four `(auth)` screens share an `AuthEmailProvider` context so the typed email survives intra-flow navigation without query-param leaks.
2. New users are auto-provisioned with a `profiles` row via the `handle_new_user` trigger (migration 012) and a household via `create_household_with_owner` RPC.
3. Authenticated user landing on `/` is redirected server-side to `/list` via `apps/web/app/page.tsx` (`supabase.auth.getUser()` + `redirect()`).

### Invite flow (chapter 1m / migration 015)

1. Owner taps `/settings → Members → "invite someone"` → `create_invite` RPC mints a single-active token (revokes any prior unused invite for the same household). `<InviteLinkSheet>` opens with copy + Web-Share buttons. URL: `${siteUrl}/join/<token>`.
2. Recipient taps the link. **Signed-out**: middleware allows `/join/<token>` through; `<JoinClient>` redirects to `/sign-up?invite=<token>`. The `signUpWithPassword(…, inviteToken?)` 5th-positional arg sets `options.emailRedirectTo = ${siteUrl}/auth/callback?invite=<encoded-token>` so the token survives Supabase's email-confirmation gap. `<AwaitingConfirmationCard>` surfaces "you're joining {household name}" while the user clicks the email link in another tab.
3. The email's confirm link bounces through `/auth/callback?invite=<token>` (`apps/web/app/auth/callback/route.ts`) which `exchangeCodeForSession`s, then redirects to `/join/<token>` (instead of the default `/onboarding`). Server-rendered `/join/[token]` runs `accept_invite(token)`. Success → `/list`. Six failure states render colocated cards: `<InviteExpired>`, `<InviteUsed>`, `<AlreadyInHousehold>`, `<OwnInviteLink>`, `<LastMemberLeft>`, `<InviteUnavailable>` (deploy-race window between the Worker front-end deploy and `deploy-migrations.yml` apply).
4. **Signed-in** recipient (different account): same `/join/<token>` route runs `accept_invite` directly. Single-household v0 invariant means a user already in another household sees `<AlreadyInHousehold>` instead of silent membership swap.
5. `/list` becomes household-aware: `fetchListEntries` returns `{entries, currentHouseholdId}`; if the caller's `currentHouseholdId` is null mid-session (member was removed by owner), the API throws `RemovedFromHouseholdError`, the route catches it, the user lands on `/onboarding?removed=1` with `<RemovedFromHouseholdNotice>`. The header gains a household-name caption that subscribes once at page-load — `households` is intentionally NOT in `subscribeToList`'s realtime publication; rename shows on next nav (D6 leak-window mitigation).
6. Audit feed: every state-change RPC writes a `household_audit_events` row. `<HouseholdAuditSection>` (collapsed by default with chevron disclosure) hydrates `actor_user_id` + `target_user_id` to display names via a 2-query read (audit rows → distinct user IDs → `profiles.in()`), with `'someone'` fallback for deleted users — same pattern as `addedByName` for `list_entries`.

## External dependencies

| Service                      | Role                                          | Credentials                                                                                      | Configured in                                               |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Supabase Auth                | sign-up / sign-in / session JWT               | anon JWT (public), service-role (CI local-stack only — NEVER in prod CI)                         | `apps/web/.env.local`, GH `production` environment          |
| Supabase Postgres + Realtime | data plane + WebSocket for cross-session sync | anon JWT for queries (RLS gates writes), DB password for migrations (operator-side, JIT)         | `apps/web/.env.local`, GH Variables                         |
| Anthropic Claude API         | NLP normalization in `add-item` edge function | `ANTHROPIC_API_KEY_QA` (CI + local), `ANTHROPIC_API_KEY_PROD` (prod-only, console.anthropic.com) | GH Secrets, `.devcontainer/.env`, `supabase/functions/.env` |
| Sentry                       | error capture + tracing                       | DSN (public), auth token (CI sourcemap upload)                                                   | `apps/web/sentry.*.config.ts`, `instrumentation.ts`         |
| PostHog                      | product analytics                             | project key (public)                                                                             | `apps/web/app/providers.tsx`                                |
| Cloudflare Workers           | hosts the Next.js app (OpenNext build)        | API token, Workers Scripts Edit only (CI deploy job)                                             | `apps/web/wrangler.jsonc`, GH `production` environment      |

## Deployment topology

| Surface                 | Where                   | Trigger                                         | Workflow                                  |
| ----------------------- | ----------------------- | ----------------------------------------------- | ----------------------------------------- |
| Next.js web app         | Cloudflare Workers      | Auto on push:main (no per-PR previews yet)      | `.github/workflows/ci.yml` `deploy` job   |
| Supabase migrations     | Supabase Postgres       | Auto on push:main when `supabase/migrations/**` | `.github/workflows/deploy-migrations.yml` |
| Supabase edge functions | Supabase Edge Runtime   | Auto on push:main when `supabase/functions/**`  | `.github/workflows/deploy-functions.yml`  |
| Supabase auth config    | Supabase Auth dashboard | Manual                                          | dashboard / Management API                |

CI: two-job split in `.github/workflows/ci.yml`. **fast** (every push) — lint + typecheck + unit tests + build + gitleaks. **slow** (PR-to-main only, gated on fast) — brings up local Supabase stack, runs migrations + integration tests + Playwright × 2 viewports (against the Worker build, in wrangler's local Workers runtime) + edge-function deploy + type-drift + rollback EXPLAIN. **deploy** (push:main only, `production` environment) — `scripts/deploy.sh`.

## Module map

| Directory              | Purpose                                           | README                                                       |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `apps/web/`            | Next.js 15 web app                                | [README](./apps/web/README.md)                               |
| `packages/core/`       | Supabase client, API wrappers, types, schemas     | [README](./packages/core/README.md)                          |
| `packages/ui/`         | Design tokens + primitive components              | [README](./packages/ui/README.md)                            |
| `supabase/migrations/` | Schema + RLS + RPC SQL                            | (no per-package README — see CLAUDE.md § Migration Workflow) |
| `supabase/functions/`  | Edge functions (`add-item` only today)            | [README](./supabase/functions/README.md)                     |
| `.github/workflows/`   | CI fast/slow + auto-deploy migrations + functions | (see CLAUDE.md § CI/CD)                                      |

## Where to look next

- [OVERVIEW.md](./OVERVIEW.md) — what the product does, who uses it, which flows
- [CLAUDE.md](./CLAUDE.md) — always-loaded entry point with `§ Where Things Happen` path map and `§ Gotchas`
- [BUILD-LOG.md](./BUILD-LOG.md) — what has shipped, in chronological order
- [PLAN.md](./PLAN.md) — what's being built right now
- Per-package READMEs ([apps/web](./apps/web/README.md), [packages/core](./packages/core/README.md), [packages/ui](./packages/ui/README.md), [supabase/functions](./supabase/functions/README.md)) — module-level detail
