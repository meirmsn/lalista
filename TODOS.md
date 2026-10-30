# TODOS

Project bugs and small fixes — tactical work that doesn't warrant a roadmap chapter.
Each item is self-contained — context included so an AI agent or future contributor
can act on it without reading other docs.

Organized by version to mirror `PRODUCT-ROADMAP.md`:

- **v0** — lands before the current-version migration ships. Subgrouped by when it runs: pre-ship / launch-day.
- **v1** / **v+** — deferred to future versions.

Chapter-grain roadmap: `PRODUCT-ROADMAP.md`. Near-term PR queue: `PLAN.md`. Shipped: `BUILD-LOG.md`.

---

## v0

### Pre-ship — must land in a PR before v0 ships

#### disambig-sheet-auto-close-on-banner-symmetry

**What:** Mirror `AddItemSheet`'s auto-close-on-banner-truthy `useEffect` onto `DisambiguationSheet` so its z-30 backdrop overlay doesn't intercept the `SyncErrorBanner`'s Retry / Undo buttons when a disambig pick exhausts the Tier A2 retry budget.

**Why:** `AddItemSheet` got this fix during the `app-snappiness` (PR #49) CI fix-loop after Playwright's pointer-events check caught the overlay intercepting Undo clicks. Both sheets share the same shape — `fixed inset-0 z-30 flex` dialog + `absolute inset-0 bg-black/40` close-overlay button + `useOptimisticMutation({ failureMode: 'banner' })` hook hosted inside the sheet, with banner state hoisted to `ListClient` via `onSubmissionBanner`. If a disambig pick fails three times against `RETRY_BACKOFF_MS = [1000, 3000, 7000]`, the banner appears at the page level but the disambig overlay still covers it — the same Playwright failure mode that triggered the AddItem fix is silently lurking. Captured in `specs/app-snappiness/test-review-followup.md` as Phase 5.8 medium finding #4.

**Where:**

- `apps/web/components/DisambiguationSheet.tsx` — add a `useEffect(() => { if (submission.banner) onClose(); }, [submission.banner, onClose])` next to the existing `onSubmissionBanner` propagation effect, mirroring `AddItemSheet.tsx:176-178`.
- `apps/web/e2e/disambig-banner.spec.ts` (new) — parallel of `add-item-banner.spec.ts`. Force the disambig insert RPC to abort via `page.route('**/list_entries**', route => route.abort())` (or similar — verify the endpoint pattern), assert the banner surfaces, assert Undo is clickable (no overlay interception), assert it clears the banner.
- `apps/web/components/DisambiguationSheet.test.tsx` (optional) — symmetric unit test to AddItemSheet's "network error keeps the sheet open through the first attempt" pinning the auto-close on banner truthy.

**Acceptance:**

- E2E forces a disambig pick to fail past the retry budget and the banner's Retry+Undo are reachable + functional.
- Existing disambig happy-path tests still pass.
- No `useEffect` deps lint warnings.

**Effort:** ~30 min — the AddItem fix is the literal blueprint; copy the effect, mirror the test, done.

**Source:** `specs/app-snappiness/test-review-followup.md § Medium #4` (Phase 5.8 audit on PR #49).

### Launch-day — operational, run at or immediately after v0 launch

#### bootstrap-purchase-history-prod

**What:** Seed `purchase_history` for the real household with the historical item+store data so `route_item_to_store` has signal from day one and doesn't ask "which store?" for every add.

**Why:** The `items` and `stores` tables are pre-populated via `seed.sql`, but purchase history requires a real `household_id` and `user_id` — those only exist after the account is created in prod. Without this, every add triggers store disambiguation even for items we always buy at the same place.

**How:**

1. Sign in to the prod app and note your `household_id` (visible in Supabase dashboard → Table Editor → `household_members`)
2. Run the following in the Supabase SQL editor, replacing `<household_id>` and `<user_id>`:

```sql
-- Helper: insert purchase history for a given item+store by name
-- Run once per household after seed.sql has been applied

do $$
declare
  hid uuid := '<household_id>';
  uid uuid := '<user_id>';
begin
  -- Flat 'yesterday' timestamp on every row: multi-store items tie on
  -- time-weighted frequency at seed time, so the first real add tips
  -- routing instead of random noise picking arbitrarily.
  insert into purchase_history (household_id, item_id, store_id, bought_at, added_by)
  select hid, i.id, s.id, now() - interval '1 day', uid
  from (values
    -- one row per (item, store) the household usually buys, e.g.
    ('Leche entera',                      'Walmart'),
    ('Mozzarella rallado',                'Costco')
  ) as v(item_name, store_name)
  join items  i on i.name_canonical = v.item_name
  join stores s on s.name           = v.store_name
  on conflict do nothing;
end $$;
```

**Context:** `route_item_to_store` uses time-weighted purchase frequency to route items silently. Without history, every item triggers "Which store?" disambiguation. After this runs, the most common items will route silently. Run once, immediately after creating the prod household.

**Depends on:** Prod account created and `household_id` + `user_id` known.

---

## v1

### Features

#### apple-sso

**What:** Sign in with Apple on the web sign-in screen, replacing the commented stub in `apps/web/app/(auth)/sign-in/page.tsx`.

**Why:** Deferred from PR 2 (auth) because Sign in with Apple requires a paid Apple Developer account ($99/yr, 1–2 day approval), a Service ID, production-domain verification, and a configured Supabase Auth provider. Email/password unblocks v0 without it.

**How:**

Phase 1 — Apple infrastructure (one-time):

1. Enroll at developer.apple.com ($99/yr). Approval: 1–2 days.
2. In Apple Developer portal → Identifiers → Service IDs — register a Service ID + private key.
3. Register the production domain for Sign in with Apple (requires DNS verification).

Phase 2 — Supabase configuration:

4. Supabase dashboard → Authentication → Providers → Apple → enter Service ID + key.

Phase 3 — Web implementation:

5. Replace the `{/* TODO(apple-sso) */}` stub in `apps/web/app/(auth)/sign-in/page.tsx` with a `<Button>` that calls `supabase.auth.signInWithOAuth({ provider: 'apple' })`.
6. Add a redirect callback handler at `apps/web/app/(auth)/callback/page.tsx`.
7. Extend the sign-in unit test with an "Apple button triggers OAuth" case.

**Native iOS port:** when `ios-archive/` revives, see `TODOS.md § v+ § native-ios-resume-knowledge` for the SIWA native wiring, App Groups entitlement, and related steps. The paid Apple Developer account and Service ID registered in Phase 1 serve both web and native — don't re-enroll.

**Depends on:** Paid Apple Developer account + production domain.

---

#### item-display-name-editing

**What:** Let users rename how an item appears in their list without affecting the shared catalog or breaking future fuzzy matching.

**Why:** `name_canonical` is a shared catalog key used by pg_trgm matching — mutating it would rename the item for all households. But users may want "Dawn jabón platos" to show as "Jabón platos" in their list. The right model is a per-household display name override, not editing the canonical.

**How:**

1. Add a `display_name text` column to `list_entries` (nullable — falls back to `item.name_canonical` when null)
2. In `ItemDetailView`, make the title tappable → inline `TextField` to edit `display_name`
3. On save, `UPDATE list_entries SET display_name = ? WHERE id = ?`
4. In `DisplayEntry` / `ListRowView`, show `display_name ?? item.name_canonical`
5. Add RLS policy: `list_entries_update` for household members (already needed for other features)

**Context:** `name_canonical` must stay immutable for pg_trgm matching to work. The override lives on `list_entries`, not `items`, so it's per-add (not even per-item globally) — which is fine since each add is a discrete household action.

**Depends on:** List entries update RLS policy (not yet written).

---

#### per-household-items-catalog

**What:** Split `items` into a curated global catalog (`items_global`) and a per-household table (`household_items`), exposed to the app as a union view `items`. Cold starts write to `household_items` instead of the shared catalog.

**Why:** Currently cold starts write to the global `items` table, meaning one household's typos or unusual items become match candidates for every other household. Fine for a single-household v0, but a contamination risk before onboarding a second household.

**How:**

1. Migration: rename `items` → `items_global`, create `household_items (id, household_id, name_canonical, category, created_at)` with RLS, create union view `items` that returns `items_global` + `household_items` filtered by `my_household_ids()`
2. Add `INSTEAD OF INSERT` trigger on the view that routes inserts to `household_items` with the calling user's `household_id` (so Edge Function code is unchanged)
3. Move GIN trgm index to cover both tables
4. Edge Function: no code change needed if trigger is in place; alternatively explicitly write to `household_items` on cold start

**Edge cases covered:**

- Two households cold-starting the same item → isolated rows, no sharing ✓
- Global catalog later adds an item already in `household_items` → both returned by view, pg_trgm picks best match, redundant row is harmless ✓
- `items_global` is read-only from the app — new curated items added only via migration ✓

**Context:** See architecture discussion — the view approach keeps the Edge Function and iOS app unchanged. The one deliberate tradeoff: you can't add to the global catalog from the app, only via SQL. That's intentional — curation should be deliberate.

**Depends on:** Should be done before onboarding any second household. Whether that happens in v0 (promote to pre-ship) or v1 (stay here) depends on household-onboarding plans — confirm during v0 GA planning.

---

#### admin-promote-custom-store-to-global

**What:** Operator-side dedup path under Model B (my-stores D2/D3). When two households independently mint custom rows with the same name (e.g. "Trader Joe's"), an admin can promote one to `is_global=true` and re-link the other household's `household_stores` row to the promoted catalog id; the orphaned custom row is then deleted.

**Why:** Migration 016 drops the `stores_name_key` UNIQUE constraint intentionally — under Model B (private custom stores), N households can each mint their own row; cross-household autocomplete would be a Model B violation. Operator-side promotion is the explicit dedup path. Catalog fragments over time; eventually that fragmentation needs cleanup so popular-stores ranking + future-household backfill remain coherent.

**How:**

1. Build a small admin script / RPC `promote_custom_store_to_global(p_store_id uuid)` that (a) sets `is_global = true` and `created_by_household_id = NULL` on the chosen row, (b) finds all other custom rows with the same name across households, (c) UPDATEs every `household_stores.store_id` that references those duplicates to point at the newly-global row, (d) UPDATEs `list_entries.store_id` + `purchase_history.store_id` + `disambiguation_log.store_id` similarly, (e) DELETEs the now-orphaned duplicate rows.
2. Hand-run via the Supabase SQL editor — no UI in v0; this is operator infrastructure.
3. Log the promotion to a new `store_promotions` audit table for traceability.

**Depends on:** Visibility into fragmentation rates (PostHog `custom_store_created` event count per name). Build when 2+ households are live AND name collisions are observed.

---

#### onboarding-pick-your-stores-step

**What:** Add a "Pick your stores" step to the onboarding flow so first-time users curate their My Stores before landing on `/list`. Deferred D1 scope from the my-stores PR.

**Why:** The full design (the office-hours doc at `.gstack/projects/meirmsn-lalista/node-fix-settings-collab-polish-design-20260511-121125.md`) wanted onboarding to expose "popular stores from your area" plus an autocomplete-add input as a 2-step flow (name + stores). My-stores PR shipped Approach A — Settings + Picker + Fallback — bounding PR size; onboarding has separate design overhead (mode-based `OnboardingForm`, `welcomed_at` column to track first-time vs. returning, page-level routing branch, popular-stores ranking query).

**How:**

1. Migration: `alter table profiles add column welcomed_at timestamptz` (nullable; backfill = profiles.updated_at on existing rows so they aren't shown the step).
2. `OnboardingForm` grows a `mode: 'name-only' | 'name-and-stores'` prop; the post-invite-flow accept path passes `mode='name-only'` so existing invitees don't get a stores prompt that's irrelevant (their owner already curated).
3. Popular-stores ranking: static query against `household_stores` joined to `stores` ordered by count(\*) desc (`PRODUCT-ROADMAP.md § Pattern lift candidates` mentions a materialized view — over-engineering for v0 onboarding).
4. After "next" on the name step, render `<StorePicker mode="manage" allowCreate />` with the popular-store list pre-populated as suggestions. Same picker primitive.
5. Page-level routing in `apps/web/app/(auth)/onboarding/page.tsx`: render the stores step IFF `profiles.welcomed_at IS NULL`; on submit, set `welcomed_at = now()`.

**Depends on:** My-stores feature shipped (✓ migration 016).

---

#### join-redirect-to-onboarding-for-name-only-flow

**What:** When an invitee accepts a household invite (`/join/[token]` route), thread the flow through `/onboarding` for the name-only step before landing on `/list`. Deferred D1 scope from the my-stores PR.

**Why:** 015 currently lands invitees on `/list` after `accept_invite`. The office-hours design wanted to give every new user a chance to set their `display_name` before they hit the list. Out of scope for the my-stores PR but a natural pair with `onboarding-pick-your-stores-step` (the OnboardingForm mode prop makes this trivial once shipped).

**How:**

1. `apps/web/app/join/[token]/page.tsx` accept-invite handler: after `acceptInvite()` resolves, redirect to `/onboarding?mode=name-only` instead of `/list`.
2. `OnboardingForm` renders only the name field when `mode='name-only'`; on submit, `updateMyProfile({display_name})` then redirect to `/list`.
3. E2E case in `household-invite-happy-path.spec.ts` extends to verify the onboarding redirect + name save before landing on `/list`.

**Depends on:** `onboarding-pick-your-stores-step` (above) — the OnboardingForm mode prop introduced there is the load-bearing piece.

---

#### wrong-item-correction-flow

**What:** Let users correct a wrong item match after it's been added — long press or swipe action on a list row → "Wrong item?" → removes the entry and re-opens the add sheet pre-filled with the original utterance so the user can be more specific.

**Why:** When pg_trgm confidence is ≥0.85, the item is added silently without confirmation. If the match was wrong (e.g. "leche" → "Leche entera" but you wanted fat-free), there's currently no correction path. The user is stuck with the wrong item or has to delete and re-type from scratch.

**How:**

1. Store the original utterance on `list_entries` — add `utterance text` column so the re-add sheet can be pre-filled
2. Add a swipe/long-press action on `ListRowView` → "Wrong item?"
3. On tap: delete the entry (existing `deleteEntry` flow) + set `viewModel.pendingCorrection = utterance`
4. `ListView` observes `pendingCorrection` → opens `AddItemSheet` pre-filled with the utterance
5. User re-types more specifically (e.g. "leche fat free") → cold starts a new `household_items` entry → future adds route correctly

**Context:** This also naturally handles the case where a new item needs to be created — the re-add flow triggers a cold start that teaches the system the more specific name.

**Depends on:** `per-household-items-catalog` TODO (so the correction creates a household-scoped item, not a global one).

---

#### loading-skeleton-a11y-single-status-region

**What:** Refactor the 4 route `loading.tsx` files (`list`, `settings`, `item/[id]`, `(auth)/onboarding`) and `ListClient`'s own skeleton so multiple sibling `LoadingArea` instances are wrapped in a single `role="status"` container, rather than each `LoadingArea` exposing its own status region.

**Why:** `LoadingArea` (`packages/ui/src/LoadingArea.tsx`) sets `role="status"` + `aria-busy="true"` + `aria-label` per instance. Routes that render multiple sibling `LoadingArea`s with the same label (`/list` renders 3 with "Loading your list", `/settings` renders 2, `/item/[id]` renders 2) now expose multiple sibling live regions with identical labels — screen readers may announce "Loading your list" 3× rapid-fire on `/list` mount where one announcement would be cleaner. Most SRs debounce identical labels, but the current shape isn't strictly ideal. Surfaced by the adversarial pass on PR #56 (snappiness Tier C followups, 2026-05-08); deferred there because fixing requires touching `LoadingArea` API + 4 `loading.tsx` files + `ListClient`, which is broader scope than the PR allowed.

**How:**

1. **Option A (preferred)**: add a `LoadingArea` prop like `as?: 'status' | 'div'` (default `'status'`) so callers can opt out of the per-instance live region when they're nested inside a wrapping status container. Each `loading.tsx` (and `ListClient`) wraps its set of `LoadingArea`s in `<div role="status" aria-label="..." className="flex flex-col gap-md p-md">` and passes `as="div"` to the children.
2. **Option B (alternative)**: leave `LoadingArea` as-is, add `aria-hidden="true"` to all but the first `LoadingArea` in each set. Smaller change but less semantically clean.
3. Update `LoadingArea.test.tsx` and any dependent unit/E2E tests (`route-loading.spec.ts`, `ListClient.test.tsx`) to match the new structure. The `route-loading.spec.ts` E2E currently uses `getByRole('status').first()` so should remain compatible with either option.

**Where:**

- `packages/ui/src/LoadingArea.tsx` — add prop
- `apps/web/app/list/loading.tsx`
- `apps/web/app/settings/loading.tsx`
- `apps/web/app/item/[id]/loading.tsx`
- `apps/web/app/(auth)/onboarding/loading.tsx`
- `apps/web/components/ListClient.tsx` — skeleton block at lines ~422-430
- Test updates: `LoadingArea.test.tsx`, `ListClient.test.tsx`, `route-loading.spec.ts`

**Source:** Adversarial-review finding F1 on PR #56 (2026-05-08).

---

#### controlled-input-hydration-race

**What:** Harden client-component controlled inputs (`<input value={state} onChange={...}>`) against the race where `value` is set on the DOM before React's `onChange` handler is bound. Most-visible surface today is `StorePicker`'s autocomplete input (`packages/ui/src/StorePicker.tsx`); the pattern is repo-wide for any client-component controlled input mounted on a slow-compile route.

**Why:** Next.js App Router server-renders the HTML with the initial state (`value=""`), then ships a JS bundle that hydrates the input on the client. If anything sets the input's DOM `value` between SSR paint and hydration (browser autofill, password managers, paste-on-load, programmatic `fill()` from Playwright), the typed value is lost on the first React commit — React reconciles the controlled input back to `state.query = ""`. Surfaced in PR 62 as a mobile-WebKit-only hard fail on `my-stores.spec.ts:124`: page snapshot showed input `[active]` with no value despite all 8 My Stores rendered, because `fill()` raced Next.js dev-mode compile of `/settings` + WebKit hydration. The PR 62 fix (commit `9382a1f`) sidesteps the race by waiting on a state-dependent render (`expect(getByText('Costco')).toBeVisible()`) before any `fill()` — correct for what the test verifies, but it does not actually fix the underlying race for real users in autofill / paste / very-slow-load scenarios.

**How:**

Pick one (or stack two for belt-and-suspenders):

1. **CI surface fix** — run Playwright against `pnpm start` (production build) instead of `pnpm run dev` in `apps/web/playwright.config.ts`'s `webServer` block. Production builds skip on-demand compile + StrictMode double-renders, collapsing the hydration window. Cheapest fix; addresses the test-flake symptom but leaves the production race in place for autofill / paste scenarios.
2. **`StorePicker` hardening** — switch the autocomplete input to a `defaultValue` + `useRef`-backed uncontrolled pattern, OR gate the `value={query}` prop on a `mounted` flag (`useEffect(() => setMounted(true), [])`) so React doesn't paint a server-rendered empty value until it's ready to handle onChange. Either approach loses the SSR pre-rendered input value (which is empty anyway), and the typed value survives a pre-hydration fill.
3. **Repo-wide audit** — `git grep -nE "<input[^>]*value=\{" apps/web packages/ui` to enumerate all controlled inputs; same fix as #2 for each.

**Where:**

- `packages/ui/src/StorePicker.tsx` lines ~181-190 (the autocomplete `<input>` in the `allowCreate` branch)
- `apps/web/playwright.config.ts` `webServer` block — if going with option 1
- Other candidate controlled inputs to audit: `AddItemSheet`'s item-name input, `DisplayNameField`'s name input, the sign-in / sign-up email + password fields (these run on cold-paint paths where the race could matter for users with password managers)

**Depends on:** Nothing — independent test/UX hardening. Lower priority than functional v1 work; pick up if a real user reports "typed text disappeared" or if `9382a1f`-style waits accumulate elsewhere.

**Source:** PR 62 CI run 25755558341 (mobile WebKit hard fail on `my-stores.spec.ts:124`, 2026-05-12). Test-side workaround landed in commit `9382a1f`; underlying race remains.

---

#### ci-docs-only-incremental-skip

**What:** Extend the existing PR-level docs-only-skip filter (PR #64 / `3ec56a7`) so that an in-flight PR also skips `slow` when every commit **since the last green CI run on the same branch** is docs-only — even if the PR diff against `main` includes runtime files.

**Why:** Today's pattern that motivates this — PR 62's CI cycle:

```
9382a1f  fix(e2e): harden my-stores tests…   ✅ slow green (~30 min)
381cf60  docs(todos): file controlled-input-hydration-race  ⏳ slow re-runs (~30 min) — only diff is TODOS.md
```

The full slow re-run on a pure-docs increment is wasted wall-clock. Every PR that adds a CLAUDE.md gotcha / TODOS entry / spec update after green CI pays the cost. Common when a PR matures (post-`/ak-pre-ship` audit fills in docs after the last code change). Estimated 10-20% of PR cycles fit this shape; ~25 min saved per occurrence.

**How:**

1. Add a `changes.outputs.incremental_docs_only` output to the `changes` job in `.github/workflows/ci.yml`. Logic:

   ```bash
   LAST_GREEN_SHA=$(gh run list \
     --branch "${{ github.head_ref }}" \
     --workflow ci.yml \
     --status success \
     --limit 1 --json headSha --jq '.[0].headSha // empty')
   if [ -n "$LAST_GREEN_SHA" ] && [ "$LAST_GREEN_SHA" != "${{ github.sha }}" ]; then
     # Reuse the same docs-only filter the base-comparison path uses
     git diff --name-only "$LAST_GREEN_SHA"..HEAD > /tmp/incremental.txt
     if ! grep -vE '<docs-only pattern from 3ec56a7>' /tmp/incremental.txt; then
       echo "incremental_docs_only=true" >> "$GITHUB_OUTPUT"
     fi
   fi
   ```

2. Slow-job gate: `if: needs.changes.outputs.runtime == 'true' && needs.changes.outputs.incremental_docs_only != 'true'`.
3. Grant the `changes` job `actions: read` permission so `gh run list` can read sibling workflow runs.
4. Keep the existing PR-level `runtime` classifier unchanged — this is purely additive (a second skip path).

**Where:**

- `.github/workflows/ci.yml` — `changes` job + `slow` job's `if:` gate.
- Pair test: a docs-only-since-green push on a branch should land green-via-skip in fast only, no slow runtime.

**Edge cases / risk:**

- Force-pushes: `LAST_GREEN_SHA` may not exist as an ancestor after a force-push. Default-deny (don't skip) is the safe fallback — covered by the `[ "$LAST_GREEN_SHA" != "${{ github.sha }}" ]` guard returning false on missing SHAs.
- Flaky last-green: same residual risk as the existing PR-level docs-only skip (already accepted in #64). No new threat model.
- First push on a branch: no prior green → skip filter no-ops → full CI as today.

**Depends on:** Nothing — purely additive to the existing classifier. Lower priority than functional v1 work.

**Source:** PR 62 `/ak-go-live` session, 2026-05-12 — TODOS.md doc push (`381cf60`) re-ran slow after `9382a1f` green, blocking the deploy on a 30-min wait.

---

### Calibration / measurements (post-dogfood)

#### threshold-tuning-post-dogfood

**What:** Query `disambiguation_log` to measure false-positive/false-negative rates and
adjust `item_match_threshold` and `store_routing_threshold` in the `config` table.

**Why:** Starting thresholds (0.85 match, 0.70 store routing) are educated guesses. Too
tight → annoying follow-up questions every add. Too loose → wrong item added silently.
Two weeks of real family use generates enough signal to calibrate both.

**How:**

```sql
-- Decision type breakdown (what % of adds triggered a follow-up?)
SELECT decision_type, COUNT(*) AS n
FROM disambiguation_log
WHERE household_id = '<your-household-id>'
  AND created_at > now() - interval '14 days'
GROUP BY decision_type
ORDER BY n DESC;

-- If asked_item + asked_store + asked_brand > ~20% of total adds:
--   lower item_match_threshold (e.g. 0.85 → 0.80) to be more aggressive
-- If users report wrong items being added silently:
--   raise item_match_threshold (e.g. 0.85 → 0.90)

-- Update thresholds (no deploy needed):
UPDATE config SET value = '0.80' WHERE key = 'item_match_threshold';
UPDATE config SET value = '0.65' WHERE key = 'store_routing_threshold';
```

**Context:** `disambiguation_log` records every add-item decision with confidence score
and `decision_type` (silent_match | asked_item | asked_store | asked_brand | cold_start).
Thresholds live in the `config` table — adjustable at runtime with no app or server deploy.
The goal is to reach >90% silent matches with near-zero wrong-item complaints within the
first month of use.

**Depends on:** v0 shipped + family actively using it for at least 2 weeks.

---

## v+

### native-ios-resume-knowledge

**What:** Consolidated knowledge we've already figured out about native iOS — preserved here so the discoveries aren't lost when `ios-archive/` revives.

**Why:** The Swift app is archived but not dead; we expect native dev to resume. Several concrete decisions and setup steps were made during the Swift era and during subsequent reviews. Losing this context would cost a few days of re-discovery when native work restarts.

---

**Apple infrastructure (shared with web `apple-sso`):**

- The paid Apple Developer Program enrollment ($99/yr) serves both web Sign in with Apple **and** native iOS signing — do not re-enroll. The Service ID and domain registration are done once for web; native iOS uses the same developer account for provisioning profiles, entitlements, and Sign in with Apple `ASAuthorizationAppleIDProvider`.
- `ios-archive/ios/Sources/` contains prior SIWA wiring using `ASAuthorizationAppleIDProvider`. Port after the web `apple-sso` (v1) lands so the Supabase Apple provider is already configured.

---

**App Groups entitlement:**

Register the `group.com.lalista.shared` App Group in the Apple Developer portal and enable it in both the `lalista` and `lalistaIntents` Xcode targets so the Intents extension shares the SwiftData cache with the main app.

**Why needed:** App Groups requires the paid Apple Developer account. With a personal team, `LocalCacheManager` falls back to the app's own Application Support directory — which works for the main app but means the Intents extension has its own isolated cache and can't see the main app's data.

**How (when resuming):**

1. In Apple Developer portal → Identifiers → register App Group `group.com.lalista.shared`
2. Enable App Groups on both `com.lalista.app` and `com.lalista.app.intents` App IDs
3. Set `DEVELOPMENT_TEAM = <your-team-id>` in `ios/Config.xcconfig`
4. Re-run `xcodegen generate` in `ios/`
5. In Xcode → `lalista` target → Signing & Capabilities → **+ Capability** → App Groups → add `group.com.lalista.shared`. Repeat for `lalistaIntents`
6. Xcode auto-generates updated provisioning profiles

The entitlements files (`ios/Sources/lalista.entitlements` and `ios/Intents/lalistaIntents.entitlements`) already declare the App Group. The fallback in `LocalCacheManager.storeURL` automatically stops being used once the entitlement is active — no code change needed.

---

**Animation performance baseline:**

Run Instruments (Core Animation) on the mark-as-bought spring animation on the oldest supported iOS device (iPhone SE 2nd gen or equivalent) with 15–20 items in the list.

**Why:** The mark-as-bought animation (spring damping 0.7, crossstrike + row removal) is on the critical path of the "magic moment" and runs hundreds of times. On older devices with complex list rendering it may drop below 60fps. If so, switch to ease-out before shipping native.

**How:**

1. Build the app with 20 items across 2 stores
2. Open Instruments → Core Animation instrument → profile on oldest supported device
3. Trigger mark-as-bought 10 times while profiling
4. If avg frame rate < 55fps: switch `withAnimation(.spring(dampingFraction: 0.7))` to `withAnimation(.easeOut(duration: 0.2))`
5. The crossstrike animation can always stay — simple opacity/strikethrough, not a spring

---

**Dark mode color asset audit (iOS-specific):**

After implementing `Assets.xcassets` color sets, write an XCTest that enumerates every color token defined in DESIGN.md and verifies each has a valid named entry with both light and dark appearances.

**Why:** SwiftUI renders missing named colors as transparent — no error, no warning, no crash. A typo in a color asset name creates invisible text or transparent backgrounds that are only caught visually.

**How:**

```swift
let requiredColors = [
  "backgroundPrimary", "backgroundSurface", "backgroundSurface2",
  "textPrimary", "textSecondary", "textTertiary",
  "accentPrimary", "accentPrimaryDark", "accentPrimarySoft",
  "borderDefault", "successColor", "warningColor", "errorColor", "infoColor"
]
for name in requiredColors {
  XCTAssertNotNil(UIColor(named: name),
    "Missing color asset: \(name) — will render transparent in app")
}
```

All SwiftUI views should use `Color("tokenName")` referencing DESIGN.md tokens. Run the test once after initial asset setup and any time DESIGN.md tokens change. ~20 minutes to write.

---

**VoiceOver audit (iOS-specific):**

Audit native flows with VoiceOver on a physical device (Settings → Accessibility → VoiceOver). Apple App Store review sometimes flags accessibility regressions, and a11y specs written in a plan don't catch implementation gaps — only a live screen reader test does.

1. Navigate through the list view — verify each row reads: `"{item name}, {brand}, {store}, added by {name}"`
2. Perform swipe-to-complete: verify `accessibilityCustomAction` "Mark as bought" is announced
3. Perform swipe-to-delete: verify `accessibilityCustomAction` "Remove from list" is announced
4. Tap FAB → verify bottom sheet is navigable (focus moves into sheet, dismiss works)
5. Add via Siri → verify `accessibilityAnnouncement` fires for toast even without visual focus
6. Navigate to Settings → verify section headers are announced as `.header` trait

a11y specs live under DESIGN.md § "Accessibility & Responsive Specs" in the Swift-era design doc (still in `ios-archive/`).

---

**Depends on:** Decision to resume native iOS development.
