<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: my-stores -->
<!-- date: 2026-05-11 -->

# Spec: my-stores (PR N)

**Sources:**

- `.gstack/projects/meirmsn-lalista/node-fix-settings-collab-polish-design-20260511-121125.md` — approved office-hours design (status: APPROVED; scope: Approach A; eng-review patched 2026-05-11)
- `supabase/migrations/015_household_collaborators.sql` — prior SECURITY DEFINER + FOR UPDATE + Model-B-style scoping reference; `current_household_id()` helper at `001:138`
- `supabase/migrations/001_initial_schema.sql` — current `stores` schema (rows 30-42), `list_entries` FK to `stores(id)`
- `supabase/migrations/013_realtime_publication.sql` — publication-add pattern
- `supabase/functions/add-item/index.ts` — routing fallback insertion at line 388
- `CLAUDE.md § Where Things Happen` (households + collaborators), `§ Gotchas` (RLS least-privilege, addedByName two-query, ON DELETE on auth.users FKs, latency tiers, single-household v0 invariant)
- `DESIGN.md` — voice-first / settings-section pattern / Fraunces empty-state shape
- Prior spec `specs/household-collaborators/spec.md` — style + structure reference

Per-household "My Stores" layered onto the existing global catalog: add/remove stores per household (incl. custom ones), routing fallback when a removed store is predicted, Model B private custom-store visibility, defense-in-depth trigger on `list_entries`. Two reused surfaces (Settings, AddItemSheet) + one reusable component (`StorePicker`). Onboarding step + `/join` redirect change deferred to follow-up PR.

---

## Decisions (resolved at spec time)

11 `/ak-spec`-time decisions resolved in Phase 0 from the approved design + eng-review patch. Recorded below so Phase 1 preserves them verbatim and a crashed Phase 1 resumes without re-asking.

### D1: Scope

**Decision:** Approach A — Settings + Picker + Fallback. Onboarding "Pick your stores" step and `/join` → `/onboarding` redirect change are deferred to a follow-up PR (captured as TODOs).

**Rationale:** Eng-review (2026-05-11) locked scope to Approach A; bounds PR size; onboarding has separate design overhead (mode-based OnboardingForm, `welcomed_at` column, page-level routing branch). Settings + picker + fallback is the load-bearing user-visible win on its own.

### D2: Visibility model — Model B (private custom stores)

**Decision:** Replace the existing open `stores_select` policy with a Model B scoped version: globals visible to all authed users; custom rows (`is_global=false`) visible only to the creating household via a `household_members` subquery. INSERT/UPDATE/DELETE on `stores` blocked at table level — all custom-create flows through the SECURITY DEFINER RPC.

**Rationale:** Matches the user's mental model ("global list + my private extras"); eliminates the cross-household custom-name leak Model A would carry; simpler RLS story. Trade-off accepted: catalog can fragment over time (multiple "Trader Joe's" rows from different households); cleanup is operator-side admin-promotion, not cross-household autocomplete dedup. Re-resolved post eng-review (2026-05-11) — original draft had a Model A-style "fully readable across households" footnote that contradicted the L34 wording; Model B is the canonical answer.

### D3: Drop `stores.name UNIQUE` constraint

**Decision:** Drop the existing `stores_name_key` UNIQUE constraint; do NOT add a replacement. LOAD-BEARING(do-not-remove) sentinel comment in the migration body documents why.

**Rationale:** Under Model B, N households can each independently create their own "Trader Joe's" row — that fragmentation is invisible to users (RLS hides each household's customs from the others) and is intentionally accepted in v0. Re-adding UNIQUE would make House B's add fail when House A had already created the name, even though A's row is invisible to B. Operator-side admin-promotion to global is the dedup path (TODO `admin-promote-custom-store-to-global.md`).

### D4: Defense-in-depth BEFORE INSERT trigger on `list_entries`

**Decision:** Add a BEFORE INSERT trigger `list_entries_store_membership_check` enforcing `(household_id, store_id) ∈ household_stores`. Raises `P0001` with a clear message otherwise. NOT applied to `purchase_history` (written via `mark_item_bought()` from already-validated `list_entries` rows), `brand_preferences`, or `disambiguation_log` (write-once-by-edge-function flows).

**Rationale:** Without this, a stale-tab client could write a `list_entries` row for a store the household just removed — RLS lets the insert through (membership check is on `household_id`, not `(household_id, store_id)` pair); the FK to `stores(id)` is open. Same fix-the-invariant-at-the-DB-layer pattern as 015's `FOR UPDATE` on `accept_invite`. Triplet integration test (allowed / blocked-by-removed / blocked-by-other-household-only) belongs in `016_household_stores.integration.test.ts`.

### D5: Edge-function routing-fallback insertion point

**Decision:** Insertion point is **line 388** (`if (routing.storeId && routing.confidence >= storeRoutingThreshold)` — the silent_match conditional), NOT line 411 (the asked_store `else` branch). The membership check goes INSIDE the `if` so a high-confidence routing decision can be downgraded to asked_store when the predicted store isn't in the household's My Stores. The asked_store branch's candidate query at lines 394-397 (`from('stores').select('id, name').order('name')`) MUST change to a join through `household_stores` (`select('store_id, stores(id, name)').eq('household_id', household_id)`).

**Rationale:** Eng-review caught the original design's "around line 411" wording — that's already inside the `else`, so the gate would never fire on the silent_match path that the fallback exists to handle. `supabase` client at `add-item/index.ts:72` uses service-role + forwards Authorization → RLS bypassed BUT `auth.uid()` resolves via the JWT → `current_household_id()` works correctly. Comment near the check makes this load-bearing.

### D6: Fuzzy threshold

**Decision:** **0.6** for both suggestion ranking AND the "Add new store" CTA gate (single threshold). Runtime-tunable via a new `config` row `store_name_match_threshold=0.6`. Tie-break on suggestion results by `name ASC`.

**Rationale:** Existing thresholds: `item_match_threshold=0.85` (strict — for canonical-item dedup), `store_routing_threshold=0.70` (medium — for confident routing). Store-name custom-add needs a lower bar (0.6) to catch voice-input typos like "trayder joe" → "Trader Joe's". Single threshold simplifies the picker logic — the suggestion query and the CTA-gate decision read from the same query result. Runtime-tunable so we can adjust without redeploying.

### D7: Custom-store retention on household deletion

**Decision:** `stores.created_by_household_id` is `ON DELETE SET NULL`. When the creating household is deleted: the custom row stays in `stores` (preserves `list_entries` / `purchase_history` referential integrity); under Model B's RLS, a row with `is_global=false` AND `created_by_household_id IS NULL` is invisible to all authed users (orphaned but referentially intact); `household_stores` rows cascade away with the household.

**Rationale:** Same `ON DELETE` discipline as `list_entries.added_by` / `purchase_history.added_by` (CLAUDE.md gotcha: never default `NO ACTION` on an `auth.users` / households FK). Preserves history; operator can manually promote-or-purge later via the deferred admin tool. Captured in the TODO.

### D8: Trigram index on `stores.name`

**Decision:** Add `stores_name_trgm_idx` GIN (`name gin_trgm_ops`) in the same migration.

**Rationale:** P1 eng-review finding. `items` already has the same pattern at `001:53` (`items_name_trgm_idx`); `stores` didn't because the catalog was only 3 rows. Per-household custom stores grow the catalog over time; autocomplete + RPC fuzzy match scans need the index to stay sub-ms.

### D9: `is_global` backfill simplification

**Decision:** No explicit `UPDATE stores SET is_global=true WHERE created_by_household_id IS NULL`; the column-level `DEFAULT true` populates existing rows on `ADD COLUMN`.

**Rationale:** A8 simplification — Postgres applies the default to existing rows when the column has `NOT NULL DEFAULT <val>`. Smaller migration; identical result. Verified-pattern; no empirical test needed.

### D10: Latency-tier wiring

**Decision:**

- Settings → My Stores add/remove (`<StorePicker mode="manage">`) → **Tier A1 (rollback)** via `useOptimisticMutation({ failureMode: 'rollback' })`. Mirrors `DisplayNameField` save.
- AddItemSheet picker add-and-select (`<StorePicker mode="select" allowCreate>`) → **Tier A2 (banner)** via `useOptimisticMutation({ failureMode: 'banner' })`. Shares one banner slot with the existing `AddItemSheet` "Add" + force-create flow.
- Custom-create "Add new store: '<text>'" CTA inside the picker → same tier as the surrounding picker context (A1 in Settings, A2 in AddItemSheet).

**Rationale:** Maps cleanly to the existing latency framework (CLAUDE.md § Gotchas § Latency feedback tiers). No new threshold tokens needed; reuses `FEEDBACK_THRESHOLD_MS`/`RETRY_BUDGET_MS`/`RETRY_BACKOFF_MS` from `@lalista/ui`.

### D11: New METRICS events

**Decision:** Add **4 events** to `METRICS.md`:

- `my_store_added` — properties: `store_id`, `was_created` (boolean), `source` (`'settings' | 'add_item' | 'disambig'`), `household_id`.
- `my_store_removed` — properties: `store_id`, `source` (`'settings'`), `household_id`.
- `custom_store_created` — properties: `store_id`, `name`, `source` (`'settings' | 'add_item' | 'disambig'`), `household_id`. (Strict subset of `my_store_added` where `was_created=true`; emitted separately for the rarer-event-counted view.)
- `store_routing_fallback_fired` — properties: `removed_store_id` (the predicted store no longer in My Stores), `item_canonical`, `household_id`. Fired in the edge function when the silent_match → asked_store downgrade hits.

**Rationale:** Each is a new product-meaningful action that doesn't have an existing event. `my_store_added` and `custom_store_created` overlap intentionally — the second is the count-of-custom-creates view; PostHog query language makes the strict-subset count cheaper to read separately than via a `was_created=true` filter. The user has asked /ak-build to run without stopping for clarifying questions; if these events are wrong-shape, redirect during Phase 1 (`/ak-spec`) which expands this skeleton.

### D12: AFTER INSERT trigger on `households` to auto-seed My Stores (migration 017)

**Decision:** Add migration `017_household_stores_auto_seed.sql` with an AFTER INSERT trigger on `households` that seeds `household_stores` with every `is_global=true` row at household-creation time. SECURITY DEFINER so it bypasses the (deliberate) absence of an INSERT policy on `household_stores`. Mirrors migration 016's cross-join backfill, scoped to the single new row.

**Rationale:** Phase 5 CI fix — the migration 016 backfill (`§ 5` of that file) only seeded households that existed AT MIGRATION TIME. Households created AFTER the migration (via `create_household_with_owner` RPC from migration 008, or any other path) started with an empty My Stores, and every `list_entries` insert tripped the BEFORE INSERT trigger (D4) with `store % is not in household %'s My Stores`. Broke `items.integration.test.ts` (3 cases) and `016_household_stores.integration.test.ts` case 3.

**Why a trigger over modifying the RPC** (alternatives considered):

1. AFTER INSERT trigger on `households` (chosen) — stateless, symmetric with the migration backfill, self-heals any provisioning path (RPC, future server-side admin tools, manual inserts). No coupling to specific RPCs.
2. Modify `create_household_with_owner` RPC to do the backfill inline — tighter coupling; breaks if a future code path creates households outside the RPC.
3. Amend migration 016 — already shipped in this PR's branch; amending applied migrations is anti-pattern.

**Why AFTER not BEFORE:** the seed inserts into `household_stores` and references the new household via FK. AFTER INSERT runs in the same transaction so the seed is atomic with the household creation (a household either exists with its My Stores seeded, or doesn't exist at all).

**Coverage:** new case 6 in `packages/core/src/migrations/016_household_stores.integration.test.ts` asserts every new household via `create_household_with_owner` has all is_global=true store rows in its My Stores.

---

## In scope

- **Schema migration `016_household_stores.sql`** — `stores` extension (`created_by_household_id`, `is_global`), drop `stores_name_key` UNIQUE constraint with sentinel comment (D3), new `household_stores` table with PK `(household_id, store_id)`, household-scoped backfill of globals, trigram index `stores_name_trgm_idx` (D8), Model B `stores_select` RLS replacement (D2), `household_stores_select` RLS, two SECURITY DEFINER RPCs (`add_household_store`, `remove_household_store`) with migration-008 grant block parity (`revoke … from public/anon; grant execute … to authenticated, service_role`) and `set search_path = public, pg_temp`, BEFORE INSERT trigger `list_entries_store_membership_check` (D4), `store_name_match_threshold=0.6` config row insert (D6), `household_stores` added to `supabase_realtime` publication, terminal `notify pgrst, 'reload schema'`. LOAD-BEARING sentinel comments at: `stores.name UNIQUE` drop (D3), `is_global = false` in custom-create branch (paired with pure-file test per A1 follow-up).
- **API wrappers** in `packages/core/src/api/`:
  - `stores.ts` — extend with `fetchMyStores()`, `fetchStoreCatalogSuggestions(query)`, `addHouseholdStore({storeId?, name?})`, `removeHouseholdStore(storeId)`. Existing `fetchStores()` stays as-is (admin / catalog-wide consumers — none today, but keep the export for future ops scripts).
  - `storeErrors.ts` (new) — typed `StoreError` union + `StoreRpcError` + `mapStoreError` mirror of `inviteErrors.ts`. Maps `P0001 'not a household member'` → `'not_member'`; `P0001 'must provide store_id or name'` → `'unknown_store'`; `P0001 'name must be 1-60 chars'` → `'name_invalid'`; unknown → `'unknown'`. (No `'duplicate'` member — the RPC uses `on conflict do nothing` so duplicate-add is silently idempotent; the design doc's earlier `'duplicate'` placeholder is dropped at spec time.)
- **UI primitive** in `packages/ui/src/`: `<StorePicker>` — dual-mode (`mode: 'select' | 'manage'`) reusable picker with autocomplete + fuzzy-match suggestions + "Add new store" CTA gated by D6's threshold.
- **Surface 1: Settings → My Stores section** (`apps/web/app/settings/page.tsx`). New section under the existing Account section (after the household-collaborators sections from 015 — final order: Account → Household → Members → Activity → My Stores). Renders `<StorePicker mode="manage" allowCreate />`. Tier A1 latency wiring (D10).
- **Surface 2: AddItemSheet store picker** (`apps/web/components/AddItemSheet.tsx`). Replace existing inline store selection (when `decision_type === 'asked_store'`) with `<StorePicker mode="select" allowCreate />`. Pass My Stores. Keep existing `asked_store` branching. Tier A2 latency wiring (D10).
- **DisambiguationSheet store-followup** (`apps/web/components/DisambiguationSheet.tsx` if separate; otherwise inline within AddItemSheet) — render the same `<StorePicker mode="select" allowCreate />` for the store-followup branch. Mirrors how the item-followup branch already supports `force_create_with_label`. Avoids first-time-user dead end when the user shops at a store not yet in their My Stores.
- **Edge-function routing fallback** — `supabase/functions/add-item/index.ts` line 388 (D5): membership gate inside the silent_match conditional; on miss, downgrade to `asked_store`. Candidate query at lines 394-397 changes to a `household_stores` join so only My Stores are offered. Emit `store_routing_fallback_fired` PostHog event on the downgrade path.
- **METRICS additions** — 4 events per D11; `METRICS.md` extension, no PostHog migration.
- **Tests** — 1 pure-file test (sentinel grep for `is_global = false`), 5 integration cases (slow-job CI, opt-in via `VITEST_INTEGRATION=1`), unit tests per wrapper + per component mode + per error mapping, 1 new E2E spec covering all three surfaces.
- **CLAUDE.md gotcha additions** — 4 new entries (Model B RLS scoping pattern; BEFORE INSERT trigger as defense-in-depth; routing-fallback insertion-point + service-role-but-`auth.uid()`-works comment; `addHouseholdStore` return-shape `{storeId, wasCreated}` for `was_created=true` analytics path).
- **TODOs** — `TODOS.md` entries for: `admin-promote-custom-store-to-global` (operator dedup path), `onboarding-pick-your-stores-step` (deferred D1 scope), `join-redirect-to-onboarding-for-name-only-flow` (deferred D1 scope).

## Out of scope (deferred)

Inherits design § "NOT in scope" + spec-time additions:

- **Onboarding "Pick your stores" step.** Captured as TODO `onboarding-pick-your-stores-step`. Includes the `profiles.welcomed_at` column, `OnboardingForm` mode prop, two-step submit flow, popular-stores ranking query. Out of scope per D1.
- **`/join/[token]` redirect-to-`/onboarding` change.** Currently 015's `/join` flow lands invitees on `/list`; the design doc wanted to thread through `/onboarding` for the name-only step. Captured as TODO `join-redirect-to-onboarding-for-name-only-flow`. Out of scope per D1.
- **Admin promotion of custom → global.** The operator-side dedup path under Model B. Captured as TODO `admin-promote-custom-store-to-global`. Out of scope (no admin UI exists yet).
- **Popular-stores ranking.** Static query is fine for v1 onboarding; deferred along with the onboarding step.
- **Materialized view of popular stores.** Sub-second even at 10k households per design open-Q5; revisit only if scale demands.
- **`navigator.share` integration on the picker.** Not needed — picker is a chooser, not a share surface.
- **Cross-household autocomplete dedup.** Under Model B, fragmentation is the explicit trade. Operator-side promotion is the cleanup path.
- **Per-store icons or branding.** Text-only rendering in v0; matches existing store display in `AddItemSheet`.
- **Bulk-import / bulk-remove of stores.** Single add/remove per RPC call.
- **Re-ordering My Stores.** No user-defined order in v0; list rendered alphabetically (server-side `order by stores.name asc`).
- **Realtime audit feed for store add/remove events.** Page-load only mirrors the audit-feed contract from 015. Reconsider when the audit feed surface evolves.
- **Email-on-store-removal.** Pure UI feature; no transactional email.

## Screens

Per-screen specs grouped by surface. Visual specs cite design Pass + DESIGN.md voice rule + settings-section pattern.

### Settings → My Stores section (manage mode)

- **IA placement** (PR 5 order): rendered after the existing 015 sections — final order: Account → Household → Members → Activity → My Stores. The pattern verified at `apps/web/app/settings/page.tsx` (caption-uppercase `tracking-[0.08em]` heading + `<Divider className="my-lg" />` between + body in `flex flex-col gap-sm`).
- **Heading**: `<Text as="h2" variant="caption">my stores</Text>` (uppercase via the existing caption variant; lowercased label per DESIGN.md voice rule for chrome).
- **Body**: `<StorePicker mode="manage" allowCreate />` rendered directly. My Stores list at top, then the autocomplete-add input below.
- **Primary state** (≥1 store in My Stores):
  - List of My Stores as tap-to-remove rows. Each row: store name (`body 15px font-medium`) + remove affordance (44px tap target via `min-h-[44px]`, `text-text-tertiary hover:text-error` `remove` text-link, NO icon to keep chrome minimal).
  - Below the list: `<Input>` with placeholder `add another store…` + `<Suggestion>` list as the user types (debounce 200ms). Tap a suggestion → adds it (Tier A1 rollback, mirrors `DisplayNameField` save).
  - If query length > 2 AND no suggestion has `similarity > 0.6`, the "Add new store: '{typed text}'" CTA appears as a terracotta pill below the suggestion list.
- **Empty state** (0 stores in My Stores — uncommon after backfill but possible if the user removes them all): Fraunces italic 36px primary `tus tiendas` (Spanish-prominent, DESIGN.md empty-state shape) / body 17px `(your stores)` / caption 13px `add the places you shop.` (English, lowercase, claim-y).
  - Below: the autocomplete-add input + suggestions + "Add new store" CTA, same shape as primary state.
- **Error state**: inline error on the row (Tier A1 rollback). Row re-appears with `text-error` border-pulse 250ms on RPC failure. No toast.
- **Loading state**: inherits route-level Tier C `<LoadingArea>` skeleton on first paint.
- **Voice doctrine**: all chrome English-lowercase per DESIGN.md voice rule; Spanish reserved for the empty-state primary and the user's typed item content elsewhere in the app. Section heading `my stores` (caption-uppercase rendered).

### AddItemSheet store picker (select mode, allowCreate)

- **When rendered**: `decision_type === 'asked_store'` from the edge function. Replaces the existing inline store-select pill list.
- **Hierarchy**: My Stores rendered as tap-to-pick pills (terracotta border, transparent fill, terracotta-fill on selected). Below: same autocomplete input + "Add new store" CTA as Settings.
- **Latency tier**: A2 (banner). The "Add new store: '{text}'" path emits `custom_store_created` + `my_store_added(was_created=true)`; tapping an existing suggestion adds it (silent on success) + selects it for the current add-item flow. The shared banner slot in `<ListClient>` surfaces add-failures.
- **Auto-pick polish (not required for v0)**: when `myStores.length === 1` after the candidate-list filter, the row auto-selects and the user can confirm. Documented in design open-Q; defer to follow-up if soak shows the extra tap matters.
- **Disambiguation entry**: when `followup_type === 'store'` AND the user's typed text doesn't fit any existing My Store, the same picker exposes "Add new store: '<text>'" so the user isn't stuck in a dead-end mid-add.

### Picker visual + interaction details (shared)

- **Tokens**: caption headings `font-body text-[13px] font-semibold uppercase tracking-[0.08em] text-text-secondary`. Rows `min-h-[44px]` for tap. Suggestion list `gap-xs` between items. Empty-state Fraunces line `font-display text-[36px] font-light italic leading-[1.2] text-text-primary`.
- **Accessibility** (DESIGN.md a11y): autocomplete input gets `aria-autocomplete="list" aria-controls="store-suggestions" aria-expanded={hasSuggestions}`. Each suggestion `role="option"`. "Add new store" CTA `aria-label="Create a new store named {text}"`. The remove text-link gets `aria-label="Remove {storeName} from my stores"`.
- **Motion**: row add/remove uses CSS-only opacity transition (Tier D) layered under the Tier A1/A2 optimistic state. `prefers-reduced-motion: reduce` → instant.
- **Responsive**: 375 = full-width column; 768+ = same column inside the existing `max-w-[400px]` settings/sheet container.

## Data model changes

Single migration `supabase/migrations/016_household_stores.sql`. The SQL below is preserved verbatim from the design doc with the spec-time corrections folded in (D2 RLS replacement; D3 UNIQUE drop sentinel; D4 trigger; D6 config row; D7 ON DELETE SET NULL; D8 trigram index; D9 no explicit backfill UPDATE).

```sql
-- Migration 016: my-stores (per-household store membership + custom catalog rows)
--
-- Layers a per-household "My Stores" concept on top of the existing global
-- catalog at `stores`. Two columns added to stores (created_by_household_id +
-- is_global), one new membership table (household_stores), two SECURITY
-- DEFINER RPCs, one defense-in-depth BEFORE INSERT trigger on list_entries,
-- one runtime-tunable config row, one realtime publication addition.
--
-- v0 invariants (drop / revise in v1+ chapters):
--   - household_stores PK is (household_id, store_id) — single-row-per-pair.
--   - stores.is_global = false rows are visible ONLY to created_by_household_id;
--     no cross-household dedup happens at the catalog layer (operator-side
--     admin-promotion is the dedup path — TODO admin-promote-custom-store-to-global).

-- 1. Extend stores: support per-household custom rows.
alter table stores
  add column created_by_household_id uuid references households(id) on delete set null,
  add column is_global boolean not null default true;
-- D9: `default true` applies to existing rows on ADD COLUMN; no explicit
--     UPDATE … SET is_global = true needed. Verified-pattern.

-- 2. Drop the stores.name UNIQUE constraint.
alter table stores drop constraint if exists stores_name_key;
-- LOAD-BEARING(do-not-remove): under Model B (private custom stores), N households
-- can each independently create their own "Trader Joe's" row — that fragmentation
-- is invisible to users (RLS hides each household's customs from the others) and
-- is intentionally accepted in v0. Re-adding UNIQUE would make House B's add fail
-- when House A had already created the name, even though A's row is invisible
-- to B. Operator-side admin-promotion to global is the dedup path — see
-- TODOS.md → admin-promote-custom-store-to-global.

-- 3. Trigram index on stores.name for autocomplete + RPC fuzzy match (D8).
-- items has the same pattern at 001:53; stores didn't because the catalog
-- was only 3 rows. Per-household customs grow it.
create index if not exists stores_name_trgm_idx on stores using gin (name gin_trgm_ops);

-- 4. New: per-household membership table.
create table household_stores (
  household_id uuid not null references households(id) on delete cascade,
  store_id     uuid not null references stores(id),
  added_at     timestamptz not null default now(),
  added_by     uuid references auth.users(id) on delete set null,
  primary key (household_id, store_id)
);

create index household_stores_household_idx on household_stores (household_id);

alter table household_stores enable row level security;

-- household_stores: SELECT only; writes via SECURITY DEFINER RPC.
-- 015 wrap-in-subquery pattern for planner caching.
create policy "household_stores_select" on household_stores
  for select using (
    household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    )
  );
-- No client INSERT/UPDATE/DELETE policies — all writes via add_household_store
-- and remove_household_store RPCs below.

-- 5. Backfill: every existing household gets the 3 globals.
-- D2: cross-join over is_global=true catalog rows. on conflict do nothing
-- in case a v1+ migration adds early rows mid-backfill.
insert into household_stores (household_id, store_id, added_by)
select h.id, s.id, null
from households h
cross join stores s
where s.is_global = true
on conflict do nothing;

-- 6. Replace stores_select with Model B scoped policy (D2).
-- Globals visible to all authed users; customs visible only to creating household.
drop policy if exists "stores_select" on stores;
create policy "stores_select" on stores
  for select using (
    auth.uid() is not null
    and (
      is_global = true
      or created_by_household_id in (
        select household_id from household_members where user_id = (select auth.uid())
      )
    )
  );
-- No INSERT/UPDATE/DELETE policies on stores — all custom-create flows through
-- add_household_store (SECURITY DEFINER below). Same principle-of-least-privilege
-- pattern as 015 (CLAUDE.md gotcha § Principle of least privilege for RLS-bypass writes).

-- 7. RPCs (SECURITY DEFINER, narrow-purpose, migration-008 grant block parity).
-- add_household_store: add a store to caller's My Stores. Returns (store_id, was_created).
create or replace function add_household_store(
  p_store_id uuid default null,
  p_name text default null
) returns table(store_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household_id uuid;
  v_resolved_id uuid;
  v_match uuid;
  v_threshold numeric;
begin
  v_household_id := current_household_id();
  if v_household_id is null then
    raise exception 'not a household member' using errcode = 'P0001';
  end if;
  if p_store_id is null and p_name is null then
    raise exception 'must provide store_id or name' using errcode = 'P0001';
  end if;
  if p_name is not null then
    p_name := nullif(trim(p_name), '');
    if p_name is null or length(p_name) > 60 then
      raise exception 'name must be 1-60 chars' using errcode = 'P0001';
    end if;
  end if;

  -- Read the tunable fuzzy threshold (D6). Falls back to 0.6 if config row missing.
  select coalesce((select value::numeric from config where key = 'store_name_match_threshold'), 0.6)
    into v_threshold;

  if p_store_id is not null then
    v_resolved_id := p_store_id;
  else
    -- p_name given: fuzzy match against catalog rows VISIBLE to this caller.
    -- Under Model B, that's globals + this household's own customs. The
    -- redundant `or created_by_household_id = ...` clause makes the visibility
    -- scope explicit at the query layer — defense in depth.
    select id into v_match
      from stores
      where (is_global = true or created_by_household_id = v_household_id)
        and similarity(name, p_name) > v_threshold
      order by similarity(name, p_name) desc, name asc
      limit 1;
    v_resolved_id := v_match;
  end if;

  if v_resolved_id is not null then
    insert into household_stores (household_id, store_id, added_by)
      values (v_household_id, v_resolved_id, auth.uid())
      on conflict do nothing;
    return query select v_resolved_id, false;
    return;
  end if;

  -- No catalog match: mint a private custom store, then link membership.
  -- LOAD-BEARING(do-not-remove): is_global = false. Without this, custom
  -- stores default to is_global=true (column default), which would (a)
  -- include them in the cross-join backfill for FUTURE households,
  -- (b) widen their RLS visibility to ALL authed users (Model B violation),
  -- and (c) skew any future popular-stores ranking. Pure-file test in
  -- packages/core/src/migrations/016_is_global_false.test.ts greps for
  -- this exact line.
  insert into stores (name, created_by_household_id, is_global)
    values (p_name, v_household_id, false)
    returning id into v_resolved_id;
  insert into household_stores (household_id, store_id, added_by)
    values (v_household_id, v_resolved_id, auth.uid());

  return query select v_resolved_id, true;
end;
$$;
revoke all on function add_household_store(uuid, text) from public;
revoke execute on function add_household_store(uuid, text) from anon;
grant execute on function add_household_store(uuid, text) to authenticated, service_role;

-- remove_household_store: remove a store from caller's My Stores. Catalog untouched.
-- Idempotent: removing a non-membership row is a no-op (no error).
create or replace function remove_household_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household_id uuid;
begin
  v_household_id := current_household_id();
  if v_household_id is null then
    raise exception 'not a household member' using errcode = 'P0001';
  end if;
  delete from household_stores
    where household_id = v_household_id and store_id = p_store_id;
end;
$$;
revoke all on function remove_household_store(uuid) from public;
revoke execute on function remove_household_store(uuid) from anon;
grant execute on function remove_household_store(uuid) to authenticated, service_role;

-- 8. Defense-in-depth BEFORE INSERT trigger on list_entries (D4).
-- Without this, a stale-tab client could write a list_entries row for a store
-- the household just removed — RLS lets the insert through (membership check
-- is on household_id only); the FK to stores(id) is open. Same fix-the-invariant-
-- at-the-DB-layer pattern as 015's FOR UPDATE on accept_invite.
--
-- NOT applied to purchase_history (written via mark_item_bought() from already-
-- validated list_entries rows), brand_preferences, or disambiguation_log
-- (write-once-by-edge-function flows where this attack surface doesn't apply).
create or replace function check_list_entries_store_in_household_stores()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from household_stores
    where household_id = new.household_id and store_id = new.store_id
  ) then
    raise exception 'store % is not in household %''s My Stores', new.store_id, new.household_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger list_entries_store_membership_check
  before insert on list_entries
  for each row execute function check_list_entries_store_in_household_stores();

-- 9. Config row for the fuzzy threshold (D6). Runtime-tunable; no redeploy needed.
insert into config (key, value) values ('store_name_match_threshold', '0.6')
  on conflict (key) do nothing;

-- 10. Realtime publication: household_stores adds/removes propagate to other
-- members' active sessions. Mirrors how list_entries was added in 013.
alter publication supabase_realtime add table household_stores;

-- 11. Tell PostgREST to reload its schema cache so the new RPCs are callable
-- via the rest API immediately on deploy. (Migration 008/015 pattern.)
notify pgrst, 'reload schema';
```

**Reuses existing migration-001 helper** `current_household_id()` (`001:138`) — same pattern as 015. No new helper.

## API contracts

```ts
// packages/core/src/api/stores.ts — extend with 4 new wrappers
// (existing fetchStores() stays as-is for admin/ops-script consumers)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import type { Store } from '../models';

type Client = SupabaseClient<Database>;

/** Fetch the caller's My Stores via household_stores join. Ordered by store name. */
export async function fetchMyStores(client: Client): Promise<Store[]>;

/**
 * Autocomplete: fuzzy-matches against the catalog VISIBLE to the caller
 * (globals + own customs under Model B RLS). Returns top 5, ranked by
 * similarity desc + name asc tie-break. Threshold matches D6 config.
 */
export async function fetchStoreCatalogSuggestions(
  client: Client,
  query: string
): Promise<Store[]>;

/**
 * Add a store to caller's My Stores. Pass either an existing store_id OR a
 * name (custom-create branch). Returns the resolved store_id + a flag
 * indicating whether a new catalog row was minted. Tier A1 (Settings) /
 * Tier A2 (AddItemSheet) latency wiring per D10.
 */
export async function addHouseholdStore(
  client: Client,
  args: { storeId?: string; name?: string }
): Promise<{ storeId: string; wasCreated: boolean }>;

/** Remove a store from caller's My Stores. Idempotent. Catalog row untouched. */
export async function removeHouseholdStore(
  client: Client,
  storeId: string
): Promise<void>;
```

```ts
// packages/core/src/api/storeErrors.ts — NEW
// Mirror of invitations.ts/inviteErrors.ts pattern (CLAUDE.md gotcha:
// principle of least privilege RPCs return typed P0001 messages; the
// wrapper maps to a typed union for the UI layer).

export type StoreError =
  | 'not_member' // P0001 'not a household member'
  | 'unknown_store' // P0001 'must provide store_id or name'
  | 'name_invalid' // P0001 'name must be 1-60 chars'
  | 'unknown'; // catch-all

export class StoreRpcError extends Error {
  readonly kind: StoreError;
  constructor(kind: StoreError, cause?: unknown) {
    super(`store rpc error: ${kind}`);
    this.kind = kind;
    if (cause) this.cause = cause;
  }
}

/** Maps a Postgres error (P0001 with message-string match) → StoreError union. */
export function mapStoreError(err: unknown): StoreRpcError;
```

**Latency wiring** (D10) — both `addHouseholdStore` and `removeHouseholdStore` are consumed via `useOptimisticMutation`:

| Caller surface                                             | Hook config                                           |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `<StorePicker mode="manage">` in Settings → My Stores      | `useOptimisticMutation({ failureMode: 'rollback' })`  |
| `<StorePicker mode="select" allowCreate>` in AddItemSheet  | `useOptimisticMutation({ failureMode: 'banner' })`    |
| `<StorePicker mode="select" allowCreate>` in Disambig flow | Same `failureMode: 'banner'` (shares the banner slot) |

`FEEDBACK_THRESHOLD_MS`/`RETRY_BUDGET_MS`/`RETRY_BACKOFF_MS` tokens from `@lalista/ui` are consumed unchanged.

## Edge function changes

`supabase/functions/add-item/index.ts` — single insertion point inside the silent_match conditional. **D5 specifies insertion at line 388; verified at HEAD as line 388 — code in this section uses the verified location.** The shape of the change:

```ts
// Existing structure (verified at HEAD lines 381-431):
if (!resolvedStoreId) {
  const routing = await routeToStore(
    supabase,
    household_id,
    chosenItem.id,
    storeRoutingThreshold
  );
  if (routing.storeId && routing.confidence >= storeRoutingThreshold) {
    // line 388
    // EXISTING silent_match path
    resolvedStoreId = routing.storeId;
    resolvedStoreName = routing.storeName;
    resolvedStoreConfidence = routing.confidence;
  } else {
    // EXISTING asked_store path
    const { data: availableStores } = await supabase
      .from('stores')
      .select('id, name')
      .order('name');
    // ...
  }
}
```

**Spec-time change (D5):** wrap the line-388 `if` body with a membership gate. On miss, fall through to the existing `else` branch (`asked_store`). Also rewrite the asked-store candidates query at lines 394-397 to project My Stores only.

```ts
if (!resolvedStoreId) {
  const routing = await routeToStore(
    supabase,
    household_id,
    chosenItem.id,
    storeRoutingThreshold
  );

  // D5: membership gate on the silent_match path. The `supabase` client at
  // add-item/index.ts:72 uses service-role + forwards Authorization → RLS is
  // bypassed BUT auth.uid() resolves via the JWT → current_household_id()
  // works correctly. Query is a single PK lookup on household_stores.
  // LOAD-BEARING(do-not-remove): without this gate, a high-confidence
  // routing decision can silently route to a store the household removed.
  let routedStoreInMyStores = false;
  if (routing.storeId) {
    const { data: membership } = await supabase
      .from('household_stores')
      .select('store_id')
      .eq('household_id', household_id)
      .eq('store_id', routing.storeId)
      .maybeSingle();
    routedStoreInMyStores = !!membership;
  }

  if (
    routing.storeId &&
    routing.confidence >= storeRoutingThreshold &&
    routedStoreInMyStores // NEW (D5)
  ) {
    // EXISTING silent_match path unchanged
    resolvedStoreId = routing.storeId;
    resolvedStoreName = routing.storeName;
    resolvedStoreConfidence = routing.confidence;
  } else {
    // EXISTING asked_store path; candidates query rewritten to My Stores only.
    // D5: when routing.storeId was set but predicted-store is no longer in
    // My Stores, emit the store_routing_fallback_fired PostHog event before
    // returning. Client-side surface will reconstruct via the existing
    // logDecision → asked_store telemetry; the new event is a separate
    // count of *this* specific downgrade.
    if (routing.storeId && !routedStoreInMyStores) {
      // PostHog event emit goes here — see Metrics section.
    }

    // Candidates: only stores in My Stores (D5).
    const { data: availableStores } = await supabase
      .from('household_stores')
      .select('store_id, stores(id, name)')
      .eq('household_id', household_id)
      .order('stores(name)');

    // ... rest of existing branch unchanged; map availableStores into
    // followup_options shape — { id: row.stores.id, label: row.stores.name }
  }
}
```

**Defensive fallback**: if the household has zero rows in `household_stores` (impossible immediately after migration backfill, but possible if the user removed every store), `availableStores` is the empty list. The `DisambiguationSheet`'s `<StorePicker allowCreate />` integration ensures the user can mint one mid-flow — no first-time-user dead end. This is why `allowCreate` is on for the AddItemSheet picker even in `mode="select"`.

**Edge-function-deploy gotcha** (CLAUDE.md): `supabase/functions/**` does NOT auto-deploy; `deploy-functions.yml` triggers it on push:main. Test plan callout below.

## Metrics

Per D11, add 4 events to `METRICS.md` (no PostHog migration — events are property-bag posts).

### `my_store_added`

Fired when a store is successfully added to the caller's My Stores (RPC `add_household_store` succeeds).

| Property       | Type    | Notes                                                             |
| -------------- | ------- | ----------------------------------------------------------------- |
| `store_id`     | string  | UUID of the resolved store_id (existing catalog or newly minted). |
| `was_created`  | boolean | `true` if a new catalog row was minted (custom-create branch).    |
| `source`       | enum    | `'settings'`, `'add_item'`, or `'disambig'`.                      |
| `household_id` | string  | Caller's household_id (existing convention).                      |

### `my_store_removed`

Fired when a store is successfully removed from the caller's My Stores (RPC `remove_household_store` succeeds, regardless of whether a row was actually deleted — idempotent removal still counts as a user-intent signal).

| Property       | Type   | Notes                                        |
| -------------- | ------ | -------------------------------------------- |
| `store_id`     | string | UUID of the removed store_id.                |
| `source`       | enum   | `'settings'` only (no other remove surface). |
| `household_id` | string | Caller's household_id.                       |

### `custom_store_created`

Fired only when `was_created=true` on the `my_store_added` path. Strict subset of `my_store_added`; emitted separately so the rarer-event PostHog query is cheaper than a filter on `was_created=true`.

| Property       | Type   | Notes                                              |
| -------------- | ------ | -------------------------------------------------- |
| `store_id`     | string | UUID of the newly-minted catalog row.              |
| `name`         | string | Custom name as typed (trimmed, ≤60 chars per RPC). |
| `source`       | enum   | `'settings'`, `'add_item'`, or `'disambig'`.       |
| `household_id` | string | Caller's household_id.                             |

### `store_routing_fallback_fired`

Fired in the edge function (server-side PostHog post) on the D5 downgrade — when `routing.storeId` was set but the predicted store isn't in My Stores, so silent_match falls through to asked_store.

| Property           | Type   | Notes                                                        |
| ------------------ | ------ | ------------------------------------------------------------ |
| `removed_store_id` | string | The store_id the routing engine predicted (no longer in MS). |
| `item_canonical`   | string | The canonical item name being added.                         |
| `household_id`     | string | Caller's household_id.                                       |

## Files to create / modify / delete

### Create

**Migration:**

- `supabase/migrations/016_household_stores.sql` — full DDL above.
- `packages/core/src/migrations/016_is_global_false.test.ts` — pure-file unit test: assert migration body contains the literal line `is_global = false` near the LOAD-BEARING sentinel and the sentinel comment `LOAD-BEARING(do-not-remove): is_global = false` exists in the file. Mirrors 015's `for update` sentinel pattern.
- `packages/core/src/migrations/016_household_stores.integration.test.ts` — slow-job integration suite (opt-in via `VITEST_INTEGRATION=1`). 5 cases (see § Tests).

**API wrappers (`packages/core/src/api/`):**

- `storeErrors.ts` + `storeErrors.test.ts` — typed `StoreError` union + `StoreRpcError` + `mapStoreError`.

**UI primitive (`packages/ui/src/`):**

- `StorePicker.tsx` + `StorePicker.test.tsx` — dual-mode reusable picker.

**E2E spec (`apps/web/e2e/`):**

- `my-stores.spec.ts` — covers all three surfaces (Settings manage, AddItemSheet select, routing fallback).

**TODOs (`TODOS.md` entries — content lives in the existing file):**

- `admin-promote-custom-store-to-global` — operator dedup path under Model B.
- `onboarding-pick-your-stores-step` — deferred D1 scope.
- `join-redirect-to-onboarding-for-name-only-flow` — deferred D1 scope.

### Modify

**API wrappers:**

- `packages/core/src/api/stores.ts` — extend with `fetchMyStores`, `fetchStoreCatalogSuggestions`, `addHouseholdStore`, `removeHouseholdStore`. Existing `fetchStores` retained.
- `packages/core/src/api/stores.test.ts` — extend with unit tests for the 4 new wrappers + `mapStoreError` integration on RPC failures.
- `packages/core/src/index.ts` — export new wrappers + `StoreError` + `StoreRpcError`.
- `packages/core/src/supabase.types.ts` — regenerate after 016 (`pnpm db:gen-types`); will include the new column + table + 2 RPCs.

**UI:**

- `packages/ui/src/index.ts` — export `StorePicker`.

**Pages / components:**

- `apps/web/app/settings/page.tsx` — render the My Stores section after the existing Account / Household / Members / Activity sections.
- `apps/web/components/AddItemSheet.tsx` — replace inline store-select with `<StorePicker mode="select" allowCreate />`; pass My Stores.
- `apps/web/components/DisambiguationSheet.tsx` (if separate; otherwise the relevant branch inside AddItemSheet) — render `<StorePicker mode="select" allowCreate />` on the store-followup branch.

**Edge function:**

- `supabase/functions/add-item/index.ts` — line 388 membership gate + lines 394-397 candidates-query rewrite + PostHog event emit (see § Edge function changes).

**Docs:**

- `METRICS.md` — append the 4 events from § Metrics.
- `CLAUDE.md` — append the 4 new gotchas from § Gotchas.
- `TODOS.md` — append the 3 deferred items.
- `BUILD-LOG.md` — append the chapter entry post-merge (auto-handled by `/ak-go-live`).
- `PLAN.md` — flip the my-stores row from "Planned" to "Shipped" post-merge.

### Delete

None.

## Tests

Per CLAUDE.md E2E-per-surface invariant and 015's coverage shape.

### Pure-file (vitest) — `packages/core/src/migrations/`

1. **`016_is_global_false.test.ts`** — assert migration body contains:
   - The literal line `values (p_name, v_household_id, false)` (the custom-create insert with `is_global=false` as the 3rd arg).
   - The sentinel comment `LOAD-BEARING(do-not-remove): is_global = false`.

   Lands in the SAME commit as the migration. Mirrors 015's `for update` sentinel test pattern (`015_for_update.test.ts`).

### Integration (vitest, `VITEST_INTEGRATION=1`) — `packages/core/src/migrations/016_household_stores.integration.test.ts`

Runs on slow-job CI; requires local Supabase via `supabase-runner` sibling container. Reuses 015's per-test admin-impersonation pattern. 5 cases:

1. **Backfill correctness.** After migration apply, assert every pre-existing household has exactly the set of `is_global=true` store rows in `household_stores` (3 rows per household at chapter-1m HEAD). Use the seed.sql fixture households as inputs.
2. **Model B RLS scoping (D2).** Household A creates a custom store via `add_household_store({name: 'House A Custom'})`. Household B's user impersonation calls `fetchStoreCatalogSuggestions('House A')` — assert no rows. Also: B calls `fetch('stores').eq('id', <A's-custom-id>)` directly — assert RLS returns null.
3. **BEFORE INSERT trigger triplet (D4).** With household A's My Stores = {Costco, Walmart}:
   - **Allowed**: insert `list_entries` row with `store_id = Costco` → succeeds.
   - **Blocked-by-removed**: remove Costco from A's My Stores; try to insert `list_entries` row with `store_id = Costco` → fails with `P0001 'store ... is not in household ...'`.
   - **Blocked-by-other-household-only**: insert `list_entries` row with `store_id = <store-only-in-B's-My-Stores>` → fails with the same `P0001`. (Independent of RLS — the trigger is the gate.)
4. **RPC fuzzy match + null-handling.** Three sub-cases:
   - `add_household_store({name: 'trayder joe'})` against a catalog containing "Trader Joe's" (custom-created in seed) → returns `wasCreated=false`, `store_id` = Trader Joe's id (similarity > 0.6).
   - `add_household_store({name: 'zzz nowhere'})` → returns `wasCreated=true`, mints a new row with `is_global=false`.
   - `add_household_store({})` (both args null) → raises `P0001 'must provide store_id or name'`.
5. **Threshold tunable via config (D6).** Update `config` set `value='0.95' where key='store_name_match_threshold'`. Re-run sub-case 1 of test 4 (`trayder joe` against `Trader Joe's`) — now NO match, RPC returns `wasCreated=true`. Reset threshold to `'0.6'` afterward.

### Unit (vitest) — module behavior

- **`stores.test.ts`** — 4 wrapper cases (`fetchMyStores`, `fetchStoreCatalogSuggestions`, `addHouseholdStore`, `removeHouseholdStore`). Each mocks the supabase client and asserts the right table/RPC name + arg shape + return-shape mapping.
- **`storeErrors.test.ts`** — `mapStoreError` for each `StoreError` union value + the unknown-error catch-all.
- **`StorePicker.test.tsx`** — render-snapshot + interaction tests for:
  - `mode='select'` shows tap-to-pick rows; tapping fires `onChange(storeId)`.
  - `mode='manage'` shows tap-to-remove text-link on each row.
  - `allowCreate=true` + query length ≤2 → no "Add new store" CTA.
  - `allowCreate=true` + query length >2 + top suggestion similarity > 0.6 → no CTA.
  - `allowCreate=true` + query length >2 + no suggestion above 0.6 → CTA appears.
  - `allowCreate=false` → CTA never appears regardless of suggestions.
  - Empty state (0 My Stores in `mode='manage'`) renders the Fraunces line.
  - ARIA: input has `aria-autocomplete="list"`; remove text-link has `aria-label="Remove {storeName} from my stores"`.

### E2E (Playwright) — `apps/web/e2e/my-stores.spec.ts`

Single spec covering all three surfaces per the E2E-per-surface invariant. Pattern: follow `force-create-race.spec.ts` for two-context provisioning + DB-level assertions and `realtime.spec.ts` for cross-session WebSocket coverage.

- **Settings manage flow** — owner navigates to `/settings`, scrolls to My Stores section, taps `remove` on a global store, refreshes — store is gone. Adds it back via the autocomplete input. Asserts: `household_stores` row state matches via supabase admin client.
- **Custom-store create from Settings** — owner types `Sprouts` (not in seed catalog), confirms top suggestion has similarity < 0.6, taps "Add new store: 'Sprouts'", asserts: a new `stores` row exists with `is_global=false`, `created_by_household_id` = owner's household, AND a `household_stores` row joins it to the owner.
- **Model B isolation (T-2 mirror in E2E)** — two contexts (household A + household B). A creates `House A Custom`. B opens `/settings` → My Stores, types `House A` in the autocomplete — assert no suggestion containing `House A Custom`. Also: B's `add-item` flow with `house a custom` utterance routes through normal NLP (no auto-find of A's custom row).
- **AddItemSheet picker** — user adds an item; when `decision_type === 'asked_store'`, the picker renders with the household's My Stores as pills. Tapping a pill selects + commits. Custom-store mid-flow: type `Sprouts` in the picker input + tap "Add new store" → store is added to My Stores AND selected for the in-flight add.
- **Routing fallback (D5)** — owner has cheese-at-Costco history. Owner removes Costco from My Stores. Owner runs `add-item('cheese')` → response carries `decision_type='asked_store'` (NOT silent_match); `followup_options` contains only the remaining My Stores (Walmart, Target); `store_routing_fallback_fired` PostHog event emitted (asserted via a posthog test-double or fetch-recorder, mirror existing `realtime.spec.ts` event-capture pattern).
- **Defense-in-depth trigger surfacing through UI** — stale-tab simulation: open `/list` in two tabs. Tab A removes Target. Tab B (stale state) attempts to add an item that would route to Target. Assert: the add fails with the trigger's P0001 surfaced as a user-friendly error banner (Tier A2). Tab B's UI does not crash; banner copy: `couldn't add — try again`.

## Dependencies

- **Migration 015 (`household_collaborators`)** — provides `current_household_id()` helper indirectly via `household_members.user_id` + the single-household v0 invariant (`household_members_one_per_user_v0`). 016 depends on the 015 RLS scoping subqueries continuing to work.
- **`pg_trgm` extension** — already enabled (migration 001); `similarity()` function used in the RPC body and in the trigram index.
- **Realtime publication** — `supabase_realtime` already exists (migration 013); 016 adds `household_stores` via `alter publication`.
- **Latency framework primitives** — `useOptimisticMutation`, `useSubmitFeedback`, `LoadingArea`, `FEEDBACK_THRESHOLD_MS`, `RETRY_BUDGET_MS`, `RETRY_BACKOFF_MS` from `@lalista/ui`. No new primitives.
- **Edge-function service-role conventions** — `add-item/index.ts:72` already creates the supabase client with service-role + forwarded Authorization; `auth.uid()` resolves correctly in the membership-gate query (D5 comment makes this explicit).
- **DESIGN.md voice doctrine + empty-state Fraunces shape** — consumed unchanged for the My Stores empty state.
- **`profiles.welcomed_at` column** — **NOT** added in this PR (deferred to the onboarding-step TODO). The trigger doesn't require it; the picker doesn't require it.

**Zero new external deps.** Verified against `apps/web/package.json`, `packages/core/package.json`, `packages/ui/package.json`. No new npm packages.

**Workspace packages touched:**

- `packages/core` — modified (stores.ts, supabase.types.ts, index.ts) + new files (storeErrors.ts, migrations/016\_\*.test.ts × 2).
- `packages/ui` — modified (index.ts export) + new file (StorePicker.tsx + test).
- `apps/web` — modified (settings/page.tsx, AddItemSheet.tsx, DisambiguationSheet.tsx) + new file (e2e/my-stores.spec.ts).
- `supabase/migrations` — new file (016).
- `supabase/functions/add-item` — modified.

## Task order

Strict dependency-ordered list, one task per atomic commit. `/ak-implement` walks this list top-down. Matches the 10 Phase-2 tasks already in the live tracker.

1. **Migration 016 SQL** — `supabase/migrations/016_household_stores.sql` (schema + RLS + RPCs + trigger + realtime + trigram + config row + `notify pgrst`).
   - Files: `supabase/migrations/016_household_stores.sql`.
   - Tests added: (next task lands the paired pure-file test in the same commit per D-9-style discipline).
   - Acceptance: `pnpm db:reset` applies cleanly; `select add_household_store(null, 'Test Store')` after impersonating an owner returns `(<uuid>, true)`; `\d household_stores` shows PK + indices + RLS enabled.

2. **Pure-file test `016_is_global_false.test.ts`** — assert `is_global = false` literal + sentinel comment exist in migration body.
   - Files: `packages/core/src/migrations/016_is_global_false.test.ts`.
   - Tests added: 1 file with 2 assertions.
   - Acceptance: `pnpm turbo run test:unit -- 016_is_global_false` green; if someone removes the `is_global = false` from the custom-create branch, the test fails at PR review time.
   - **Why same commit as task 1**: the sentinel is load-bearing from day 1, not added as a follow-up.

3. **Integration test `016_household_stores.integration.test.ts`** — 5 cases (backfill, Model B scoping, trigger triplet, fuzzy match + null-handling, threshold tunability).
   - Files: `packages/core/src/migrations/016_household_stores.integration.test.ts`.
   - Tests added: 5 cases per § Tests.
   - Acceptance: all 5 pass against local Supabase under `VITEST_INTEGRATION=1`.

4. **API wrappers `stores.ts` + `storeErrors.ts` + unit tests + regen types.**
   - Files: `packages/core/src/api/stores.ts`, `packages/core/src/api/stores.test.ts`, `packages/core/src/api/storeErrors.ts`, `packages/core/src/api/storeErrors.test.ts`, `packages/core/src/index.ts`, `packages/core/src/supabase.types.ts` (regen).
   - Tests added: 4 wrapper unit tests + `mapStoreError` coverage.
   - Acceptance: `pnpm turbo run test:unit -- packages/core` green; types compile.

5. **`<StorePicker>` component + unit tests.**
   - Files: `packages/ui/src/StorePicker.tsx`, `packages/ui/src/StorePicker.test.tsx`, `packages/ui/src/index.ts`.
   - Tests added: mode/allowCreate/threshold/empty/ARIA cases per § Tests.
   - Acceptance: `pnpm turbo run test:unit -- packages/ui` green.

6. **AddItemSheet wiring** — replace inline store picker with `<StorePicker mode="select" allowCreate />`; integrate into the disambiguation/store-followup branch too.
   - Files: `apps/web/components/AddItemSheet.tsx`, `apps/web/components/DisambiguationSheet.tsx` (if separate file).
   - Tests added: none directly (E2E covers in task 9).
   - Acceptance: manual smoke `pnpm dev` confirms picker renders on `asked_store` branch + custom-create mid-flow works.

7. **Settings → My Stores section.**
   - Files: `apps/web/app/settings/page.tsx`.
   - Tests added: none directly (E2E covers in task 9).
   - Acceptance: manual smoke confirms IA order (Account → Household → Members → Activity → My Stores) + section renders with seed-data My Stores.

8. **Edge function routing-fallback update.**
   - Files: `supabase/functions/add-item/index.ts`.
   - Tests added: edge-fn integration test (if existing scaffold exists; otherwise covered by the E2E routing-fallback case in task 9).
   - Acceptance: `supabase functions serve add-item` locally; manually trigger an add with a routed-store-not-in-My-Stores scenario; assert response `decision_type='asked_store'` + `followup_options` lists only My Stores.

9. **E2E spec `apps/web/e2e/my-stores.spec.ts`** — all 6 cases per § Tests.
   - Files: `apps/web/e2e/my-stores.spec.ts`.
   - Tests added: 6 E2E cases.
   - Acceptance: spec green on both Chromium viewports (375 + 1280) on slow-job CI.

10. **Docs + TODOs.**
    - Files: `CLAUDE.md` (4 new gotchas — § Gotchas), `METRICS.md` (4 new events — § Metrics), `TODOS.md` (3 new entries: admin-promote-custom-store-to-global, onboarding-pick-your-stores-step, join-redirect-to-onboarding-for-name-only-flow).
    - Tests added: none.
    - Acceptance: gotchas follow established imperative-present + Why + How-to-apply shape; METRICS entries match property-table format of existing events.

## Gotchas

Each entry below is a new CLAUDE.md gotcha that lands as part of this PR (task 10). Phrased as the existing CLAUDE.md gotchas — imperative present, "Why" + "How to apply" where load-bearing.

- **Model B store visibility: globals visible to all authed users; customs visible only to the creating household** (D2). Migration 016 replaces the open `stores_select` policy with a scoped version: `is_global=true OR created_by_household_id ∈ (caller's households)`. All custom-store creation goes through `add_household_store` (SECURITY DEFINER) — there is no client INSERT/UPDATE/DELETE policy on `stores`. **How to apply**: don't add a redundant client policy on `stores` for INSERT — it would widen the surface; route through the RPC. **Why**: matches user mental model (global + private extras), avoids cross-household custom-name leak. Trade-off: catalog fragments over time (multiple "Trader Joe's" rows); operator-side admin-promotion is the dedup path (TODO `admin-promote-custom-store-to-global`).

- **BEFORE INSERT trigger on `list_entries` enforces `(household_id, store_id) ∈ household_stores` at the DB layer** (D4). Without this, a stale-tab client could write a `list_entries` row for a store the household just removed — RLS lets the insert through (membership check is on `household_id` only); the FK to `stores(id)` is open. **How to apply**: do NOT remove `check_list_entries_store_in_household_stores()` or its trigger. The 3-case integration test (allowed / blocked-by-removed / blocked-by-other-household-only) lives in `packages/core/src/migrations/016_household_stores.integration.test.ts` case 3. NOT applied to `purchase_history` (written via `mark_item_bought()` from already-validated `list_entries` rows), `brand_preferences`, or `disambiguation_log` (write-once-by-edge-function flows where this attack surface doesn't apply). Same fix-the-invariant-at-the-DB-layer pattern as 015's `FOR UPDATE` on `accept_invite`.

- **Edge-function routing-fallback membership gate lives INSIDE the silent_match conditional, not the asked_store else** (D5). At `supabase/functions/add-item/index.ts:388` (`if (routing.storeId && routing.confidence >= storeRoutingThreshold)`), the gate adds a `routedStoreInMyStores` check — on miss, the silent_match path is downgraded to `asked_store`. **How to apply**: do NOT move the gate into the `else` branch — that's already inside asked_store and the gate would never fire on the silent_match path the fallback exists to handle. The asked-store candidates query at lines 394-397 is rewritten to a `household_stores` join so only My Stores are offered. **Why service-role-but-`auth.uid()`-works**: the `supabase` client at `add-item/index.ts:72` uses service-role + forwards `Authorization` → RLS is bypassed (service-role) BUT `auth.uid()` resolves via the JWT → `current_household_id()` works correctly. Comment near the check makes this load-bearing.

- **`addHouseholdStore` returns `{storeId, wasCreated}` — `wasCreated=true` is the analytics signal for custom-store creation** (D11). The RPC returns the (single) row `(store_id, was_created)`; the API wrapper maps to the camelCase pair. Callers fire `my_store_added` (always) AND `custom_store_created` (only when `wasCreated=true`) per the PostHog count-of-rarer-events convention. **How to apply**: don't collapse the shape — `wasCreated` is the only client-visible signal that a new catalog row was minted. The strict-subset `custom_store_created` event is a deliberate PostHog query-cost optimization, not a duplicate.

## Acceptance criteria

Direct copy from the design doc's Success Criteria, with item numbering preserved:

1. User can add a custom store via autocomplete + "Add new store" CTA in 2 contexts (Settings, AddItemSheet — onboarding deferred per D1). Same `<StorePicker>` component, same behavior.
2. User can remove a store from My Stores. Existing `list_entries` and `purchase_history` rows referencing that store remain intact and readable.
3. Routing fallback works: with cheese-at-Target in history, after removing Target, adding "cheese" prompts an `asked_store` instead of silently routing.
4. Fragmentation prevention works: typing "Trader Joe's" when "Trader Joe's" is in the catalog visible to the household surfaces it via autocomplete; the "Add new store" CTA does NOT appear.
5. E2E spec covers each surface per the CLAUDE.md E2E-per-surface invariant (`apps/web/e2e/my-stores.spec.ts`).
6. Integration test covers the migration backfill: every existing household gets the 3 globals seeded after migration (`016_household_stores.integration.test.ts` case 1).
7. Custom stores are RLS-scoped: household A cannot see household B's custom stores in autocomplete or via direct REST query.
8. Picker works via tap (voice-input mirror is implicit — the input field accepts speech-to-text from the OS keyboard).
9. PWA realtime: a household member adding a store on phone A propagates to phone B within 1s (mirrors `list_entries` realtime via 013's publication pattern).
10. Defense-in-depth: a stale-tab `list_entries` insert against a removed store fails with `P0001 'store ... is not in household ...'` at the DB layer (trigger), regardless of RLS state.

## Rollout / rollback

### Rollout

Single PR. Auto-deploys via existing pipelines:

- `.github/workflows/deploy-migrations.yml` ships migration 016 to prod Supabase on push to `main` (path-filtered to `supabase/migrations/**`).
- `.github/workflows/deploy-functions.yml` ships the updated `add-item` edge function (path-filtered to `supabase/functions/**`).
- Vercel auto-deploys the front-end on merge to `main`.

**Migration-vs-Vercel deploy race window** (per existing CLAUDE.md gotcha): single PR ships both the migration and the front-end. There's a ~2-5 minute window where Vercel may have shipped the new UI calling `add_household_store()`/`remove_household_store()` while `deploy-migrations.yml` hasn't finished applying migration 016 yet — picker interactions during this window may fail with `function not found` errors mapped to `StoreError 'unknown'`. **PR test plan hard-blocker**: monitor `deploy-migrations.yml` AND `deploy-functions.yml` AND Vercel deploy. Do NOT announce until all three show success.

### Rollback

Migration 016 is **additive — fully reversible**. New table, new RPCs, two new columns on `stores`, one trigger, one config row, one realtime publication addition. The dropped `stores_name_key` UNIQUE constraint CAN be re-added on rollback because no rollback-time custom rows exist (they only get minted post-migration). Forward fix is preferred over rollback because dropping the migration would orphan `household_stores` FKs to `stores(id)` and `households(id)` for any rows minted between migration apply and rollback.

```sql
-- Rollback (run in this order; verify zero custom rows exist first):
alter publication supabase_realtime drop table household_stores;
drop trigger if exists list_entries_store_membership_check on list_entries;
drop function if exists check_list_entries_store_in_household_stores();
drop function if exists remove_household_store(uuid);
drop function if exists add_household_store(uuid, text);
drop policy if exists "stores_select" on stores;
create policy "stores_select" on stores for select using (auth.uid() is not null);
delete from config where key = 'store_name_match_threshold';
drop policy if exists "household_stores_select" on household_stores;
drop table if exists household_stores;
drop index if exists stores_name_trgm_idx;
-- Verify no custom rows: select count(*) from stores where is_global = false;
-- If 0: safe to drop columns. If >0: forward-fix instead of rollback.
alter table stores drop column if exists is_global;
alter table stores drop column if exists created_by_household_id;
-- Restoring stores_name_key UNIQUE only safe if no duplicate names exist.
alter table stores add constraint stores_name_key unique (name);
notify pgrst, 'reload schema';
```

**Code-side rollback** is `git revert` on the merge commit. The CLAUDE.md gotcha additions, METRICS additions, migration, RPC wrappers, picker component, edge-function change all revert cleanly. PostHog event ingestion of the 4 new events is harmless — events stop arriving; PostHog keeps historical rows.

**Risk profile**: low. Schema is purely additive; trigger and RLS scope are defense-in-depth (the application layer is the primary gate); routing fallback is a UX improvement (the silent_match path still works for in-MyStores predictions). The 5 integration cases + 1 pure-file test + 6 E2E cases cover every load-bearing assumption.

## Out-of-band deploy items

Per the existing CLAUDE.md gotcha § "Edge function changes need explicit deploy step": this PR touches `supabase/functions/add-item/index.ts` AND the PR test plan must include the deploy-functions monitoring callout. `deploy-functions.yml` handles this automatically on push to main, but the hand-off to `/ak-go-live` must surface a checklist:

- [ ] `deploy-migrations.yml` succeeded for `supabase/migrations/016_household_stores.sql`.
- [ ] `deploy-functions.yml` succeeded for `supabase/functions/add-item/`.
- [ ] Vercel preview deploy succeeded; production deploy succeeded post-merge.
- [ ] Pre-merge slow-job CI E2E case "Routing fallback (D5)" passed against deployed-function code (per the existing gotcha — frontend calling old function on a stale env would silently still route to a removed store).
- [ ] Post-deploy canary: tap `/settings` → My Stores section renders on lalista.store; type "Costco" in the autocomplete — top suggestion appears.

No SMTP / dashboard / Resend / template work is required for this PR — pure UI + DB + edge-fn feature; no email surface, no Auth → URL Configuration entry change, no Sentry config change.
