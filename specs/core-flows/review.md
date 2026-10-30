<!-- generated-by: /ak-pre-ship -->
<!-- feature: core-flows -->

# Pre-ship review — core-flows (PR 3)

Phase 3 of /ak-build. All 11 quality gates ran; 3 findings surfaced, all fixed during the run. Ready for /ship.

## Summary

PR 3 closes the 6-screen core-flows set (public landing, list empty/loaded, add-item sheet, item detail, settings) behind the migration 009 `ON DELETE SET NULL` FK cascades, a ThemeProvider bootstrap, 5 new PostHog events, and Playwright E2E for the IA + theme + happy-path walks. Phase 3 fixed three defects surfaced by the gates — a CSP that blocked Supabase Realtime `wss://` + PostHog asset loads (Gate 3), a dead ternary in two addedBy fallback call-sites (Gate 4), and a latent break in the auth qa-walk caused by the D7 IA flip (Gate 9) — and added the core-flows qa-walk harness + 6 hero shots. 127 web + 43 core + 21 ui = **191 unit tests pass**; `pnpm test:qa-walk` green (both auth + core-flows walks), lint + typecheck clean.

## Gates

| #   | Gate            | Outcome            | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Docs            | pass               | CLAUDE.md gotchas include null-added_by + D7 IA flip; METRICS.md has all 5 new events; TODOS.md cross-references migration 009 → posted-by-someone.                                                                                                                                                                                                                                                                                                     |
| 2   | Metrics         | pass               | All 5 events (`item_added`, `item_bought`, `disambiguation_shown`, `store_routed`, `error_displayed`) wired to call-sites in AddItemSheet / DisambiguationSheet / ListClient / SyncErrorBanner; verified via grep + unit test coverage.                                                                                                                                                                                                                 |
| 3   | Responsive      | findings (1) fixed | CSP blocked `wss://<supabase>` (breaks Realtime) + `us-assets.i.posthog.com` (PostHog config load). Fixed in next.config.ts (commit `87d106b`). 24 captures × 6 screens × 4 combos saved to `specs/core-flows/screenshots/`.                                                                                                                                                                                                                            |
| 4   | /simplify       | findings (1) fixed | Dead ternary `entry.addedBy ? 'X' : 'X'` in ListRow.tsx + item/[id]/page.tsx (both branches identical). Inlined to a module-scoped constant (commits `54e023b` + `fa3ab10`) with TODO anchor for future display-name table.                                                                                                                                                                                                                             |
| 5   | /ak-test-review | pass               | Tests assert behavior not markup. Happy + error paths covered for every component. Middleware 4-cell matrix, null-addedBy fallback, network failures, escape-key, already_on_list + quantity edge case, cross-followup_type slot mapping all exercised.                                                                                                                                                                                                 |
| 6   | /review         | pass               | Explicit column lists (no `SELECT *`), `mark_item_bought` RPC used for writes, RLS boundary respected, migration has ROLLBACK block, no security-definer escalation. Minor DRY: fetchListEntries + fetchListEntryById duplicate their SELECT column list — acceptable.                                                                                                                                                                                  |
| 7   | /cso            | pass               | No secrets leaked (service_role only in Node-side e2e helper). No new SECURITY DEFINER functions. CSP's `unsafe-inline` + `unsafe-eval` in script-src are pre-existing (needed by Next.js + PostHog) — not introduced by this PR. No `dangerouslySetInnerHTML` / `eval` in new code.                                                                                                                                                                    |
| 8   | /design-review  | pass               | Tokens-only usage; no raw hex in components/app; rounded radii + 8px grid spacing consistent. Modal scrim in dark mode has weaker contrast (existing pattern; acceptable). Dark-mode disabled Add button verified via computed `opacity: 0.5`.                                                                                                                                                                                                          |
| 9   | /qa             | findings (1) fixed | Auth qa-walk broke on D7 IA flip (expected redirect to `/`, now `/list`). Fixed URL patterns + assertions (commit `16e871f`). Added `specs/core-flows/qa-walk.log` trace showing the full 14-step walk at 2026-04-21T23:12 — sign-in → list loaded (2 rows) → item detail → back → add-sheet open+Escape → settings → sign-out. Playwright config: qa-walk project now `fullyParallel: false` so shared preship test user doesn't collide across specs. |
| 10  | /benchmark      | pass               | Dev-server measurements: landing 48ms DCL / 60ms FCP / 6.5KB transfer; sign-in 60ms DCL / 76ms FCP / 6.6KB; list 48ms DCL. Production Lighthouse deferred to Vercel preview (baseline env: Google Fonts blocked in devcontainer).                                                                                                                                                                                                                       |
| 11  | Convention      | pass               | `kit/scripts/check-file-headers.sh` clean except `packages/core/src/supabase.types.ts` (generated by Supabase CLI — would be overwritten on next `gen types`, header would wipe). Migration 009 has ROLLBACK block with documented NULL caveat. JSDoc on exported functions. All new component files have `// What: / // Why: / // Does NOT:` headers.                                                                                                  |

## Findings

### 1. CSP blocked Supabase Realtime websocket + PostHog asset loads

**Gate**: 3 (Responsive capture)

**Description**: During the Playwright capture of authed screens, the browser console flooded with `Refused to connect because it violates the document's Content Security Policy` for:

- `wss://nzfdfjctpotjyuxdfcpw.supabase.co/realtime/v1/websocket` — Supabase Realtime uses a websocket, but CSP's `connect-src` only listed `https://<supabase>`. CSP treats schemes strictly — listing `https://foo.com` does NOT authorize `wss://foo.com`. This is the first PR to ship Realtime usage (`subscribeToList` in ListClient), so the bug was latent.
- `https://us-assets.i.posthog.com/array/<key>/config.js` — PostHog fetches its loader config from the `us-assets` subdomain; only `us.i.posthog.com` was listed. All 5 new PostHog events would be dropped in production if this shipped.

**Fix**: next.config.ts derives `wss://<supabase>` from `NEXT_PUBLIC_SUPABASE_URL` (simple `https://` → `wss://` replace) and adds it to `connect-src`. Adds `https://us-assets.i.posthog.com` to both `script-src` and `connect-src`. Verified via `curl -sI` — header now carries both entries — and via capture rerun: console errors cleared.

**Commit**: `87d106b`

### 2. Dead ternary in addedBy fallback call-sites

**Gate**: 4 (/simplify)

**Description**: `ListRow.tsx:43` had `entry.addedBy ? 'added by someone' : 'added by someone'` and `item/[id]/page.tsx:63` had `entry.addedBy ? 'someone' : 'someone'`. Both branches return the identical string, so the ternary is actively misleading code — it looks like it's branching on null when in fact `addedBy` is unused. The Phase 2 implementer left the ternary as an anchor for the future display-name branch (see `TODOS.md § posted-by-someone`).

**Fix**: Inlined to a module-scoped `ADDED_BY_FALLBACK` constant in ListRow.tsx and an inline `'someone'` in item detail, with explanatory comments pointing at the future work. Behavior unchanged; lint clean.

**Commit**: `54e023b` + `fa3ab10` (follow-up for an unused `_entry` param warning).

### 3. Auth qa-walk regression from D7 IA flip

**Gate**: 9 (/qa)

**Description**: When both qa-walk specs ran together, the original `apps/web/e2e/qa-walk.spec.ts` failed at `waitForURL(/localhost:3000\/$/)` — after D7's IA flip, creating a household in onboarding redirects to `/list`, not `/`. The assertions `await expect(page).toHaveURL(/\/$/)` and the post-refresh / direct-nav-/onboarding checks also expected the old home URL. A latent regression; Phase 2's unit tests caught some of this (onboarding page test was updated) but the E2E wasn't.

**Fix**: Updated the URL patterns + masthead assertion in `qa-walk.spec.ts` to expect `/list` instead of `/`. Added `fullyParallel: false` on the qa-walk project in playwright.config.ts + `--workers=1` on the test:qa-walk pnpm script so multiple qa-walk specs can share the single preship test user without collision.

**Commit**: `16e871f` (same commit added the new `e2e/core-flows-qa-walk.spec.ts` that exercised the 6-screen walk + emitted the audit log).

## Hero shots

Committed to `specs/core-flows/hero/` (6 shots × 1440×light):

- `specs/core-flows/hero/landing.png` — public landing (unauth entry point)
- `specs/core-flows/hero/list-empty.png` — empty list state ("la lista está vacía")
- `specs/core-flows/hero/list-loaded.png` — list with 3 entries across 2 stores (Costco + Walmart)
- `specs/core-flows/hero/add-sheet.png` — add-item sheet open over the empty list
- `specs/core-flows/hero/item-detail.png` — item detail page (Leche entera, Costco)
- `specs/core-flows/hero/settings.png` — settings with ACCOUNT (sign-out) + HOUSEHOLD sections

24-shot 4-combo audit evidence lives at `specs/core-flows/screenshots/` (gitignored; regenerable per pre-ship).

## Artifacts

- `specs/core-flows/qa-walk.log` — structured trace of the Gate 9 walk (gitignored; regenerable via `pnpm --filter @lalista/web test:qa-walk`).
- `specs/core-flows/screenshots/` — 24-shot 4-combo matrix for all 6 primary screens.
- `specs/core-flows/hero/` — 6 committed hero shots.

## Phase 3 commits (on top of Phase 2's 14)

- `87d106b` — fix(core-flows): CSP allows wss://supabase + us-assets.i.posthog.com
- `54e023b` — fix(core-flows): remove dead ternary in addedBy fallback
- `16e871f` — test(core-flows): qa-walk harness + fix auth qa-walk for D7 IA flip
- `2ad68df` — chore(core-flows): hero shots
- `fa3ab10` — fix(core-flows): inline addedBy fallback constant to clear unused-var lint

**Running total**: 14 (Phase 2) + 5 (Phase 3) = 19 commits on feature/core-flows.

## Counts

```
passed: 8
findings_pending: 0
n_a: 0
blocked: 0
```

Three additional gates ran with findings that were fixed inline during Phase 3: 3 (Responsive), 4 (Simplify), 9 (QA). Counted separately above; all fixes are under 30 LOC per-gate, atomic commits.
