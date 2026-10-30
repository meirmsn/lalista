<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: disambig-add-new -->
<!-- date: 2026-04-23 -->

# Spec: disambig-add-new (PR 5)

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1i` — primary scope (`DisambiguationSheet` add-new row, edge function `force_create_with_label` branch, analytics)
- `PLAN.md § Planned #2` — feature row + scope summary
- PR-15 review feedback (UX gap surfaced by typing "papas" — fuzzy-matched candidates with no escape hatch)
- `apps/web/components/DisambiguationSheet.tsx` + `.test.tsx` — current implementation (radio-list, cascading store-followup) shipped in core-flows
- `supabase/functions/add-item/index.ts` — current edge function shape (NLP + trigram + store routing)
- `packages/core/src/models/index.ts` — `AddItemRequest` / `AddItemResponse` types
- `METRICS.md § item_added` — current event shape (`{ store_id, was_disambiguated, input_language }`)
- Prior spec `specs/core-flows/spec.md` — style + structure reference

PR 3 (core-flows) shipped `DisambiguationSheet` with a radio list of fuzzy-matched candidates and required cascading store disambig. The sheet currently forces a pick from existing candidates — typing "papas" against a seed/DB without that label leaves the user stuck on a list of near-misses with no way to add the literal utterance. PR 5 adds the "None of these — add as new" escape hatch as a final radio row, plus a `force_create_with_label` edge-function branch that bypasses NLP/trigram and inserts the utterance verbatim. No schema migration; no Swift parity (Swift lacks this too — genuine new territory).

---

## Decisions (resolved at spec time)

5 `/ak-spec`-time decisions resolved in Phase 0 with the user. Recorded below verbatim so Phase 1 preserves them and a crashed Phase 1 can resume without re-asking.

### D1: Add-new row always shown (not gated by candidate count)

**Decision:** the add-new row appears at the bottom of every disambiguation sheet, regardless of how many candidates the server returned.

**Rationale:** predictable UX. The worst failure mode is "I saw the option last time, where did it go?" — gating by `candidate_count < 3` creates exactly that. Visual noise from one extra radio is mitigated by D4's distinct styling. Always-show is also robust to the edge case where future server-side changes alter the candidate count threshold.

### D2: Direct-add (no undo toast)

**Decision:** confirming the add-new row closes the sheet and inserts immediately, same as a normal add. No 5-second undo affordance.

**Rationale:** matches the rest of v0 — normal item adds are direct. v0 has no toast/undo infrastructure today; introducing it for this one path expands scope. If a user types junk and adds it, they can Remove it from item-detail (already exists, shipped in core-flows). Defer undo to v1 polish if user testing shows new-item entries are higher-regret than normal adds.

### D3: Extend `item_added` with `was_force_created: boolean` (not a new event)

**Decision:** instead of adding a new `item_added_new` event, extend the existing `item_added` event with a `was_force_created: boolean` property. Set `true` when the add came from the force-create path; omit (or `false`) otherwise.

**Rationale:** keeps the event taxonomy flat — pairs naturally with the existing `was_disambiguated` boolean (both are adverbs on the same verb). PostHog funnels stay simple (one event to filter). v1 won't suddenly need 50 event variants. Property is queryable just like the existing booleans.

### D4: Visual treatment — separator gap above + `+` icon prefix on the label (design review refines)

**Decision:** light-touch styling for the add-new row: a separator gap (e.g., 12–16px margin-top + thin divider above) plus a `+` icon prefix on the label "Add '{utterance}' as new". No dashed border, no "Or:" header.

**Rationale:** dashed border reads desktop-form-builder, off-voice for lalista's restrained terracotta aesthetic. "Or:" header adds wordiness in two languages (es/en) without payoff. The separator + icon is enough to mark the row as semantically distinct from the radio candidates above it. PRODUCT-ROADMAP.md explicitly defers final pixels to design review (Gate 8 in `/ak-pre-ship`); this is the proposed starting point, expected to land within a few px of the final.

### D5: METRICS.md change — add `was_force_created` property to existing `item_added` row (mechanical follow-through from D3)

**Decision:** in METRICS.md, edit the `item_added` row's properties cell to add `was_force_created: boolean`. Do NOT create a new event row.

**Rationale:** consequence of D3. Flagging as its own decision because METRICS.md edits are part of every PR that adds/changes events; the edit lands in the same commit as the analytics call-site.

---

## Core user story

1. Sign in to a household with a populated list (or empty — same flow). Tap the FAB.
2. Type an utterance the seed/DB doesn't know — e.g. `papas` against a household whose `items` table doesn't yet contain `papas`. Tap Add.
3. The server returns `needs_followup: true` with a handful of fuzzy-matched candidates that aren't what the user meant (e.g. `palmito`, `papaya`, `pasta`). The disambiguation sheet renders the candidates as the existing radio list — and one extra row at the bottom: `+ Add "papas" as new`.
4. The user picks the add-new row and taps Confirm. The sheet closes; a row for `papas` appears in the list under whichever store the routing landed on (or after a cascading store follow-up if no history exists).
5. PostHog receives `item_added` with `was_force_created: true`. No `disambiguation_log` row is written for the user-override step.

The existing `apps/web/e2e/core-flows-qa-walk.spec.ts` already exercises the disambig sheet (verb 3 in the cascading-disambig path); the add-new row materially extends what verb 3 surfaces but does not change the cascading-disambig contract. **Decision:** no separate qa-walk artifact for this PR — extend the existing E2E coverage in `core-flows.spec.ts` (Tests § E2E) rather than spinning up a new `specs/disambig-add-new/qa-walk/` tree. If `/ak-pre-ship` Gate 9 flags the verb-3 artifact as stale because the radio list now has one extra row, recapture in place.

---

## In scope

- **`DisambiguationSheet` add-new row** (`apps/web/components/DisambiguationSheet.tsx`): a final `role="radio"` row appended to the existing `<div role="radiogroup">`, separated from the candidate radios by a thin divider + small top margin. Label: `+ Add "{originalUtterance}" as new`. Participates in arrow-key navigation. Selectable like any other radio; Confirm works the same way.
- **`handleConfirm` branch** when the add-new row is the selected option: skip the existing slot-mapping (`candidateItemId` / `confirmedStoreId` / `confirmedBrand`) and call `invokeAddItem(client, { utterance: originalUtterance, householdId, forceCreateWithLabel: true })`. On the response, run the same post-confirm flow as today (cascading follow-up, PostHog events, close).
- **`packages/core/src/api/addItem.ts` wrapper**: extend `AddItemParams` with `forceCreateWithLabel?: boolean`; forward it as `force_create_with_label` in the request body.
- **`packages/core/src/models/index.ts`**: add `added_new?: boolean` to `AddItemResponse` so the client can branch its analytics on the response (per D3 — extend the existing `item_added` event with `was_force_created: true` when the response says so).
- **`supabase/functions/add-item/index.ts` force-create branch**: new `force_create_with_label?: boolean` field on `AddItemRequest`; when true, skip NLP/trigram/`candidate_item_id` resolution; insert `items(name_canonical = utterance)`; on `23505 unique_violation`, look up the existing row by `name_canonical` and proceed via the existing-candidate path; continue with store routing (history-routed or `confirmed_store_id`) exactly as today; insert `list_entries`; **skip** `disambiguation_log`; return `AddItemResponse` with `needs_followup: false`, `canonical_item.name = utterance`, `added_new: true`.
- **Analytics**: `apps/web/components/DisambiguationSheet.tsx` passes `was_force_created: true` to `trackItemAdded` when `next.added_new === true`. Property defaults to omitted/`false` for every other call site.
- **METRICS.md**: add `was_force_created: boolean` to the `item_added` row's properties cell. No new event row.

## Out of scope

- Undo affordance / 5-second toast (per D2 — direct add, no undo).
- New PostHog event `item_added_new` (per D3 — extend existing event).
- `items.is_custom boolean` schema column (deferred to v1 if analytics surfaces the need).
- Edge function integration test for the force-create path (deferred to PR 4 / § 1g; see Tests § Edge-function integration).
- Quantity-merge if the force-created label happens to collide with a pending entry — the `name_canonical` race fallback drops into the existing-candidate path, which already runs the dedup check + `already_on_list` branch; no additional handling needed.
- Bilingual normalization beyond what the existing path does — utterance is stored verbatim as `name_canonical`. The existing edge function does **not** lowercase or trim before `findItemByTrigram` (verified by reading `add-item/index.ts`); the force-create branch matches that behavior to keep `unique_violation` semantics aligned with the existing index. If a future spec wants normalized canonical names, that's a roadmap task with a backfill migration.
- Pixel-perfect divider weight + spacing — defers to design review per D4 (the spec gives the starting point; `/ak-pre-ship` Gate 8 is authoritative).
- Inline copy review of the add-new row label across `es` / `en` — current label is English-only (`+ Add "{utterance}" as new`); a bilingual rewrite is deferred. The utterance itself preserves the user's language.

## Screens

**Only changed surface: `apps/web/components/DisambiguationSheet.tsx`.** No new pages, no new components. The add-new affordance lives inline inside the existing `<div role="radiogroup">`.

**What the user sees** (per D4):

- Below the last candidate radio, a 1px divider in `border-border` with ~`mt-md` (12–16px) breathing room.
- One more `<button role="radio">` row, same touch-target rules as the candidate rows (`min-h-[44px]`, `rounded-default`, `border border-border`, hover state).
- Label: `+ Add "{originalUtterance}" as new`. The `+` glyph is the literal ASCII character prefixing the text — kept as a string for v0 (no icon dependency); the design review may upgrade to an inline SVG `+` if the typographic `+` reads weak. Use existing tokens only (`text-text-primary`, `font-body`, `text-[15px]`).
- Standard radio indicator on the left (22px circle, terracotta inner dot when selected) — semantically identical to the candidate radios so arrow-key navigation Just Works.
- Confirm/Cancel footer unchanged. Confirm enables when this row is selected (same `selectedId !== null` gate).
- When this row is the selection, the Confirm button label remains `Confirm`. No special verb (e.g. "Add new") — matches D2's "treat it like a normal add" framing.

**Voice / DESIGN.md alignment** (D4): no dashed border ("desktop form builder"), no `Or:` header ("wordy in two languages"). Restraint: the row reads as one of the radios with a quiet visual marker — the divider gap + the `+` icon. Matches the design system's "one strong accent against warm neutrals" principle (DESIGN.md § Color Approach) and the canonical voice example's preference for a single, well-placed gesture (DESIGN.md § Know when to stop).

**Special cases**:

- `already_on_list && followup_type === 'quantity'`: the existing branch renders a single OK button instead of the radio list. The add-new row **does NOT render** in this branch — there are no candidates to disambiguate against, and the user explicitly already has the item.
- `followup_type === 'brand'`: the add-new row **does** render. Picking it bypasses the brand confirmation entirely and force-creates the literal utterance as a new canonical item — a power-user escape hatch from a brand-disambig the user didn't expect.
- Empty `followup_options[]` (defensive — server shouldn't return this with `needs_followup: true`, but the type allows it): the radio group renders only the add-new row. Confirm + add-new still works.

## Data model changes

**No migration required.** Existing `items.name_canonical` `UNIQUE` index handles dedup. No new columns, no new RLS policies, no RPC changes. `packages/core/src/supabase.types.ts` is not regenerated.

## API contracts

**`packages/core/src/models/index.ts`** — extend `AddItemResponse`:

```ts
export interface AddItemResponse {
  // ...existing fields...
  /**
   * Set true when the server resolved the add via the force-create branch
   * (user picked "Add as new" in the disambig sheet). Used by the client to
   * tag the `item_added` PostHog event with `was_force_created: true`.
   * Absent on every other path.
   */
  added_new?: boolean;
}
```

**`packages/core/src/api/addItem.ts`** — extend `AddItemParams`:

```ts
export interface AddItemParams {
  // ...existing fields...
  /**
   * When true, the edge function skips NLP/trigram/candidate_item_id
   * resolution and inserts a new `items` row with `name_canonical = utterance`.
   * On unique-violation, the request falls through to the existing-candidate
   * path. Used by the disambig sheet's "Add as new" row.
   */
  forceCreateWithLabel?: boolean;
}
```

The wrapper forwards it in the request body as `force_create_with_label: params.forceCreateWithLabel`.

**`supabase/functions/add-item/index.ts`** — force-create branch semantics:

1. Add `force_create_with_label?: boolean` to the `AddItemRequest` interface (line 25 of the file today).
2. Destructure it from `body` alongside existing fields.
3. Add `added_new?: boolean` to the local `AddItemResponse` interface to match `packages/core`.
4. **Branch placement**: immediately after `if (!utterance || !household_id) { ... }` and before the config fetch. Force-create skips config thresholds entirely (no NLP/trigram path runs).
5. **Branch body**:
   - Try `supabase.from('items').insert({ name_canonical: utterance }).select('id, name_canonical').single()`.
   - On success: `chosenItem = inserted; matchScore = 1.0` (treat as a confirmed canonical item). Continue into the existing store-resolution + dedup + `list_entries` insert path (sections (c)–(e) of the current handler). The dedup check naturally returns `already_on_list` if the same user just force-created the same label twice.
   - On error with `code === '23505'` (unique_violation): another writer just inserted the same `name_canonical`. Look up the existing row via `supabase.from('items').select('id, name_canonical').eq('name_canonical', utterance).single()` and assign to `chosenItem`. Continue into the same store-resolution path.
   - On any other insert error: return `jsonResponse({ error: 'Failed to add item' }, 500)`.
6. **`disambiguation_log`**: do NOT call `logDecision()` from this branch — the user override is not an NLP scoring decision.
7. **Final response**: when the `list_entries` insert succeeds, set `added_new: true` on the response payload. When the dedup branch fires (`already_on_list: true`), `added_new` may also be true — set it whenever the request hit the force-create branch, even on `already_on_list`.

**Bilingual handling**: the utterance is stored verbatim as `items.name_canonical`. The existing edge function passes `utterance` to `findItemByTrigram` without trimming or lowercasing (verified — `add-item/index.ts` line 121 passes the raw string). The force-create branch matches that — no normalization. The `name_canonical UNIQUE` index is case-sensitive at the column level, so `Papas` and `papas` are distinct items today; this PR neither fixes nor worsens that. Flag for v1 if it causes duplicate-noise.

## Offline behavior

Same as the existing add-item path — online-only with error state. `invokeAddItem` failures (network, 500) surface inline in the disambig sheet's existing `<Text role="alert">` area; the sheet stays open so the user can retry. No queueing, no local persistence. Matches `specs/core-flows/spec.md § Offline behavior`.

## Metrics

**No new event.** `item_added` (already in `METRICS.md`) gains one optional property:

| Event        | Property            | Type      | Set when                                                                                             |
| ------------ | ------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `item_added` | `was_force_created` | `boolean` | `true` when the add resolved via the force-create branch (`response.added_new === true`); else omit. |

**Call site**: `apps/web/components/DisambiguationSheet.tsx`'s `handleConfirm` success branch — when `next.added_new === true`, pass `was_force_created: true` to `trackItemAdded`. The existing `was_disambiguated: true` stays true (the user came through the disambig sheet, even if they overrode).

**`trackItemAdded` signature change** (`apps/web/lib/analytics.ts`): add `was_force_created?: boolean` to the properties type. Default-omit (do not pass `false`) so PostHog event payloads stay minimal for the common path. Existing `AddItemSheet.tsx` call site does not change.

**METRICS.md edit**: edit the `item_added` row's "Key properties" cell to include `was_force_created: boolean` (per D5).

## Files to create / modify

**Create**: none. (No new components, no new files.)

**Modify**:

| File                                               | Rationale                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/models/index.ts`                | Add `added_new?: boolean` to `AddItemResponse`.                                                                                                                          |
| `packages/core/src/api/addItem.ts`                 | Add `forceCreateWithLabel?: boolean` to `AddItemParams`; forward as `force_create_with_label` in request body.                                                           |
| `packages/core/src/api/addItem.test.ts`            | New test: `forwards forceCreateWithLabel as force_create_with_label`. Existing tests unchanged.                                                                          |
| `supabase/functions/add-item/index.ts`             | Add `force_create_with_label?: boolean` to request type + `added_new?: boolean` to response type; insert force-create branch (with `23505` race fallback); skip log.     |
| `apps/web/components/DisambiguationSheet.tsx`      | Render add-new radio row at bottom of radio group; branch `handleConfirm` on a sentinel `selectedId` value to call `invokeAddItem({ ..., forceCreateWithLabel: true })`. |
| `apps/web/components/DisambiguationSheet.test.tsx` | New test cases per Tests § Component below.                                                                                                                              |
| `apps/web/lib/analytics.ts`                        | Add optional `was_force_created?: boolean` to `trackItemAdded` properties.                                                                                               |
| `apps/web/e2e/core-flows.spec.ts`                  | Extend (or add a focused block) for the xyzzy-test add-new flow.                                                                                                         |
| `METRICS.md`                                       | Add `was_force_created: boolean` to the `item_added` properties cell.                                                                                                    |
| `PLAN.md`                                          | Move `disambig-add-new` row Planned → Active when implementation starts; mark shipped on merge.                                                                          |
| `BUILD-LOG.md`                                     | Append PR 5 entry on merge (handled by `/ak-go-live`).                                                                                                                   |
| `CLAUDE.md`                                        | No change — no new gotcha (the force-create branch is internal to the edge function; the contract change surfaces via TypeScript types).                                 |

## Tests

Layered approach matching `specs/core-flows/spec.md`. Behavior assertions, not markup.

### Unit

`packages/core/src/api/addItem.test.ts` — extend with one new case:

- `forwards forceCreateWithLabel as force_create_with_label`: call `invokeAddItem(c, { utterance: 'papas', householdId: 'h', forceCreateWithLabel: true })`; assert the body sent to `client.functions.invoke` includes `force_create_with_label: true` (and that `candidate_item_id` / `confirmed_store_id` / `confirmed_brand` remain `undefined`).

(Note: the wrapper test lives in `packages/core/src/api/addItem.test.ts`. The roadmap referenced `items.test.ts`, but `invokeAddItem` lives in `api/addItem.ts` and its test in `api/addItem.test.ts` — verified.)

### Component

`apps/web/components/DisambiguationSheet.test.tsx` — add four cases:

1. **Add-new row renders at the bottom with the utterance text**. Render with `originalUtterance: 'papas'` and the standard `storeResponse()`. Assert: `screen.getAllByRole('radio')` length is `candidates.length + 1`; the **last** radio's accessible name contains `papas` and `add` and `new`.
2. **Selecting + confirming calls `invokeAddItem` with `forceCreateWithLabel: true` and NOT `candidateItemId`**. Click the add-new radio; click Confirm. Assert `invokeAddItemMock` was called with `{ utterance: 'papas', householdId: 'house-1', forceCreateWithLabel: true }` and that `candidateItemId` and `confirmedStoreId` are absent (or `undefined`). Mock the response with `{ entry_id: 'e-1', canonical_item: { id: 'i-99', name: 'papas' }, store: { id: 's-1', name: 'Costco' }, brand: null, needs_followup: false, added_new: true }`.
3. **Success response closes the sheet and fires `item_added` with `was_force_created: true`**. Same setup as #2; after the confirm resolves, assert `props.onClose` was called and `captureMock` saw `('item_added', { store_id: 's-1', was_disambiguated: true, was_force_created: true, input_language: 'en' })`.
4. **The add-new row participates in radio-group keyboard nav**. Render; tab to the radiogroup, press Down arrow until reaching the last radio; assert the last radio has `aria-checked='true'` (or focus, depending on whether the implementation uses native radios vs ARIA — assert the same observable behavior the candidate radios have today). If the implementation uses click-only radios, assert the `tabIndex`/`role` shape matches the existing radios so a future arrow-key wiring won't accidentally exclude this row.

The existing tests (`store variant`, `item variant`, `brand variant`, `already_on_list`, `cascading follow-up`, `network error`, `Escape`, `renders nothing when response is null`) must continue passing unchanged.

### E2E

`apps/web/e2e/core-flows.spec.ts` — extend (recommended) or add a focused spec `apps/web/e2e/disambig-add-new.spec.ts`:

- Sign up + create household (reuse the timestamped-email pattern already in the file).
- Land on `/list`, tap FAB, type `xyzzy-test-item-${Date.now()}` (guaranteed not in seed/DB), tap Add.
- Wait for the disambig dialog (it will appear because trigram returns no candidates → cold-start path → the server returns `needs_followup: true, followup_type: 'item'` with an empty `followup_options[]`, OR a few near-misses if any seed items happen to fuzzy-match — both shapes render the add-new row).
- Click the radio whose name matches `/add .*xyzzy-test-item.* as new/i`; click Confirm.
- (If a cascading store-disambig follows, pick the first store + Confirm.)
- Assert a row matching the typed utterance appears in the list.

(Note: the cold-start path in `add-item/index.ts` line 194–202 returns `needs_followup: true, followup_type: 'item'` with no `followup_options` — the spec already calls out this defensive branch in § Screens § Special cases. The add-new row must render even when `followup_options` is empty, otherwise the cold-start E2E above has no escape hatch.)

### Edge-function integration

**Deferred**: gated on PR 4 (§ 1g) shipping the CI slow job. When that lands, write integration tests covering:

- Force-create path inserts a new `items` row with `name_canonical = utterance`.
- Force-create path inserts a `list_entries` row pointing at the new item.
- Two simultaneous force-creates of the same utterance — assert both end with the same `items.id` (the second hits the `23505` fallback) and both insert a `list_entries` row.
- `disambiguation_log` has zero new rows attributable to the force-create requests.

Note in the Tests section so `/ak-pre-ship` does not flag this as missing in PR 5's review window.

### qa-walk

No separate qa-walk for this PR. The `core-flows-qa-walk.spec.ts` "verb 3" cascading-disambig step renders the radio list — adding one extra row at the bottom is observably a visual change to the verb-3 artifact but not a contract change. **Action**: re-record the verb-3 PNG as part of this PR's pre-ship; do not introduce a parallel qa-walk tree.

## Dependencies

None new. No library adds. The `+` glyph is a literal character in the label string — no icon dependency. Confirmed by re-reading `apps/web/package.json` requirements is unnecessary; if implementation discovers an icon set is desirable for the prefix, swap to an inline SVG (no dep) or use whatever the existing list/buy buttons use.

## Task order

Dependency-ordered. Each task can ship as one atomic commit (or grouped where natural).

1. **Models** — `packages/core/src/models/index.ts`: add `added_new?: boolean` to `AddItemResponse`.
   _Tests: none (type-only)._
2. **Wrapper** — `packages/core/src/api/addItem.ts`: add `forceCreateWithLabel?: boolean` to `AddItemParams`; forward as `force_create_with_label` in body.
   _Tests: extend `packages/core/src/api/addItem.test.ts` with the `forwards forceCreateWithLabel` case._
3. **Edge function** — `supabase/functions/add-item/index.ts`: add `force_create_with_label?: boolean` to request type + `added_new?: boolean` to response type; insert the force-create branch immediately after the `(!utterance || !household_id)` validation; on `23505` look up the existing row by `name_canonical` and proceed; skip `logDecision`.
   _Tests: none in this PR (deferred per § Tests § Edge-function integration). Smoke locally via `supabase functions serve` if practical; otherwise rely on the E2E._
4. **DisambiguationSheet UI + handler** — `apps/web/components/DisambiguationSheet.tsx`: render the add-new radio row (divider + `+` prefix label); use a sentinel `selectedId` value (e.g. `'__add_new__'`) so the existing `handleConfirm` signature stays type-safe; branch in `handleConfirm` on the sentinel to call `invokeAddItem({ ..., forceCreateWithLabel: true })` (without `candidateItemId` / `confirmedStoreId` / `confirmedBrand`); pass `was_force_created: true` to `trackItemAdded` when `next.added_new === true`.
   _Tests: extend `DisambiguationSheet.test.tsx` per § Tests § Component (4 new cases)._
5. **Analytics signature** — `apps/web/lib/analytics.ts`: add optional `was_force_created?: boolean` to `trackItemAdded` properties.
   _Tests: none required (call sites are exercised by the component test); existing analytics-shape tests stay unchanged._
6. **METRICS.md** — edit `item_added` row's properties cell to include `was_force_created: boolean`.
   _Tests: none._
7. **E2E** — `apps/web/e2e/core-flows.spec.ts`: append the xyzzy-test-item flow per § Tests § E2E.
   _Tests: this is the test._
8. **PLAN.md** — flip `disambig-add-new` row Planned → Active on implementation start; mark Shipped on merge (via `/ak-go-live`).
   _Tests: none._

Tasks 1–3 are server/contract changes and can land in one commit. Task 4 depends on tasks 1 + 2 + 3 being callable. Tasks 5–7 depend on task 4. Task 6 (METRICS) and task 8 (PLAN) are documentation and can land alongside their respective code commits.

## Gotchas

- **Unique-violation race**: if two users (or one user double-tapping) force-create the same `name_canonical` simultaneously, the second `items.insert` returns Postgres error code `23505` (`unique_violation`). The branch must catch that **specific** code (not all errors — a real failure should still 500), look up the now-existing row via `select('id, name_canonical').eq('name_canonical', utterance).single()`, assign to `chosenItem`, and proceed via the existing-candidate path (`matchScore = 1.0`, downstream dedup runs as normal). The existing `already_on_list` branch in (c) handles the case where the colliding item already has a pending entry. Test this race in the deferred edge-function integration suite; do not block PR 5 on it.
- **Skip `disambiguation_log`**: the force-create path is an explicit user override, not an NLP scoring decision worth logging. Do NOT call `logDecision()` in this branch (neither for the success path nor the `already_on_list` path). The cold-start log in lines 184–192 is also bypassed because the branch returns before that code runs.
- **Edge function `auth.uid()` semantics**: the force-create path still needs an authenticated user (it inserts into `items` and `list_entries`). The existing auth gate at lines 60–76 (`getUser(token)` after Authorization header check) covers the new branch — no second auth check needed. Do **not** duplicate the `getUser` call inside the branch.
- **DESIGN.md tokens**: stick to existing tokens (`border-border`, `text-text-primary`, `font-body`, `bg-surface-2` for hover). The `+` icon is literal ASCII; if design review prefers an inline SVG, use `currentColor` for the stroke and inherit text size — do not add an icon library.
- **`AddItemSheet` call site stays unchanged**: that surface never sets `forceCreateWithLabel` (only the disambig sheet's add-new row does). Resist any refactor that pushes the param through `AddItemSheet` — the only entry point is the user explicitly choosing the add-new row after seeing the candidates.
- **Sentinel `selectedId` value**: the radio group already uses `id` strings from `followup_options[]`. Use a distinctive sentinel for the add-new row (e.g. `'__add_new__'`) and check for it in `handleConfirm` before the existing slot-mapping logic. Document the sentinel inline so future readers don't try to send it to the server.
- **`already_on_list` exit before Confirm**: the existing `already_on_list && followup_type === 'quantity'` branch returns early without rendering the radiogroup. Do not render the add-new row inside that branch — there are no candidates to escape from.
- **Cold-start path returns `followup_options: undefined`**: lines 194–202 of the edge function return `needs_followup: true, followup_type: 'item'` with no `followup_options`. The component must render the add-new row even when `options.length === 0` so the cold-start path has an escape hatch. Today's implementation iterates `options.map(...)` inside the radiogroup; appending the add-new row outside that map (after the closing `)})}` of the map) keeps it visible regardless of `options` length.

## Acceptance / rollout / rollback

### Acceptance (before merging)

- [ ] `pnpm turbo run lint` clean.
- [ ] `pnpm turbo run typecheck` clean.
- [ ] `pnpm turbo run test:unit` green; `addItem.test.ts` and `DisambiguationSheet.test.tsx` exercise the new cases.
- [ ] `pnpm --filter @lalista/web exec playwright test` green at 375 + 1440 (mobile + desktop projects); the xyzzy-test add-new flow passes.
- [ ] `pnpm turbo run build` green.
- [ ] METRICS.md `item_added` row mentions `was_force_created`.
- [ ] PLAN.md row moved to Active (or Shipped on merge).
- [ ] `/ak-pre-ship` gates pass.
- [ ] Hero shot: disambig sheet with the add-new row visible (light + dark, mobile + desktop) attached to the PR.

### Rollout

- Ships with the PR. **No flag, no migration, no env vars.**
- Edge function deploy via `supabase functions deploy add-item --no-verify-jwt` (matches the existing TODO in `add-item/index.ts` header — this PR does not change that).
- Vercel auto-deploys on merge to `main`.
- PostHog `was_force_created` property surfaces in the next `item_added` event after deploy; no schema setup required (PostHog auto-discovers properties).

### Rollback

Revert the merge commit. The new code paths are **purely additive**:

- No removed routes.
- No removed columns.
- No removed event names.
- The wrapper / model / edge-function changes are backwards-compatible (existing clients without `forceCreateWithLabel` continue to hit the existing path; existing servers without the branch reject `force_create_with_label` as an unknown body field — but the existing client never sends it).

Order of revert: revert the web commit first (clients stop sending `force_create_with_label`), then revert the edge-function deploy (removes the branch). Either order works because the branch is gated on the field being `true`. No data corruption risk — `items` rows force-created during the live window stay in the table as legitimate canonical items.

## Open questions

None. The 5 Phase-0 decisions cover every spec-time choice. No new spec-time decisions were surfaced while expanding the spec.
