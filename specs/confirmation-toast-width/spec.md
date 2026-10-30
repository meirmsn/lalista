<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: confirmation-toast-width -->
<!-- date: 2026-05-07 -->

# Spec: confirmation-toast-width (PR)

**Sources:**

- Investigation session 2026-05-06 — diagnosed `ConfirmationToast` rendering at 8px wide because `max-w-sm` compiled to `max-width: 8px` instead of the intended 24rem. Root cause: Tailwind v4 spacing↔container token resolution order — with `--spacing-sm: 8px` defined and no `--container-sm` defined, `max-w-sm` falls through to the spacing namespace.
- `apps/web/components/ConfirmationToast.tsx:37` — sole occurrence of a colliding named-key utility (verified via repo-wide sweep across `apps/web` + `packages/ui/src`).
- Compiled CSS evidence: `apps/web/.next/dev/static/chunks/apps_web_app_globals_css_*.single.css` contains `.max-w-sm { max-width: 8px; }`.
- `apps/web/app/globals.css` — current `@theme inline` block defines `--spacing-*` tokens (8/16/24/32 px) but no `--container-*` tokens; relies on Tailwind v4's bundled defaults, which are evidently being shadowed.
- Tailwind v4 docs — `--container-*` is the documented namespace backing `max-w-{xs..7xl}` named keys.

PR fixes the success-toast (and any future `max-w-{md|lg|xl|2xl}` use) by explicitly defining `--container-*` tokens in `globals.css`, eliminating the fall-through to the `--spacing-*` namespace. ConfirmationToast.tsx itself does not change — its `max-w-sm` becomes correct once the tokens are defined.

---

## Decisions (resolved at spec time)

5 `/ak-spec`-time decisions resolved in Phase 0 with the user (2026-05-07).
Recorded below so Phase 1 preserves them verbatim and a crashed Phase 1
resumes without re-asking.

### D1: Fix scope — surgical (replace one class) vs global (define `--container-*` tokens)

**Decision:** Global. Define `--container-3xs` through `--container-7xl` in `apps/web/app/globals.css` so all named-key max-w utilities resolve correctly.

**Rationale:** Surgical fix (`max-w-sm` → `max-w-[24rem]`) addresses one symptom but leaves `max-w-md`, `max-w-lg`, `min-w-sm`, `h-xl`, etc. as silent footguns — already cost one investigation session for a 2-month-old bug. Global fix is a ~12-line one-time CSS change with low implementation risk; if v4 doesn't honor it, fall back to surgical (cheap fallback). ConfirmationToast.tsx stays untouched — its `max-w-sm` becomes correct.

### D2: Replacement value for `max-w-sm` (in case D1 falls back to surgical)

**Decision:** N/A under D1's primary path. Fallback value if global fix doesn't take: `max-w-[24rem]` (matches Tailwind v4's default `--container-sm`, what `max-w-sm` was meant to resolve to).

**Rationale:** Sibling layouts already use arbitrary px/rem values (`max-w-[400px]`, `max-w-[420px]`, `max-w-[28rem]`) so the pattern is established.

### D3: Where to document the v4 token-collision invariant

**Decision:** Inline comment in `globals.css` next to the new `--container-*` block. No CLAUDE.md gotcha, no new kit guide.

**Rationale:** With the global fix in place, there's no behavior to warn project-wide devs about — `max-w-sm` works correctly. The remaining audience is the next person editing `globals.css`, who needs to know **why** the `--container-*` block exists alongside `--spacing-*`. That's a textbook "non-obvious why" inline comment per CLAUDE.md's commenting policy. Co-located, no discoverability problem. Lift to `/devshop/kit/docs/guide/styling.md` post-soak if a second project hits it (latency-feedback precedent).

### D4: New tests

**Decision:** None added. Existing `ConfirmationToast.test.tsx` stays.

**Rationale:** CSS-only change; jsdom can't compute width from class names. Unit/component tests can't catch this class of bug. Manual verification via dev server + the build-output grep (`grep -E "\.max-w-sm" .next/.../globals.css`) is sufficient. Pre-ship visual gate (Gate 4 responsive screenshots) is the structural backstop.

### D5: Verification step

**Decision:** After editing `globals.css`, rebuild and grep the compiled CSS for `\.max-w-sm\{max-width:24rem\}` to confirm the token override took effect. If it doesn't (compiled CSS still shows `max-width:8px`), fall back to D2's surgical fix and add the CLAUDE.md gotcha originally drafted in Phase 0.

**Rationale:** v4's resolution order between user-defined `--container-*` and user-defined `--spacing-*` for `max-w-*` named keys is the load-bearing assumption. Empirical check is cheap (one build + one grep) and makes the fix verifiable rather than hopeful.

---

<!-- /ak-spec (Phase 1) expansion below. Decisions section above is verbatim. -->

## Core user story

N/A — CSS-token-only fix. No new user-facing flow; the existing `ConfirmationToast` component already has E2E coverage of its render path (every successful add/disambig pick triggers it). Visible behavior change is purely "the toast is now wide enough to read," verified by Gate 4 responsive screenshots, not a new flow.

## In scope

- Define `--container-3xs` through `--container-7xl` inside the existing `@theme inline { … }` block in `apps/web/app/globals.css`, using Tailwind v4's documented default scale (16rem / 18rem / 20rem / 24rem / 28rem / 32rem / 36rem / 42rem / 48rem / 56rem / 64rem / 72rem / 80rem). This restores `max-w-{3xs..7xl}` (and `min-w-*`, `w-*`, `h-*` when used with named container keys) to their intended values, eliminating the silent fall-through to the `--spacing-*` namespace.
- Add a brief inline comment above the new block explaining **why** `--container-*` is being defined alongside `--spacing-*` (D3): without it, Tailwind v4 resolves `max-w-sm` against the `--spacing-sm: 8px` token and ships `max-width: 8px` for the success toast.
- Manual verification: rebuild the dev/prod CSS and grep the compiled output for `\.max-w-sm\{max-width:24rem\}` (D5).

## Out of scope

- ConfirmationToast.tsx is not modified (D1 — the existing `max-w-sm` becomes correct once tokens are defined).
- No CLAUDE.md gotcha and no new kit guide entry (D3 — inline comment in `globals.css` is the documentation surface; lift post-soak only if a second project hits this).
- No new tests (D4 — jsdom can't observe the class-name → computed-width chain that broke).
- No changes to existing `--spacing-*` tokens or any other utility namespace.
- No surgical fallback (`max-w-[24rem]`) is shipped as part of this PR. It only applies if D5's verification step fails — in which case the fix becomes ConfirmationToast.tsx + a CLAUDE.md gotcha and this spec gets re-cut.

## Files to create/modify

- **Modify** `apps/web/app/globals.css` — add `--container-3xs` … `--container-7xl` definitions inside the existing `@theme inline { … }` block (the same block that already holds `--spacing-2xs` … `--spacing-3xl` at lines 100–107). Add a 2–3 line inline comment immediately above the new block explaining the v4 spacing↔container resolution-order trap and why both namespaces must be defined.

No other files change. ConfirmationToast.tsx (`apps/web/components/ConfirmationToast.tsx:37`) keeps its `max-w-sm` class verbatim.

## Tests

None added (D4). The existing `apps/web/components/ConfirmationToast.test.tsx` stays as-is and continues to assert the toast renders, contains its message, has `role="status"` + `aria-live="polite"`. jsdom doesn't compute geometry from class names so it can't catch a token-collision bug; no test we could add at the unit/component layer would have prevented this.

The structural backstops are:

- **`/ak-pre-ship` Gate 4 (responsive)** — captures 375px + 1440px screenshots of every route. The success toast is visible after a successful add; an 8px-wide toast shows up immediately as a vertical stripe.
- **D5 manual grep** — `grep -E '\.max-w-sm\{max-width:24rem\}' apps/web/.next/.../globals.css` after rebuild confirms the token override took effect.

If the spec.md ever lifts to a "v4 token discipline" guide, that's the moment to consider a CSS-output regression test (e.g., Vitest snapshot of compiled `globals.css` resolving named container keys). Out of scope for this PR.

## Dependencies

- Tailwind v4 (already in use). No version bump.
- No new packages, no migrations, no edge-function changes, no env-var changes.
- No coordination with the deploy-migrations or deploy-functions workflows. Vercel auto-deploys the front-end on merge to main; that's the only deploy surface this touches.

## Task order

Two tasks, sequential. Each is one atomic commit.

1. **Define `--container-*` tokens in `globals.css` with inline rationale comment.** Add the 13 token definitions inside the existing `@theme inline { … }` block, alongside `--spacing-*`. Inline comment captures the v4 namespace-resolution gotcha (D3). Commit message: `fix(globals-css): define --container-* tokens to restore max-w-{xs..7xl} (Tailwind v4 token-collision)`.

2. **Verify compiled-CSS output (D5).** Run the dev build (or full `pnpm build`), then `grep -E '\.max-w-sm\{max-width:24rem\}'` against the compiled `apps/web/.next/**/globals*.css`. If the grep matches, no further code changes — proceed to `/ak-pre-ship`. If it does NOT match (compiled CSS still shows `max-width:8px`), STOP, fall back to D2's surgical fix path (revert task 1, change `apps/web/components/ConfirmationToast.tsx:37` `max-w-sm` → `max-w-[24rem]`, add a CLAUDE.md Gotcha entry about v4 spacing-shadows-container), and re-run `/ak-spec` to re-cut the spec for the surgical path.

## Gotchas

- **Token order in the `@theme inline` block doesn't matter** — Tailwind v4 resolves utilities by namespace (`--container-*` for `max-w-{xs..7xl}` named keys), not by source order. Putting the new block above or below `--spacing-*` is fine; place it adjacent for readability.
- **Don't define `--container-3xs` etc. with `px` values.** Tailwind's defaults are in `rem` (16rem = `max-w-3xs`); shipping `px` values here would silently change every named-key max-w utility's responsive behavior under user font-size scaling. Use the rem scale documented above.
- **The `apps/web/.next/dev/static/chunks/.../globals.css` paths have hashed segments.** When grepping post-build, glob with `**/globals*.css` rather than a fixed path; CI and dev hashes differ.
- **Sibling arbitrary-value `max-w-[…]` usages stay.** Several layouts use `max-w-[400px]` / `max-w-[28rem]` / `max-w-[420px]` — those are intentional one-off widths, not symptoms of the same bug, and don't need migration to named keys.
- **If the verification step fails, do not "force" the global fix by also defining `@layer base` overrides or by deleting `--spacing-sm`.** Both routes have wide blast radius (every `p-sm` / `gap-sm` / `m-sm` reverts to default v4 spacing or breaks). Falling back to D2's surgical path is the correct response.
- **Future workspace packages with their own styled components must keep the `@source "../../../packages/<name>/src/**/_.{ts,tsx}";`directive in`globals.css`** (already documented in CLAUDE.md § Gotchas). The `--container-_`tokens defined here are scoped to the same`globals.css` and apply to those packages' utilities too — no per-package re-definition needed.

## Acceptance / rollout / rollback

**Acceptance** — all of the following hold after Task 2:

- `apps/web/app/globals.css` contains `--container-3xs` through `--container-7xl` definitions inside the `@theme inline` block, with a 2–3 line inline comment naming the v4 spacing↔container resolution trap.
- Compiled CSS grep matches: `grep -E '\.max-w-sm\{max-width:24rem\}' apps/web/.next/**/globals*.css` returns at least one hit. (Default-scale check; equivalent for `md` = 28rem, `lg` = 32rem, etc., but `sm` is the load-bearing one given the original bug.)
- `pnpm typecheck`, `pnpm lint`, and `pnpm turbo run test:unit` all pass (no behavior changed in TS or component tests; this is a pure CSS edit).
- `apps/web/components/ConfirmationToast.tsx:37` is unchanged in the diff (D1's invariant).
- `/ak-pre-ship` Gate 4 (responsive screenshots) shows the success toast at its intended ~24rem width on both 375px and 1440px viewports — no 8px vertical-stripe regression.

**Rollout** — automatic on merge to main:

- Vercel auto-deploys `apps/web` on every push to main (existing config; nothing new wired here).
- No migration, no edge-function deploy, no env-var change, no third-party config (Resend / Supabase Auth templates / Sentry / PostHog) touched.
- No PostHog event taxonomy change; `METRICS.md` unchanged.
- Post-deploy canary check is the standard `/canary` flow on `https://lalista.store` — visually confirm the success toast renders at correct width by adding any item.

**Rollback** — trivial:

- `git revert <commit>` of the single Task-1 commit and re-deploy. Reverts `apps/web/app/globals.css` to its pre-PR state. ConfirmationToast.tsx never moved, so no other revert needed.
- If the issue manifests as a different surface regression (some other layout that was relying on the prior — broken — `max-w-*` semantics), the revert restores prior behavior verbatim. Sweep at `/ak-pre-ship` time should catch this before merge; nothing in the codebase intentionally depends on `max-w-sm == 8px`, so no incidental-regression risk is expected.
- If only one downstream surface needs the old broken value temporarily, replace its `max-w-sm` with `max-w-[8px]` (explicit) rather than reverting the global tokens. Unlikely to be needed.

---

## Outcome (post-implementation, 2026-05-07)

**D5 verification failed → fell back to D2's surgical path.**

Empirical test: ran Tailwind v4 (`@tailwindcss/node@4.2.4`) directly against `globals.css` after defining `--container-3xs..7xl`. Compiled output showed every named-key max-w utility STILL resolving through `--spacing-*`:

```
.max-w-xs   { max-width: 4px;  }   /* --spacing-xs */
.max-w-sm   { max-width: 8px;  }   /* --spacing-sm */
.max-w-md   { max-width: 16px; }   /* --spacing-md */
.max-w-lg   { max-width: 24px; }   /* --spacing-lg */
.max-w-2xl  { max-width: 48px; }   /* --spacing-2xl */
```

Conclusion: in this `@theme inline` setup, defining `--container-*` does NOT override the `--spacing-*` resolution for `max-w-*`/`min-w-*`/`w-*`/`h-*` named keys. The "global fix" hypothesis (D1 primary path) is empirically invalid for Tailwind v4 4.2.x with the spacing scale defined.

**Shipped (surgical, per D2):**

- Reverted the `--container-*` block from `apps/web/app/globals.css`.
- `apps/web/components/ConfirmationToast.tsx:37`: `max-w-sm` → `max-w-[24rem]`.
- Added a CLAUDE.md Gotcha forbidding named-key sizing utilities project-wide, with the empirical evidence above and pointing to arbitrary-value alternatives.

If a future Tailwind release changes the resolution order, or if `--spacing-*` ever moves out of `@theme inline`, re-test the global path — but for now, arbitrary values are the documented and only working idiom in this repo.
