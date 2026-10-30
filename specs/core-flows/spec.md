<!-- gstack-plan: .gstack/projects/meirmsn-lalista/node-main-design-20260318-233437.md -->
<!-- generated-by: /devshop:spec -->
<!-- date: 2026-04-21 -->

# Spec: core-flows (PR 3)

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1e` — primary scope (screens, migration 009, new metric events, open decisions)
- `.gstack/projects/meirmsn-lalista/node-main-design-20260318-233437.md` — screen-by-screen design reference (Swift)
- `.gstack/projects/meirmsn-lalista/node-main-test-plan-20260319-170551.md` — test plan + edge cases
- `DESIGN.md` — token map, motion, aesthetic
- `CLAUDE.md § Gotchas` — Tailwind `@source`, `mark_item_bought` RPC, `subscribeToList`
- Prior spec `specs/auth/spec.md` — style + structure reference (follow this shape)

PR 2 (auth) shipped email/password sign-in + household onboarding + route-protection middleware. PR 3 turns the placeholder home page at `/` into the full lalista experience: a grouped-by-store list, an add-item flow with disambiguation, item detail, settings with sign-out, a sync error banner, and the supporting design-system wiring (theme bootstrap, information architecture). `@lalista/core` already exports every API wrapper we need (`fetchListEntries`, `markItemBought`, `deleteListEntry`, `invokeAddItem`, `subscribeToList`, `fetchStores`, `signOut`). This PR is mostly UI + one small migration.

---

## Core user story

1. Sign in to the household and land on the grouped-by-store list.
2. Open the add-item sheet, type a single-canonical-match utterance ("Tilapia"), submit, pick a store from the disambiguation prompt, and see the new entry appear in the list.
3. Open the add-item sheet, type an ambiguous utterance ("leche"), pick "Leche lactaid" from the item disambiguation prompt, pick a store from the cascading store disambiguation prompt, and see the new entry appear in the list.
4. Tap the buy button on the newly-added Tilapia row and see it fade out and disappear from the list.

Each verb produces a `specs/core-flows/qa-walk/verb-<N>-<slug>.png` artifact captured by `apps/web/e2e/core-flows-qa-walk.spec.ts`. `/ak-pre-ship` Gate 9's `preship-verify-story.sh verify-all` blocks if any verb's artifact is missing — the rule exists because the original PR-3 walk reported `pass` after only opening the add-sheet and pressing Escape, masking the cascading-disambig bug user-reported on PR 15. Verb 3 in particular exercises the full item→store cascading-disambig path that `dc4c9f2` fixed; verbs 2 and 3 both rely on store disambig because `purchase_history` (which drives auto store routing) is intentionally not seeded — the qa-walk runs against a fresh household with no purchase history.

---

## Decisions (resolved at spec time)

Seven `/ak-spec`-time decisions were called out in `PRODUCT-ROADMAP.md § 1e`. Resolved below, in order:

### D1. ThemeProvider in PR 3 (Option A)

**Decision:** ship a `ThemeProvider` client component in `app/layout.tsx` as part of this PR. Read `prefers-color-scheme`, add `.dark` to `<html>` when dark. No user-facing theme toggle (deferred).

**Rationale:** `globals.css` already defines the full dark-mode token set under `.dark`. Wiring is a ~20-line client component. Option B (`.skip()` with TODO) creates a test debt and a second PR just to finish the feature. The task size is trivial; defer only if wiring is painful, which it isn't.

### D2. Add-item surface: FAB (terracotta pill) — NOT a sticky input bar

**Decision:** floating action button, bottom-right, terracotta pill with `[+ Add]` label. Matches Swift's in-app add entry point.

**Rationale:** Swift reference uses a FAB for good reasons that carry to web:

- The list is the primary content; anchoring add to the footer steals 56px of list height for a control used once per session.
- `position: fixed; bottom: 24px; right: 24px; padding: 14px 20px; border-radius: 100px; background: primary; color: white` is already specified in `DESIGN.md § Design System Token Map`.
- On mobile, bottom-right avoids occluding the last-tapped list row (thumb reach model).
- A sticky input bar encourages premature commitment — users tap the FAB → sheet opens → they can cancel cheaply.

Implementation: the FAB opens a **bottom sheet** (the add-item sheet, D3). No inline field on the list view.

### D3. Disambiguation sheet UI: bottom sheet (radio list) — matching Swift parity

**Decision:** `role="dialog"` modal presented as a bottom sheet on mobile and a centered card on desktop. Radio-button options, terracotta selected-state dot, single "Confirm" CTA + "Cancel".

**Rationale:**

- Swift `DisambiguationSheet.swift` is the reference design; using the same pattern on web keeps the UX consistent when the Swift app is resurrected for v+ native.
- Inline dropdown would compress the store/brand options into a `<select>` and lose the terracotta radio styling that gives the moment personality.
- Modal is the same DOM primitive as bottom-sheet — on mobile (`md:` breakpoint and below) it renders flush to bottom; on desktop it renders centered. One component, two layouts, zero duplication.
- Same sheet handles all four `followup_type` variants (`store`, `item`, `brand`, `quantity`) via generic radio-list shape — the server sends `followup_options[]` with `{id, label}`.

### D4. METRICS.md events (5 new events — applied)

**Decision:** all 5 new events from `PRODUCT-ROADMAP.md § 1e` adopted as-specified and added to `METRICS.md` in the same change that lands this spec. No interactive confirmation available in this subagent context; events are already fully defined in the roadmap source with properties and fire-conditions, so adopting them verbatim is the lowest-risk path.

**Events:** `item_added`, `item_bought`, `disambiguation_shown`, `store_routed`, `error_displayed`. See `§ Metrics` below for the canonical definitions and call-site plan.

**Note to reviewer:** if this adoption is wrong, the fix is a one-commit revert of the `METRICS.md` edit in this spec's commit range. None of the 5 events are load-bearing for shipping; instrumentation can be added or removed without touching feature code. Flagging explicitly so a senior reviewer can override without blocking.

### D5. Sign-out surface: Settings page only (not header/menu)

**Decision:** "Sign out" lives in `apps/web/app/settings/page.tsx` as a destructive-styled button under an `ACCOUNT` section. No header dropdown, no avatar menu on the list view.

**Rationale:**

- v0 is single-household, single-device-per-user. Users don't sign out routinely; Settings → Sign out is the traditional iOS/HIG home for this (reflects the Swift settings mock in the design doc).
- Adding an avatar-menu header widens the surface area of the list view and raises visual-regression risk on the 4-combo matrix.
- The existing list-view header (if any) ships with just the app mark + a settings gear icon, matching Swift.

Sign-out flow: `signOut(client)` → client-side redirect to `/sign-in` (middleware will redirect authed requests back there too, so a manual push is belt-and-suspenders).

### D6. PR 3 close-out gates: 6 screens get the 4-combo matrix

**Decision:** the four-combo matrix (`375 × 1440` × `light × dark`) covers **6 screens** (updated for D7's public landing):

1. Public landing (`/` unauth) — added in D7.
2. List view (loaded, ≥1 item in ≥1 store).
3. List view (empty state — "la lista está vacía").
4. Add-item bottom sheet (open state).
5. Item detail.
6. Settings.

**Excluded from the matrix** (one-combo spot-check only — either trivial or transient):

- Disambiguation bottom sheet — same skeleton as add-item sheet. Spot-check store-type variant in light mode only. Any spacing regression would surface on the add-item sheet anyway.
- Sync error banner — stateful overlay; cover it in unit + E2E, not 4-combo snapshots.
- Loading skeletons — transient, not UX-critical visual state.

Rationale: 4 combos × 6 screens = 24 screenshots — still within what a human reviewer can scan in one pass. The landing page is simple but is the **first impression** for every new user, so it earns its slot in the matrix.

### D7. Information architecture: public `/` landing + authed `/list` home (roadmap proposal adopted)

**Decision:** Adopt the roadmap's proposal. `/` becomes a public landing page (wordmark + tagline + "Get started" CTA → `/sign-in`). The authed list view moves to `apps/web/app/list/page.tsx`. Authed users hitting `/` are redirected server-side to `/list` via a **Server Component `getUser()` + `redirect()`** pattern (same technique already used by `apps/web/app/(auth)/onboarding/page.tsx`). Stale-token recovery stays with middleware: when middleware's `getUser()` fails on an authed route, it redirects to `/sign-in?next=<path>` (existing behavior).

**Rationale:**

- The "unreachable wordmark" bug on the placeholder becomes a permanent IA question once the list view ships at `/` — unauth users would never see the app mark. Public landing solves this cleanly and is the roadmap's intended v0 endpoint.
- RSC redirect is the canonical Supabase + Next.js App Router pattern (see `@supabase/ssr` docs). Already used by `onboarding/page.tsx`. Middleware stays focused on "block unauth from authed routes"; the `/` page owns its own "if authed, go to /list" decision.
- RSC redirect avoids the **flash-of-landing** problem a client-side token check would cause: the redirect fires server-side before HTML is sent. No async Supabase client init on the client.
- React Native port: no regression — RN has no "public landing" concept; native apps check session client-side at boot and navigate, independent of web routing. `@lalista/core` (the shared layer) is untouched by this IA change.

**Routing matrix after this PR:**

| Path          | Unauth                                             | Authed (has household)                                                              | Authed (no household)                                           |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/`           | Render landing                                     | RSC `redirect('/list')`                                                             | RSC `redirect('/list')` → `/list` RSC `redirect('/onboarding')` |
| `/list`       | Middleware `redirect('/sign-in?next=/list')`       | Render list view                                                                    | RSC `redirect('/onboarding')`                                   |
| `/item/[id]`  | Middleware `redirect('/sign-in?next=/item/…')`     | Render item detail                                                                  | RSC `redirect('/onboarding')`                                   |
| `/settings`   | Middleware `redirect('/sign-in?next=/settings')`   | Render settings                                                                     | RSC `redirect('/onboarding')`                                   |
| `/sign-in`    | Render sign-in                                     | Middleware `redirect('/onboarding')` (which bounces to `/list` if household exists) | Middleware `redirect('/onboarding')`                            |
| `/onboarding` | Middleware `redirect('/sign-in?next=/onboarding')` | RSC `redirect('/list')`                                                             | Render onboarding form                                          |

**Public landing content** (minimal v0):

- `lalista` wordmark in Fraunces `heading-xl` (48px desktop, 36px mobile), centered.
- Tagline in `body-lg text-text-secondary` — one bilingual line, e.g. "lista de compras / grocery list — by voice, together". Final copy deferred to implementation; must match DESIGN.md tone.
- Single terracotta CTA `<Button>` → "Get started" → `/sign-in`.
- No marketing sections, no feature grid, no testimonials. One-screen, centered, fast.

**PWA manifest change:** update `apps/web/public/manifest.json` `start_url` from `/` to `/list`. Rationale: installed PWA users are committed users; launching the installed app should skip the marketing landing and go straight to the list (or bounce through auth if the session expired). Saves one roundtrip per PWA launch. Unauth PWA launches still work — middleware redirects `/list` → `/sign-in?next=/list`.

---

## In scope

### Migration

- **`supabase/migrations/009_fk_cascades_on_delete_user.sql`** — ships **FIRST**, before any add-item write paths. Converts `list_entries.added_by` and `purchase_history.added_by` to `ON DELETE SET NULL`, making both columns nullable.

  ```sql
  -- 009_fk_cascades_on_delete_user.sql
  -- Rationale: added_by is audit data; preserving the row with unknown attribution
  -- beats deleting history when a user leaves. Also prevents the "Database error
  -- deleting user" UX in the Supabase dashboard.
  -- Pairs with devshop conventions.md § Supabase Hardening Defaults § ON DELETE rule.

  alter table list_entries
    alter column added_by drop not null;
  alter table list_entries
    drop constraint list_entries_added_by_fkey;
  alter table list_entries
    add constraint list_entries_added_by_fkey
      foreign key (added_by) references auth.users(id) on delete set null;

  alter table purchase_history
    alter column added_by drop not null;
  alter table purchase_history
    drop constraint purchase_history_added_by_fkey;
  alter table purchase_history
    add constraint purchase_history_added_by_fkey
      foreign key (added_by) references auth.users(id) on delete set null;

  -- ROLLBACK:
  -- alter table list_entries drop constraint list_entries_added_by_fkey;
  -- alter table list_entries alter column added_by set not null;
  -- alter table list_entries add constraint list_entries_added_by_fkey
  --   foreign key (added_by) references auth.users(id);
  -- alter table purchase_history drop constraint purchase_history_added_by_fkey;
  -- alter table purchase_history alter column added_by set not null;
  -- alter table purchase_history add constraint purchase_history_added_by_fkey
  --   foreign key (added_by) references auth.users(id);
  -- NOTE: rollback only works if no rows with NULL added_by have been written.
  ```

  Downstream code impact:
  - `packages/core/src/supabase.types.ts` — regenerate; `list_entries.added_by` and `purchase_history.added_by` become `string | null`.
  - `packages/core/src/models/index.ts` — `HydratedListEntry.addedBy` becomes `string | null`.
  - `fetchListEntries` in `items.ts` — no code change; returned field just becomes nullable.
  - `subscribeToList` in `realtime.ts` — no code change.
  - Edge function `supabase/functions/add-item/index.ts` — no change; insert sets `added_by = user.id` (always non-null at write time).
  - List row UI — must render "added by someone" when `addedBy` is null (ties in naturally with the existing `posted-by-someone` TODO). Spec-level note: keep this fallback subtle (text-tertiary, italic) rather than loud.

### Theme bootstrap

- **`apps/web/components/ThemeProvider.tsx`** — client component. On mount: read `window.matchMedia('(prefers-color-scheme: dark)')`; if match, add `dark` class to `document.documentElement`; subscribe to `change`; cleanup on unmount. No user toggle. Mount once from `app/layout.tsx` wrapping `{children}` (inside `<Providers>` is fine; outside is also fine — placement is a no-op test-wise).

### Screens

#### Screen 1: List view — `apps/web/app/list/page.tsx` (new authed home)

- **Layout**: full-viewport, `bg-background`. Top masthead (`lalista` wordmark in `heading-lg` Fraunces, settings gear icon top-right linking to `/settings`). Below: a scrollable grouped list. Fixed FAB bottom-right.
- **Data flow**:
  - Server component shell: resolves the authenticated user + their household ID via `@supabase/ssr` server client + `fetchUserHouseholds`. If no household: `redirect('/onboarding')` (authoritative gate — middleware doesn't query the DB). Hands `householdId` down to a client subcomponent `<ListClient />`.
  - `<ListClient />` (client component):
    - `useState<HydratedListEntry[]>` for the live list.
    - `useEffect` on mount: call `fetchListEntries(client, householdId)` once → populate state.
    - Second `useEffect` on `householdId`: call `subscribeToList(client, householdId, onChange)` → in `onChange`, diff INSERT/UPDATE/DELETE payloads against state (merge by `id`). Return the cleanup from the outer effect.
    - Third `useEffect` on the channel: if the Realtime channel errors (status `'CHANNEL_ERROR'` or `'TIMED_OUT'`), flip a `syncError: 'realtime' | 'query' | null` state and let the sync-error banner render.
  - Grouping: derive `entriesByStore` via `Array.from(Map)` keyed by `storeId`, values `{storeName, entries: HydratedListEntry[]}`. Empty store sections are omitted entirely (no "COSTCO — 0 items" placeholder).
- **Row anatomy** (three-level hierarchy from Swift spec):
  1. Item name — `text-base font-medium text-text-primary` (Plus Jakarta Sans 500).
  2. Brand + `·` + quantity + unit — `text-caption text-text-secondary`. Omit empty fields; show `· 1 unit` if no brand and quantity is 1 (Swift convention).
  3. Added-by line — `text-caption text-text-secondary` (NOT tertiary — WCAG AA). Fallback copy: `added by someone` when `addedBy` is null.
- **Interactions**:
  - Tap anywhere on the row except the buy button → navigate to `/item/[id]`.
  - Tap buy button (circle icon left of the row, 44×44 touch target) → optimistic: grey out row + call `markItemBought(client, entryId)`. On resolve: trigger fade-out animation (`transition-opacity duration-short`) then remove from local state. Realtime DELETE event arrives within ~500ms — the diff logic reconciles cleanly (already-removed entries are no-ops). On error: restore row, render an inline error toast "Couldn't mark bought — try again".
  - Swipe-to-delete on mobile (optional; ship the long-press fallback instead for v0 since web-native swipe-to-delete is a large dependency). **Decision**: defer swipe. Row has a secondary "X" button on mobile long-press → calls `deleteListEntry`. In desktop, right-click context menu or a visible ⋯ button on hover. Spec this as a **menu button** in the upper-right of each row (icon-only, visible always on desktop, visible on tap on mobile via a 3-dot) triggering a small popover with "Mark bought" and "Remove". This keeps the UI accessible without needing a custom swipe library in v0.
- **Store section header**: `text-[11px] font-semibold uppercase tracking-wide text-text-secondary` + right-aligned item count in `text-caption text-text-tertiary`. 1px `border-border` separator above each section.
- **FAB**: `fixed bottom-6 right-6 z-10 bg-primary text-white rounded-[100px] px-4 py-3.5 text-base font-medium shadow-lg`. Label: "+ Add". Tap opens `<AddItemSheet />`.
- **States**:
  - Loading: render 3 skeleton rows (each ~72px tall, `bg-surface-2` animated pulse).
  - Empty: if `entries.length === 0` after load, render empty-state block — `display-italic` Fraunces 36–48px "la lista está vacía" + body-lg text-secondary "(the list is empty)" + "Add your first item" terracotta button centered. Empty state never hides the FAB.
  - Error (initial load): inline card with "Couldn't load your list" + Retry button (retries `fetchListEntries`).
- **Acceptance criteria**:
  - [ ] With 3 entries across 2 stores, rows group correctly, each store header shows the count, and empty stores are not rendered.
  - [ ] Tapping the buy button fades the row out within 300ms on happy path and renders the error toast on RPC failure.
  - [ ] A second tab adding an entry via the edge function causes this tab's list to update within ~2s (Realtime verified in E2E or manual).
  - [ ] Channel error surfaces the sync-error banner; banner is dismissible and re-appears on the next failure.
  - [ ] Empty state copy uses Fraunces italic; FAB is visible in empty state.
  - [ ] Dark mode: verified at 375 × 1440 in the close-out matrix.

#### Screen 2: Add-item FAB sheet — `apps/web/components/AddItemSheet.tsx`

- **Invocation**: a client component rendered inside `<ListClient />`, controlled by `open` state. Portal to `document.body` (React `createPortal`) to escape the list stacking context.
- **Layout**: on mobile (`<= md`), bottom sheet — `position: fixed; bottom: 0; left: 0; right: 0; rounded-t-[20px]; bg-surface; p-lg`. On desktop, centered card (`max-w-md` = ~28rem, `rounded-[20px]`). One component, conditional classes.
- **Content**:
  - Heading "Add to lalista" (`heading-md` Plus Jakarta Sans 600).
  - `<Input>` — text field, autofocus, placeholder "What do you need?", `aria-label="Item to add"`. `onChange` → local state.
  - Footer: Cancel button (`text-text-secondary`, ghost) + Add button (terracotta, pill). Add button disabled while input is empty OR request is in-flight.
- **Submit flow** (happy path):
  1. User types "mozzarella" → taps Add.
  2. Component calls `invokeAddItem(client, { utterance: input, householdId })`.
  3. Response with `needs_followup === false`:
     - Close the sheet.
     - Fire `store_routed` PostHog event if `response.store.name` is present.
     - Fire `item_added` PostHog event.
     - Render a `<ConfirmationToast />` — bottom-anchored, 3s auto-dismiss, reads "Added {item} to {store}" (store from response; item from `canonical_item.name`). Matches Swift toast styling.
     - Realtime INSERT arrives via `subscribeToList` and reconciles the list.
  4. Response with `needs_followup === true`:
     - Close the add-item sheet.
     - Open `<DisambiguationSheet />` with the response payload + original utterance.
     - Fire `disambiguation_shown` PostHog event.
  5. `already_on_list === true` + `followup_type === 'quantity'`: treat as a special case in the disambiguation sheet — render a single-button confirm "Yes, increase quantity" (v0 doesn't actually resize; acknowledge + toast "Already on your list"). This is a design concession — true quantity-increase is deferred; but the server already routes this case.
- **Error flow**:
  - Network/500 error from `invokeAddItem`: keep sheet open, render inline red caption "Couldn't add. Check your connection and try again." Do NOT close the sheet so the user can retry.
  - Empty input: client-side block (button stays disabled).
- **Acceptance criteria**:
  - [ ] Sheet opens on FAB tap; input has focus; Escape or outside-click closes it.
  - [ ] Successful add closes sheet and shows toast; Realtime update lands in the list.
  - [ ] Disambiguation response opens the disambig sheet with the right `followup_type` + options.
  - [ ] Network error keeps the sheet open with inline error.
  - [ ] Dark mode rendering verified in the close-out matrix.

#### Screen 3: Disambiguation bottom sheet — `apps/web/components/DisambiguationSheet.tsx`

- **Shape**: mirrors the Swift `DisambiguationSheet.swift` structure:
  - Heading — the server's `followup_question` (e.g. "Which store?", "Which one?").
  - Radio list — one row per `followup_options[]` entry. Each row is a `<button role="radio" aria-checked>` with a 22px circle indicator (border) and a 12px terracotta inner dot when selected.
  - Footer: Cancel + Confirm (Confirm disabled until a radio is selected).
- **Confirm flow**: call `invokeAddItem` again with the follow-up answer in the right slot:
  - `followup_type === 'store'` → pass `{ utterance, householdId, candidateItemId: canonical_item?.id, confirmedStoreId: selectedOptionId }`.
  - `followup_type === 'item'` → pass `{ utterance, householdId, candidateItemId: selectedOptionId }`.
  - `followup_type === 'brand'` → pass `{ utterance, householdId, candidateItemId: canonical_item?.id, confirmedStoreId: response.store?.id, confirmedBrand: selectedOptionLabel }`.
  - `followup_type === 'quantity'` → no new call; just close (see "already on list" handling above).
- **Post-confirm**: on `needs_followup === false`, fire `item_added` + (if applicable) `store_routed`, show the toast, close sheet. On cascading follow-up (rare but the server can chain), re-render this sheet with new options; no separate UI.
- **Accessibility**: `role="dialog"` + `aria-modal="true"` on the container; initial focus on the first radio; Escape closes and treats as Cancel; radio buttons navigable with arrow keys (standard HTML radio-group semantics — use `<fieldset>` with actual `<input type="radio">` for simplicity if that styles cleanly; otherwise ARIA radios with arrow-key handling).
- **Acceptance criteria**:
  - [ ] Store variant: 3+ store options render as radios; selecting Costco then Confirm sends `confirmed_store_id` matching Costco's UUID.
  - [ ] Item variant: multiple item candidates render; selecting "Mozzarella (shredded)" then Confirm sends `candidate_item_id` matching that item's UUID.
  - [ ] Spot-check (one combo, light mode): matches Swift screenshot in `DESIGN.md § Disambiguation Bottom Sheet`.
  - [ ] Escape key closes sheet; state is not preserved between openings.

#### Screen 4: Item detail — `apps/web/app/item/[id]/page.tsx`

- **Layout**: a back link (← chevron + "back"), `heading-lg` Fraunces for the item name (matches Swift), then a two-column "attribute grid":

  | Label    | Value                                    |
  | -------- | ---------------------------------------- |
  | Store    | Store name                               |
  | Brand    | Brand or "—"                             |
  | Quantity | Quantity + unit                          |
  | Added by | user name or "someone" if `addedBy` null |
  | Added    | Relative time ("Today at 2:14 PM")       |

- **Data flow**:
  - Server component: resolves `{id}` from route params; fetches the entry via a targeted query (not `fetchListEntries` — add a helper `fetchListEntryById(client, entryId)` in `packages/core/src/api/items.ts` to keep this clean).
  - v0 is READ-ONLY per design doc. No edit actions.
  - "Remove from list" as a destructive action at the bottom — calls `deleteListEntry(client, entryId)` then `router.push('/list')`.
- **Out of scope here**: purchase history section from Swift mockups. Included as data in the schema but not rendered in v0 web — defer to future PR. (Open the door with a TODO comment in the file.)
- **Acceptance criteria**:
  - [ ] Navigating from a list row opens the correct entry's detail page.
  - [ ] Non-existent id → 404 page (Next default is fine).
  - [ ] Null `addedBy` renders "someone" without breaking layout.
  - [ ] Remove → returns to list view.
  - [ ] Dark mode verified in the close-out matrix.

#### Screen 5: Settings — `apps/web/app/settings/page.tsx`

- **Layout**: back link + `heading-lg` "Settings". Then three sections (`ACCOUNT`, `HOUSEHOLD`, "—" placeholder for STORES/members):
  - **ACCOUNT** section:
    - "Sign out" — `<Button variant="destructive">` (define `destructive` variant in the Button component as a light touch-up — `text-error` with no fill, or reuse existing `ghost` with `text-error` class if variants are not in scope to add). Click: call `signOut(client)` then `router.push('/sign-in')`.
  - **HOUSEHOLD** section (read-only in v0):
    - Household name (`text-body`).
    - `<Divider />`, then a muted "Manage members — coming soon" row (inactive, `text-text-tertiary`).
  - **STORES** section is **out of scope** for this PR. Show a muted "Coming soon" placeholder OR omit the section entirely. **Decision**: omit — fewer placeholders, less noise. Add comment linking to roadmap.
- **Data flow**:
  - Server component: gets `user` via `@supabase/ssr`; fetches household via `fetchUserHouseholds`. Passes props to a client subcomponent `<SignOutButton />` and `<HouseholdInfo />`.
- **Acceptance criteria**:
  - [ ] Sign out button signs the user out; next request (middleware) lands them at `/sign-in`.
  - [ ] `auth_signed_out` PostHog event fires with the correct `session_duration_seconds` (already wired in `providers.tsx`; verify unchanged).
  - [ ] Household name visible; sections render in the right order.
  - [ ] Dark mode verified in the close-out matrix.

#### Screen 6: Sync error banner — `apps/web/components/SyncErrorBanner.tsx`

- **Shape**: full-width amber bar pinned to the top of the list view (sticky inside the scrollable container). Copy: "Sync paused — tap to retry" (+ `✕` dismiss icon on the right).
- **Fire conditions**:
  - Realtime channel: when `subscribeToList`'s channel reports `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` unexpectedly → `setSyncError({ type: 'realtime' })`.
  - Query error: when `fetchListEntries` throws a network-class error (e.g. `TypeError` from fetch) → `setSyncError({ type: 'query' })`.
- **Dismiss**: clicking ✕ hides the banner. Re-fires on next error.
- **Retry**: tapping the bar itself (anywhere except ✕) calls the current retry handler (for realtime: rebuild the subscription; for query: re-run `fetchListEntries`).
- **Metric**: fires `error_displayed` once per error-instance (not once per re-render). Use a `useEffect` keyed on `syncError?.type` that fires when the value transitions from null → non-null.
- **Colors**: `bg-warning-bg text-warning` (already in tokens).
- **Accessibility**: `role="status" aria-live="polite"` — non-disruptive, but announced by screen readers.
- **Acceptance criteria**:
  - [ ] Killing the Supabase connection (E2E: block the websocket) surfaces the banner within 5s.
  - [ ] Tap-to-retry rebuilds the subscription (list resumes receiving events).
  - [ ] Dismiss persists until the next error.
  - [ ] `error_displayed` fires once per banner-show (not per render).

#### Screens 7–9: design-doc screens folded into above

The roadmap numbers 9 screens/concerns in `§ 1e`. The breakdown:

- 7. **Offline strategy** — already fully declared in `§ Offline behavior` below. No screen; informs error states in Screens 1–6.
- 8. **Theme auto-detection** — the `ThemeProvider` component (above). Has its own E2E test; no screen.
- 9. **Observability** — `METRICS.md` + wiring code. No screen.

So the five visible-UI screens are 1–5; the sync-error banner is screen 6; 7–9 are infrastructural. The close-out 4-combo matrix covers screens 1, 2, 3 (open-state), 4, 5 (see D6).

---

### API wrapper consumption (no new wrappers — one helper)

All core-flow data access goes through `@lalista/core`. Consume:

- `fetchListEntries(client, householdId)` — list view initial load.
- `markItemBought(client, entryId)` — buy action (RPC under the hood; never direct-insert to `purchase_history`).
- `deleteListEntry(client, entryId)` — remove action.
- `invokeAddItem(client, params)` — edge function call from add-item sheet + disambig sheet.
- `subscribeToList(client, householdId, cb)` — Realtime for list view.
- `fetchStores(client)` — fetched lazily inside disambig sheet when `followup_type === 'store'` and options aren't already in the response (server returns `followup_options[]` so we usually don't need this, but ship the call as a fallback).
- `signOut(client)` — settings sign-out.

**One new helper**: `fetchListEntryById(client, entryId): Promise<HydratedListEntry | null>` — add to `packages/core/src/api/items.ts`. A one-shot fetch by id with the same shape as `fetchListEntries`. Returns null on not-found (not throws) so the Next page can render a 404 cleanly.

### Design constraints (DESIGN.md frozen)

- Tokens only. No raw hex values anywhere. No new Tailwind custom values. Use `@lalista/ui` primitives: `Button`, `Text`, `Card`, `Input`, `Divider`. Add a Button "destructive" variant (scoped to `packages/ui/src/Button.tsx` — one prop, no structural change). If that's too invasive, use a plain `<button>` with `text-error hover:bg-error-bg` classes inside the Settings page and note the variant as a future Button API extension.
- Fonts: Fraunces only for the app mark (list view masthead) and empty-state tagline. Plus Jakarta Sans everywhere else.
- Motion: mark-bought fade uses `transition-opacity duration-short`; FAB ripple is free (no animation). Sheet enter animation: slide up from bottom on mobile (`translate-y-full → translate-y-0`, `duration-medium`), fade in on desktop.
- Border radii: screen shell `rounded-[36px]` for outer cards on desktop is a no-op — the viewport IS the card on mobile. Sheets `rounded-t-[20px]`. Cards `rounded-[12px]`. FAB pill `rounded-[100px]`.

### Middleware

- **One change: add `/` to the public allow-list.** Current middleware treats every path (except `/sign-in`) as auth-required. The new rule: `const PUBLIC_PATHS = new Set(['/', '/sign-in'])` — when unauth and `PUBLIC_PATHS.has(pathname)`, pass through. When authed and `pathname === '/sign-in'`, the existing `redirect('/onboarding')` branch stands. When authed and `pathname === '/'`, middleware does NOT redirect — the `/` RSC (`app/page.tsx`) handles the authed `redirect('/list')` itself. Keeps middleware simple, keeps the per-page decision co-located.
- The matcher pattern stays `'/((?!_next/static|_next/image|favicon.ico|manifest.json|icons).*)'` — already catches `/`, `/list`, `/item/*`, `/settings`, `/sign-in`, `/onboarding`. No DB queries in middleware (household check remains in the `/onboarding` RSC).
- **Redirect preservation**: when unauth users hit `/list` / `/item/*` / `/settings`, middleware preserves `?next=<path>` so sign-in bounces them back after auth. Already implemented — verify it carries through for the new `/list` path.

### Accessibility

- FAB `aria-label="Add item to lalista"` (not just "Add") — per Swift spec.
- List rows have a composed `aria-label` that reads "{item}, {brand}, {store}, added by {name}" as one announcement.
- Store section headers use `role="heading" aria-level={2}`.
- Toasts use `aria-live="polite"` — announced without stealing focus.
- Disambig radios use proper `role="radiogroup"` with arrow-key navigation.

---

## Out of scope

- Purchase history section on item detail (deferred — server returns `purchase_history` rows but UI shows just the active entry in v0).
- Editing item details (rename, store change, brand change). Per design doc: "voice re-add with correction is the edit model" → defer.
- Swipe gestures on list rows (use menu button instead; documented above).
- Stores management in Settings (toggle which stores are active). Deferred; use the schema's full list for now.
- Apple Sign-In on sign-in screen (already deferred in PR 2).
- Brand preferences UI in Settings (v1 feature per roadmap).
- Marketing content beyond the minimal landing (feature grid, testimonials, pricing) — v1+ per roadmap.
- Offline cache / `persistQueryClient` (v+).
- Real quantity-increase flow when `already_on_list` fires (spec-concession: ack and toast).
- Profile display name — ties in with `posted-by-someone` TODO; keeping "someone" as the fallback when `addedBy` is null after migration 009.
- Visual regression tests (Playwright screenshot-diff) — already tracked in roadmap v1.

---

## Data model changes

**Exactly one schema change:**

- `supabase/migrations/009_fk_cascades_on_delete_user.sql` — as specified above. Makes `list_entries.added_by` and `purchase_history.added_by` nullable, replaces the FK with `ON DELETE SET NULL`.

Type regeneration: run `supabase gen types typescript --project-id <ref> > packages/core/src/supabase.types.ts` after the migration is applied (as part of the implementation phase). Update `HydratedListEntry.addedBy` to `string | null` in `packages/core/src/models/index.ts` and adjust `fetchListEntries` return to match.

No other table changes. `mark_item_bought` RPC stays identical. `create_household_with_owner` RPC stays identical. No new RLS policies.

---

## API contracts

No new HTTP endpoints. All calls go through:

- Supabase JS (`@supabase/supabase-js`) — list queries, item-detail query, delete, sign-out, auth session.
- Supabase RPC — `mark_item_bought(p_entry_id)` (unchanged).
- Supabase Realtime — `list_entries:<householdId>` channel via `subscribeToList` (unchanged).
- Supabase Edge Function — `POST /functions/v1/add-item` with body `{utterance, household_id, candidate_item_id?, confirmed_store_id?, confirmed_brand?}` (unchanged). Response shape `AddItemResponse` (from `packages/core/src/models/index.ts`) is authoritative; any contract drift shows up as a type mismatch in `invokeAddItem`.

---

## Offline behavior

**Online-only with error state** (option (a) from the `/ak-spec` offline matrix). Matches v0 offline strategy in `PRODUCT-ROADMAP.md § 1e § 5`.

- List view: shows last-loaded state + the sync-error banner when Realtime disconnects or the initial fetch fails. No queueing, no local cache, no persisted offline mutations.
- Add-item: in-flight requests fail fast with an inline error in the add-item sheet. No queue-for-later.
- Mark-bought / delete: optimistic update; on error, revert and toast.

Explicit out-of-scope: `@tanstack/react-query` persistence, service worker caching, background sync, conflict-resolution. All deferred to `PRODUCT-ROADMAP.md v+ § Offline support`.

---

## Metrics

Five new events added to `METRICS.md` in this spec's commit (see `§ Decisions § D4`). All call-sites below:

| Event                  | Call site                                                                                       | Properties                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `item_added`           | `AddItemSheet.tsx` (post-success) AND `DisambiguationSheet.tsx` (post-confirm)                  | `{ store_id: response.store.id, was_disambiguated: <from-context>, input_language: <heuristic> }` |
| `item_bought`          | List row buy handler (after `markItemBought` resolves)                                          | `{ time_on_list_seconds: Math.round((Date.now() - new Date(addedAt).getTime()) / 1000) }`         |
| `disambiguation_shown` | `AddItemSheet.tsx` (when response has `needs_followup === true`)                                | `{ candidate_count: response.followup_options?.length ?? 0, followup_type }`                      |
| `store_routed`         | `AddItemSheet.tsx` + `DisambiguationSheet.tsx` (post-success, if `response.store.name` present) | `{ store_name: response.store.name, confidence_score: <TBD — see note> }`                         |
| `error_displayed`      | `ListClient` (useEffect on syncError transition null→non-null)                                  | `{ error_type: syncError.type, screen: 'list' }`                                                  |

**Note on `store_routed.confidence_score`**: the current edge function response shape doesn't expose the server-side confidence score. Two options:

- (a) Extend `AddItemResponse` to include `store_confidence?: number` and set it in the edge function from the routing result (trivial — `route_item_to_store` already returns `weighted_share`). Fire with the real number.
- (b) Ship `confidence_score: null` for v0 and track filling it in later.

**Decision**: (a). The edge-function change is one-line (`return ... store_confidence: top.weighted_share`); the client change is one line (add optional field to `AddItemResponse`); it's worth doing now because `store_routed` without a score is analytically useless. Track as a `/ak-implement` task.

**Input language heuristic for `item_added.input_language`**: reuse the edge function's `isLikelyEnglish(utterance)` check in the client (copy the function to `apps/web/lib/inputLanguage.ts`). Returns `'en'` if no Spanish indicator words, `'es'` otherwise. Imperfect but fit-for-purpose; we already decided this is the product heuristic.

**Analytics module**: extend `apps/web/lib/analytics.ts` with `trackItemAdded`, `trackItemBought`, `trackDisambiguationShown`, `trackStoreRouted`, `trackErrorDisplayed` — same pattern as existing `trackSignedIn`/`trackSignedOut`. Keeps event names behind typed constants, prevents drift.

Existing events that still apply (no wiring changes): `auth_signed_in` (fired from `providers.tsx`), `auth_signed_out` (fired from `providers.tsx` — the Settings sign-out path already flows through it).

---

## Files to create

- `supabase/migrations/009_fk_cascades_on_delete_user.sql`
- `apps/web/app/list/page.tsx` — new authed list home (server wrapper + `<ListClient />`).
- `apps/web/components/PublicLanding.tsx` — client-free server component for the landing page body (keeps `app/page.tsx` minimal).
- `apps/web/components/ThemeProvider.tsx`
- `apps/web/components/ListClient.tsx` (client component used by `list/page.tsx`)
- `apps/web/components/ListRow.tsx` (individual row with buy + menu buttons)
- `apps/web/components/StoreSection.tsx` (store header + rows wrapper)
- `apps/web/components/AddItemSheet.tsx`
- `apps/web/components/DisambiguationSheet.tsx`
- `apps/web/components/ConfirmationToast.tsx`
- `apps/web/components/SyncErrorBanner.tsx`
- `apps/web/components/EmptyListState.tsx`
- `apps/web/components/SignOutButton.tsx`
- `apps/web/components/HouseholdInfo.tsx`
- `apps/web/app/item/[id]/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/lib/inputLanguage.ts`
- Co-located unit tests for each component/page above (`*.test.tsx`).
- `apps/web/e2e/core-flows.spec.ts` — happy path E2E (sign in → add item → see list entry → mark bought).
- `apps/web/e2e/landing-routing.spec.ts` — IA routing test: unauth `/` renders landing; authed `/` redirects to `/list`; unauth `/list` redirects to `/sign-in?next=/list`.

## Files to modify

- `apps/web/app/page.tsx` — becomes the **public landing page**: server component with an `supabase.auth.getUser()` check that `redirect('/list')` when authed, otherwise renders `<PublicLanding />`.
- `apps/web/middleware.ts` — add `/` to the public-path allow-list; keep the authed-on-`/sign-in` → `/onboarding` branch; do NOT redirect authed users away from `/` (the RSC handles it).
- `apps/web/app/(auth)/onboarding/page.tsx` — change the has-household redirect target from `'/'` to `'/list'` (authoritative landing for a set-up user).
- `apps/web/app/(auth)/onboarding/OnboardingForm.tsx` — change the post-create redirect target from `'/'` to `'/list'`.
- `apps/web/app/(auth)/sign-in/page.tsx` — no change required (the after-auth redirect target remains `'/onboarding'`, which now bounces to `/list` if the user already has a household).
- `apps/web/app/layout.tsx` — wrap children with `<ThemeProvider>`.
- `apps/web/public/manifest.json` — change `start_url` from `/` to `/list` so installed PWAs skip the landing on every launch.
- `apps/web/lib/analytics.ts` — add new event helpers.
- `packages/core/src/api/items.ts` — add `fetchListEntryById`.
- `packages/core/src/models/index.ts` — update `HydratedListEntry.addedBy` to `string | null` after regen; add `store_confidence?: number` to `AddItemResponse` interface.
- `packages/core/src/supabase.types.ts` — regenerate after migration 009 applies.
- `supabase/functions/add-item/index.ts` — add `store_confidence` to successful response (one line).
- `METRICS.md` — 5 new rows (already applied alongside this spec).
- `PLAN.md` — row already moved from Planned → Active.
- `CLAUDE.md` — add a gotcha: "`added_by` can be null after migration 009 — UI must render `someone` fallback everywhere it surfaces the author". Add a second gotcha to **Where Things Happen § Auth**: public `/` landing (unauth) + authed `/` redirects to `/list` via RSC; list home is `/list`.
- `TODOS.md` — refresh `posted-by-someone` entry to note that it now overlaps with the null-added_by fallback.
- `apps/web/package.json` — no new deps expected; confirm during implementation. (Possible exception: a tiny focus-trap helper for the sheets — but ARIA + `inert` attribute should be enough; defer dependency if possible.)

---

## Tests

### Unit tests (Vitest)

All new, all in colocated `*.test.tsx` files under `apps/web/components/` and the page directories. Asserting **behavior**, not markup — per the auth-PR test-review precedent.

1. `ListClient.test.tsx`:
   - Renders skeleton rows on initial load.
   - After fetch resolves, groups entries by store.
   - Empty stores are not rendered.
   - Realtime INSERT event merges into state.
   - Realtime DELETE event removes the entry.
   - Channel error sets `syncError` and renders `<SyncErrorBanner />`.
2. `ListRow.test.tsx`:
   - Renders item name, brand, quantity, store, added-by.
   - Null `addedBy` renders "added by someone".
   - Tap buy → calls `markItemBought` with correct id.
   - Tap anywhere else → navigates to `/item/[id]`.
3. `AddItemSheet.test.tsx`:
   - Add disabled until input non-empty.
   - Successful `invokeAddItem` (no follow-up) → fires `item_added`, closes sheet.
   - `needs_followup === true` → fires `disambiguation_shown`, opens disambig sheet.
   - Network error → sheet stays open, inline error visible.
4. `DisambiguationSheet.test.tsx`:
   - Radio selection toggles correctly (single-select).
   - Confirm with no selection is disabled.
   - Confirm calls `invokeAddItem` with the right combination of `candidateItemId` / `confirmedStoreId` / `confirmedBrand` for each `followup_type`.
5. `SyncErrorBanner.test.tsx`:
   - Renders for `type: 'realtime'` and `type: 'query'`.
   - Fires `error_displayed` once on mount, not on re-render.
   - Dismiss hides; re-render with same error does not re-show (caller state drives).
6. `SignOutButton.test.tsx`:
   - Calls `signOut(client)` and pushes `/sign-in`.
7. `ItemDetail.page.test.tsx`:
   - Renders entry fields in the attribute grid.
   - Remove calls `deleteListEntry` and pushes `/list`.
   - Non-existent id → 404 (Next `notFound()`).
8. `SettingsPage.test.tsx`:
   - Renders household info + sign-out button.
9. `packages/core/src/api/items.test.ts`:
   - Extend existing test file with `fetchListEntryById` happy-path + null-on-404.
10. `packages/core/src/api/realtime.test.ts`:
    - Keep existing; confirm nothing regresses after type updates.
11. `apps/web/lib/inputLanguage.test.ts`:
    - Returns `'es'` for `"leche"`, `'agrega queso"`.
    - Returns `'en'` for `"milk"`, `"add cheese"`.
12. `apps/web/components/PublicLanding.test.tsx`:
    - Renders the wordmark, tagline, and single terracotta CTA linking to `/sign-in`.
    - Contains no client-side interactivity beyond the `<Link>`.
13. `apps/web/app/page.test.tsx`:
    - Authed: `getUser()` returns a user → `redirect('/list')` called.
    - Unauth: `getUser()` returns null → renders `<PublicLanding />`.
14. Update `apps/web/app/(auth)/onboarding/page.test.tsx`:
    - Change the existing assertion "redirects to / when the user already belongs to a household" → expect `'/list'` instead of `'/'`.
15. `apps/web/middleware.test.ts` (if exists; else add a minimal integration check):
    - Unauth GET `/` → pass-through (200 or render).
    - Unauth GET `/list` → 307 to `/sign-in?next=/list`.
    - Authed GET `/sign-in` → 307 to `/onboarding` (existing behavior unchanged).

### Integration tests

None in this PR (integration with live Supabase lands in PR 4 per roadmap § 1g). The `mark_item_bought` RPC already has an integration test in `packages/core/src/api/items.test.ts` (if not, add it — RLS boundary behavior is critical).

### E2E (Playwright — mobile 375 + desktop 1440)

`apps/web/e2e/core-flows.spec.ts` — happy path:

- **Setup**: use the fresh-user pattern from `auth.spec.ts` (timestamped `e2e-${Date.now()}@example.com`). Sign up → create household → land on list view (empty state).
- **Steps**:
  1. Assert empty state copy ("la lista está vacía") is visible.
  2. Tap FAB → add-item sheet opens.
  3. Type "milk" → tap Add.
  4. Sheet closes, toast "Added milk to …" appears (or disambig sheet opens — if it does, pick the first store, confirm).
  5. List view shows one row with "milk" under a store section.
  6. Tap the buy button on the row.
  7. Row fades and disappears.
  8. Navigate to `/settings` via the gear icon.
  9. Tap sign out → lands back on `/sign-in`.
- **Dark-mode variant**: run the same spec with `page.emulateMedia({ colorScheme: 'dark' })` and assert `.dark` class on `<html>` after the ThemeProvider mounts. Scoped to list-view state only (no need to walk the full flow twice).
- **Theme-auto-detection dedicated test**: `apps/web/e2e/theme.spec.ts` — visit `/sign-in` with `page.emulateMedia({ colorScheme: 'dark' })`, wait for ThemeProvider mount, assert `<html>` has class `dark`. Matches the roadmap's Option A success criterion.
- **Landing + IA routing**: `apps/web/e2e/landing-routing.spec.ts`:
  - Unauth visit `/` → sees "Get started" CTA; click → lands at `/sign-in`.
  - Unauth visit `/list` → redirected to `/sign-in?next=/list`.
  - Authed visit `/` (after signing in in setup) → redirected to `/list` server-side.
- **Viewport matrix**: the existing `playwright.config.ts` runs mobile + desktop projects automatically. No additional config.

### Snapshot / visual gates

- **Close-out 4-combo matrix** (D6): 6 screens × 4 combos = 24 captures, collected manually (or via the existing `qa-walk.spec.ts` if that tooling extends easily — see if it does during implementation). The landing page is the 6th screen (per D7). These are review-time evidence, not a CI gate; the `/design-review` and `/qa` pre-ship steps flag visual regressions.

### Accessibility gates

- axe-core via `@axe-core/playwright` on the core-flows E2E: assert no violations on list view, add-item sheet (open state), and settings.
- Manual VoiceOver / TalkBack pass deferred per `TODOS.md § voiceover-audit-post-v0`.

---

## Dependencies on PR 1 + PR 2

- `@lalista/core` exports: `createClient`, `signInWithPassword`, `signUpWithPassword`, `signOut`, `getSession`, `getUser`, `onAuthStateChange`, `fetchUserHouseholds`, `createHousehold`, `fetchListEntries`, `markItemBought`, `deleteListEntry`, `invokeAddItem`, `subscribeToList`, `fetchStores`, `Database`, `HydratedListEntry`, `AddItemResponse`, `DisambiguationCandidate`. **Verified present** (see `packages/core/src/index.ts`).
- `@lalista/ui` exports: `Button`, `Text`, `Card`, `Input`, `Divider`. **Verified present**. This PR may extend `Button` with a `destructive` variant prop.
- `@supabase/ssr` already a web-app dep (landed in PR 2).
- `posthog-js` already wired in `providers.tsx`.
- Fonts (Fraunces + Plus Jakarta Sans) already loaded via `next/font/google` in `app/layout.tsx`.
- Tailwind v4 `@source` directive already points at `packages/ui/src/**/*.{ts,tsx}` (in `globals.css`). Components added to `apps/web/components/` are auto-scanned by Tailwind as part of the project; no new `@source` needed (per CLAUDE.md gotcha, this is only required for workspace packages).

No new workspace packages. No new edge functions. No new RPCs. One migration.

---

## Task order (dependency-aware — walk these sequentially in `/ak-implement`)

1. **Migration 009** (schema first, blocks every UI task that reads list data).
   1. Write `supabase/migrations/009_fk_cascades_on_delete_user.sql`.
   2. Run `supabase db reset` locally; apply + confirm tables nullable.
   3. Regenerate `packages/core/src/supabase.types.ts`.
   4. Update `HydratedListEntry.addedBy` to `string | null` in `models/index.ts`.
   5. Run existing unit tests — confirm no regressions.
2. **Core API extension**:
   1. Add `fetchListEntryById` to `packages/core/src/api/items.ts` + unit test.
3. **Edge function + model extension for `store_routed` confidence**:
   1. Add `store_confidence?: number` to `AddItemResponse` in `models/index.ts`.
   2. Edit `supabase/functions/add-item/index.ts` to set it from `routing.confidence` + `candidateResult` cases.
   3. Unit test for the addItem wrapper (contract) — optional but cheap.
4. **Analytics extension**:
   1. Add new `trackItemAdded` / `trackItemBought` / `trackDisambiguationShown` / `trackStoreRouted` / `trackErrorDisplayed` to `apps/web/lib/analytics.ts` + tests.
   2. Add `apps/web/lib/inputLanguage.ts` + tests.
5. **ThemeProvider**:
   1. Create `apps/web/components/ThemeProvider.tsx`.
   2. Wire from `apps/web/app/layout.tsx`.
   3. Write Playwright theme test.
6. **Confirmation toast + sync error banner** (standalone components — used by list + add-item flows):
   1. `ConfirmationToast.tsx` + tests.
   2. `SyncErrorBanner.tsx` + tests.
7. **Add-item + disambiguation sheets** (standalone — can be implemented without the list):
   1. `AddItemSheet.tsx` + tests.
   2. `DisambiguationSheet.tsx` + tests.
   3. Manual smoke test: mount in a dev sandbox page and verify both paths (`needs_followup` true + false).
8. **List view components**:
   1. `ListRow.tsx` + tests.
   2. `StoreSection.tsx` + tests.
   3. `EmptyListState.tsx` + tests.
   4. `ListClient.tsx` — wire everything together; fetch + realtime + error state + FAB mount.
9. **IA flip: public landing + `/list` authed home** (D7):
   1. Create `apps/web/components/PublicLanding.tsx` (wordmark + tagline + "Get started" CTA).
   2. Replace `apps/web/app/page.tsx` with the public-landing server component: `supabase.auth.getUser()` → if authed, `redirect('/list')`; else render `<PublicLanding />`.
   3. Create `apps/web/app/list/page.tsx` — server wrapper that resolves household and renders `<ListClient />` (content previously destined for `app/page.tsx`).
   4. Update `apps/web/middleware.ts` — add `/` to the public-path allow-list (unauth users can see it).
   5. Update `apps/web/app/(auth)/onboarding/page.tsx` — redirect target `'/'` → `'/list'`.
   6. Update `apps/web/app/(auth)/onboarding/OnboardingForm.tsx` — redirect target `'/'` → `'/list'`.
   7. Update `apps/web/public/manifest.json` — `start_url: '/list'`.
   8. Update the existing onboarding-redirect unit tests — assertions change from `'/'` to `'/list'`.
   9. Write `apps/web/components/PublicLanding.test.tsx` — renders wordmark, tagline, CTA.
   10. Write `apps/web/app/page.test.tsx` — authed calls `redirect('/list')`; unauth renders landing.
10. **Item detail page**:
    1. `apps/web/app/item/[id]/page.tsx` + tests.
11. **Settings page**:
    1. `SignOutButton.tsx` + tests.
    2. `HouseholdInfo.tsx` + tests.
    3. `apps/web/app/settings/page.tsx` + tests.
12. **E2E + observability**:
    1. Extend `apps/web/lib/analytics.ts` wiring where components need it.
    2. Write `apps/web/e2e/core-flows.spec.ts`.
    3. Write `apps/web/e2e/theme.spec.ts`.
13. **Doc updates**:
    1. Update `CLAUDE.md § Gotchas` with the null-added_by rule.
    2. Update `TODOS.md` re: posted-by-someone.
    3. PR description references this spec + `PRODUCT-ROADMAP.md § 1e`.

---

## Gotchas (surfaced from `CLAUDE.md § Gotchas` — read before touching these areas)

- **Tailwind v4 `@source`**: `apps/web/app/globals.css` has `@source "../../../packages/ui/src/**/*.{ts,tsx}"`. The new components in `apps/web/components/` are inside the project root and auto-scanned — no new `@source` needed. If you add styled components to a new workspace package (e.g. `packages/icons`), add another `@source` line or utilities silently drop.
- **`mark_item_bought` RPC is the ONLY way to mark bought**: RLS blocks direct inserts to `purchase_history`. Use `markItemBought(client, entryId)` from `@lalista/core`. Do not — under any circumstance — call `purchase_history.insert` from the web app.
- **`subscribeToList` for realtime, never polling**: use the exported helper; handle the unsubscribe cleanup on component unmount.
- **`added_by` is nullable after migration 009**: UI must handle `null` gracefully ("added by someone"). `HydratedListEntry.addedBy: string | null`. Tests must cover this path.
- **`already_on_list === true`**: the edge function returns this when an identical item+store pair is pending. The disambiguation sheet's quantity variant surfaces this; v0 doesn't actually resize quantities — it just ack's and closes.
- **Server-component hydration**: `fetchListEntryById` in item detail runs on the server; the component is async. Don't leak Supabase client creation into `useEffect`; use the server helper in `apps/web/lib/supabase/server.ts`.

---

## Acceptance / rollout / rollback plan

### Acceptance (before merging)

All of the following must be green:

- [ ] `pnpm turbo run lint` clean.
- [ ] `pnpm turbo run typecheck` clean.
- [ ] `pnpm turbo run test:unit` green (new + existing tests all pass).
- [ ] `pnpm --filter @lalista/web exec playwright test` green at 375 + 1440 (mobile + desktop projects; including the new `core-flows.spec.ts` and `theme.spec.ts`).
- [ ] `pnpm turbo run build` green (Next.js production build; no middleware warnings).
- [ ] `supabase db reset` applies migrations 001–009 cleanly; rollback SQL (the commented block in 009) applies cleanly against a fresh DB with no `NULL`-`added_by` rows.
- [ ] `/ak-pre-ship` gates pass (see next section for mapping).
- [ ] `METRICS.md` has the 5 new rows.
- [ ] `CLAUDE.md` has the null-added_by gotcha.
- [ ] 4-combo matrix captures for 6 screens (including the public landing) are attached to the PR as hero shots.

### `/ak-pre-ship` gate mapping

- **Preflight** — Chromium + Playwright present (existing).
- **Docs** — CLAUDE.md + METRICS.md + PLAN.md updated.
- **Metrics** — 5 new events present in METRICS.md; wired in the code (one call site per event minimum).
- **Responsive** — 4-combo matrix for 6 screens (landing + 5 core). Spot-checks for disambig sheet.
- **`/simplify`** — no duplicated helpers; sheet components share a common base if that becomes easy; `AddItemSheet` and `DisambiguationSheet` are separate by intent even if DOM-similar.
- **`/ak-test-review`** — tests assert behavior not markup; error paths covered; `already_on_list` path covered.
- **`/review`** — no `SELECT *` in new queries (use explicit columns per the existing `fetchListEntries` pattern); no `security definer` escalation; all mutations go through wrappers or RPCs.
- **`/cso`** — `@supabase/ssr` pin unchanged; no `service_role` key in client bundle; edge-function auth validation (already present) unchanged.
- **`/design-review`** — matrix passes; no raw hex values; no new colors; spacing on the 8px grid.
- **`/qa`** — happy path works on Vercel preview; disambig flow exercised live; sync-error banner reproducible by throttling network.
- **`/benchmark`** — list view First Contentful Paint < 2.5s p95 on 3G; Realtime reconnect latency < 5s after throttle clear.
- **Convention check** — new files have `// What: / // Why: / // Does NOT:` headers.
- **Hero shots** — 6 screens × light mode captured at mobile + desktop (landing + 5 core).

### Rollout

- Merge to `main` → Vercel auto-deploys preview → production.
- Migration 009 applies via `supabase db push` from CI (or manual if CI migration is not yet wired — PR 4 formalizes that). Apply in prod ONCE, before the prod Vercel deploy finishes reloading. The migration is backwards-compatible at the column level (existing rows keep their `added_by`; new rows can still be inserted by add-item which always sets the field).
- PostHog events start flowing immediately. Sentry remains wired unchanged.

### Rollback

Two tiers:

1. **Code rollback**: `git revert` the merge commit → Vercel redeploys the previous build. The previous build expects `added_by` to be NOT NULL, which still holds for every existing row (migration 009 doesn't `UPDATE` anything). Reverting the code without reverting the migration is SAFE.
2. **Schema rollback**: if, after some time, a user has deleted their account and `NULL`-`added_by` rows exist, rolling back migration 009 would fail (NOT NULL constraint violated). Schema rollback is only safe immediately after the migration applies — before any user deletion runs. The migration's `-- ROLLBACK` block encodes this caveat explicitly.

Prod rollback plan: always revert code first; schema rollback only after verifying no `NULL` rows exist (`SELECT COUNT(*) FROM list_entries WHERE added_by IS NULL; SELECT COUNT(*) FROM purchase_history WHERE added_by IS NULL;`).

---

## Open questions (none are blockers)

None. The 7 `/ak-spec`-time decisions are all resolved inline above. No further questions for the user before `/ak-implement` begins.

If the `store_confidence` edge-function extension is controversial during code review, the fallback is to ship `confidence_score: null` in `store_routed`. Non-blocking.
