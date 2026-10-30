<!-- Product-level overview. For the system view (architecture, data flow, deployment),
     see ARCHITECTURE.md. Authoring rules: kit/docs/guide/conventions.md § Project Docs Hierarchy. -->

# OVERVIEW: lalista

> Voice-first bilingual grocery list app for families. Add items hands-free in any mix of English and Spanish, organized by household, with smart matching against your purchase history. For the system view (architecture, data flow, deployment), see [ARCHITECTURE.md](./ARCHITECTURE.md).

## What this is

lalista is a shared grocery list that's optimized for the moment a family member realizes they need something — often mid-activity, in front of the fridge, or while cooking. The cost of capturing that thought needs to be near zero, or the habit doesn't form. The app accepts items in either language (and mixed within a single phrase, "spanglish"), normalizes them against a shared catalog of things the household actually buys, and routes the list by household so everyone sees the same view in real time.

The product's "whoa" moment: someone in the kitchen says "add shredded mozzarella," it lands on the shared list within a second, the partner at the store sees it appear, picks it up, marks it bought — and over time the app learns that this household buys Kirkland's 3-pack from Costco, so subsequent adds get smarter without being asked.

## Who uses it

- **Bilingual families** — primary users. Multi-generational households where some members speak primarily Spanish and others primarily English; the list has to work for both without translation discipline.
- **Couples / shared-household roommates** — secondary. The "shared list everyone can edit" pattern works whenever the friction is "who has the list right now."
- **Solo users with multiple stores** — the store-routing brain still earns its keep when one person shops at three different places weekly.

## Core flows

These are the verbs the product supports today (web app at [lalista.store](https://lalista.store)):

- **Sign in / sign up**: split surfaces post-chapter-1l. `/sign-in` for returning users (email + password); `/sign-up` for first-timers — Supabase emails a confirmation link, the AwaitingConfirmationCard hard-gates with a 60s resend countdown until the user clicks the link in another tab and Supabase fires `SIGNED_IN`. New users land on `/onboarding` once a household is provisioned.
- **Forgot / reset password**: `/forgot-password` sends a reset link with no-enumeration semantics (success copy renders regardless of whether the email is registered) plus a 60s visible-countdown resend. The user follows the link, lands on the server-side `/auth/callback` handler which exchanges the magic-link code for a session, and is redirected to `/reset-password` (ALWAYS, even if a session was already present — recovery doesn't bounce to `/list`). `/reset-password` finalizes a new password and lands the user on `/list`. All four `(auth)` screens share a layout-scoped email context that persists the typed email across intra-flow navigation.
- **Add item**: type a phrase ("leche de almendras", "shredded mozzarella", "papas costco") into the AddItemSheet. The Claude-powered edge function parses spanglish to a canonical item; pg_trgm fuzzy-matches against the household's existing items; if multiple candidates score close, a DisambiguationSheet asks the user to pick. Optimistic insert + Supabase Realtime broadcast — other household members see the row appear within ~100ms.
- **View the list**: `/list` shows pending items grouped by store (StoreSection rows). Each row carries the item name, quantity, brand hint, who added it, and when. Realtime subscription keeps it live across sessions.
- **Mark bought**: tapping a row opens `/item/[id]`; "Mark bought" calls the `mark_item_bought` RPC, which atomically deletes the list_entries row and inserts a purchase_history row. The list updates in real time for everyone in the household.
- **See item detail**: `/item/[id]` shows full add-time metadata + who added it (with "added by someone" fallback when the original adder's account was deleted).
- **Invite someone to your household**: `/settings` → Members → "invite someone" mints a 7-day single-use token and opens an `InviteLinkSheet` with copy + Web-Share buttons. The recipient taps the link, is bounced through `/sign-up?invite=<token>` if unauthed (preserving the token across the email-confirmation gap via Supabase's `emailRedirectTo`), and `/join/[token]`'s server flow runs `accept_invite` to land them on the shared list. The 7-step decision tree handles expired tokens, used tokens, the inviter clicking their own link, and the cross-household-impersonation case. Owner-only "remove member" + member-only "leave household" round out the lifecycle. Every state-change writes a `household_audit_events` row that surfaces in Settings → Activity.
- **Manage profile**: `/settings` shows the household + a display-name editor. Updates flow through `profiles.updateMyProfile` and reflect in the list view's "added by" labels.
- **Sign out**: from `/settings`, returns the user to `/` (public landing).

## Features

### Capture (in scope today)

- Type-based item add via AddItemSheet
- Bilingual input (English, Spanish, spanglish) — Claude NLP normalizes to a canonical English item name
- Fuzzy matching against household catalog via pg_trgm GIN index
- Disambiguation prompt when match is ambiguous; force-create available when the catalog miss is intentional
- Runtime validation (Zod) at the edge-function boundary — schema drift surfaces in Sentry, not as a silent crash

### Organization

- Per-household scoping: every list entry, item, and purchase history row carries `household_id`; RLS enforces "only members of the household can read/write"
- Store routing: items render grouped by `stores.name` (Costco, Walmart, ...) — store choice is captured at add-time
- Real-time list sync via Supabase Realtime (`list_entries` is in the `supabase_realtime` publication) — cross-session updates arrive within ~100ms

### Trust & safety

- Auth-validated insert: every `add-item` edge-function call validates the JWT before writing
- RLS on every household-scoped table; `mark_item_bought` is the only path to write `purchase_history` (RPC, security-invoker, atomic)
- Display-name editing is the only profile mutation; identity rests on Supabase Auth

### Out of scope today (deferred to PRODUCT-ROADMAP)

- Voice capture (Siri / web speech) — design assumed Siri but v0 ships text-input web only; voice is v1
- Cart automation (Playwright + Claude API auto-populating Costco/Walmart carts) — v1, deferred
- Brand preferences / store-routing intelligence beyond add-time selection — v1
- Multi-household support (a user belonging to two households) — single-household v0; v1+
- Mobile app (Capacitor or native) — web-only today, mobile is v1+
- Apple Watch / HomePod — v2+

## Where to look next

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how it's built, components, data flow, deployment topology, module map
- [PLAN.md](./PLAN.md) — what's being built right now (Active + Planned PRs)
- [PRODUCT-ROADMAP.md](./PRODUCT-ROADMAP.md) — long-term / deferred features (voice, cart automation, multi-household, mobile)
- [BUILD-LOG.md](./BUILD-LOG.md) — what has shipped, in chronological order
- [CLAUDE.md](./CLAUDE.md) — agent-facing entry point with `§ Where Things Happen` path map and `§ Gotchas`
- Per-package READMEs ([apps/web](./apps/web/README.md), [packages/core](./packages/core/README.md), [packages/ui](./packages/ui/README.md), [supabase/functions](./supabase/functions/README.md)) — module-level detail
