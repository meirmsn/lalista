<!-- audited-at: e2823fb0d20ad82fb87e8614d5c91b4273650491 -->

# Pre-ship review — confirmation-toast-width

Branch: `fix/confirmation-toast-width`
Base: `main`
Net diff: 3 files (1-line CSS class change in `apps/web/components/ConfirmationToast.tsx`, 1-line CLAUDE.md Gotcha addition, full `specs/confirmation-toast-width/spec.md`).

## Router Summary

| Gate                      | Outcome                | Dismissals          | Adversarial review |
| ------------------------- | ---------------------- | ------------------- | ------------------ |
| `docs-check` (ak)         | n/a                    | None                | skipped (None)     |
| `metrics-check` (ak)      | n/a                    | None                | skipped (None)     |
| `rls-coverage` (ak)       | n/a                    | None                | skipped (None)     |
| `slow-job-lifecycle` (ak) | pass                   | None                | skipped (None)     |
| `changed-tests-local`(ak) | findings (1) [harness] | 1 harness misconfig | accepted (env)     |
| `responsive-theme` (ak)   | pass                   | None                | skipped (None)     |
| `simplify`                | pass                   | None                | skipped (None)     |
| `docs-and-tests-review`   | pass (Audit 1)         | None                | skipped (None)     |
| `review`                  | pass                   | None                | skipped (None)     |
| `cso`                     | n/a                    | None                | skipped (None)     |
| `design-review`           | pass                   | None                | skipped (None)     |
| `design-conformance` (ak) | pass                   | None                | skipped (None)     |
| `qa`                      | pass (live walk)       | None                | skipped (None)     |
| `benchmark`               | n/a                    | None                | skipped (None)     |
| `convention` (ak)         | pass                   | None                | skipped (None)     |
| `hero-shots`              | pass (3 captured)      | None                | skipped (None)     |

**Total dismissed findings**: 1 (Playwright project-name mismatch in the slow-job harness; unrelated to the diff). The Gate-9 dismissal recorded in the original Audit-1 stamp was retracted by the 2026-05-08 amendment below — the live walk re-ran successfully against a healthy local Supabase stack.

---

## Phase 0 preflight

- `gh auth status`: pass (authenticated as `meirmsn`).
- `git branch --show-current`: `fix/confirmation-toast-width` (not main): pass.
- `$TOUCHES_UI`: yes (`apps/web/components/ConfirmationToast.tsx`). Browser-dependent gates (3, 8, 9, 10) apply.
- Chromium: pass — `Chromium 147.0.7727.101` at `/home/node/.cache/ms-playwright/chromium-1208/chrome-linux/chrome`.
- Local Supabase: stack up via cmd-relay (REST `/rest/v1/items` returns 200 with seeded rows when probed via service-role; RLS-stripped to `[]` for anon, expected). Auth `/v1/health` returns 200 (`GoTrue v2.188.1`). Admin `auth.admin.createUser` works (the path the qa-walk uses). The `auth.admin.listUsers` RPC still 500s with "Database error finding users" intermittently — documented in `helpers/admin-client.ts:74` and worked around by the qa-walk's inline `createOrFindTestUser` (the prior `helpers/test-user.ts` uses `listUsers` for cleanup; this run side-stepped it). No PII or prod data touched.
- Original Phase-0 framing (auth-schema-break-blocks-walk) was retracted by the 2026-05-08 Audit-1 amendment when a re-run against the healthy stack succeeded end-to-end. Original wording preserved here in this strikethrough block for audit-trail continuity:
  > ~~Local Supabase: stack up via cmd-relay (REST `/rest/v1/items` returns 200 with empty array post-reset), but auth schema returns `500 unexpected_failure / Database error querying schema` for both admin-API and password sign-in paths. `supabase-bootstrap.sh up` exits 4 because `psql` is not installed in the workspace. Confirmed via direct `/auth/v1/token` REST call that the auth-schema break is independent of `psql`'s absence — not a stale-image symptom; likely a column-shape mismatch between newer GoTrue (v2.188.1) and the seed insert into `auth.users`. Public signup via `/auth/v1/signup` works (verified). No PII or prod data touched. This pre-existing environmental issue does not block the visual evidence required for this CSS-only fix.~~

## Gate 1 (`docs-check`): n/a

No changes under `kit/` or reference docs.

## Gate 2 (`metrics-check`): n/a

No new user-facing events. Diff is a CSS class change. `METRICS.md` unchanged.

## Gate rls-coverage (ak): n/a

Diff does not touch `supabase/migrations/**`, `packages/core/src/api/**`, or `supabase/functions/**`. The single TSX touch is in `apps/web/components/**`, not `apps/web/app/**`.

## Gate slow-job-lifecycle (ak): pass

`bash /devshop/kit/scripts/preship/slow-job-lifecycle-check.sh` → pass.

## Gate changed-tests-local (ak): findings (1) [harness misconfig — environmental]

`bash /devshop/kit/scripts/preship/changed-tests-local.sh` reports `findings (1) — smoke set failed (exit 0 across 4 spec(s))`. Root cause: the harness invokes `playwright test --project=chromium`, but this repo's `playwright.config.ts` defines projects `mobile`, `desktop`, `qa-walk` — no `chromium`. Pre-existing harness/repo mismatch, unrelated to this diff.

Mitigation here: the gate-4 evidence harness invoked the actual Playwright run via `--project=desktop` and all 5 specs passed (4 combos + 1 cap test). Unit tests pass `pnpm turbo run test:unit` → 36 files / 252/252 passed.

## Gate 3 (`responsive-theme`): pass

Captured 4 viewport×theme combos + 1 long-message cap test. Each capture asserted computed width (regression bound: > 100px; pre-fix would be 8px). All passed.

Files (in `specs/confirmation-toast-width/screenshots/`):

- `confirmation-toast-1440-light.png` — desktop light, short message → ~126px width (content-constrained).
- `confirmation-toast-1440-dark.png` — desktop dark, short message → ~126px (theme-inverted, same width).
- `confirmation-toast-375-light.png` — mobile light, short message → ~126px (toast doesn't span viewport — correct).
- `confirmation-toast-375-dark.png` — mobile dark, short message.
- `confirmation-toast-1440-light-long.png` — long message demonstrating the 24rem (=384px) cap kicks in and the message wraps inside.

No 8px vertical-stripe regression at any combo. No overflow, no theme-drift, no untappable height (~44px tall).

The Tailwind v4 build emits `.max-w-\[24rem\]{max-width:24rem}` deterministically — verified via the live screenshot capture against the running dev server using the same DOM the `ConfirmationToast` component renders. The structural-backstop contract from spec D4 is satisfied.

## Gate 4 (`simplify`): pass

Diff scanned: 1-line className change + 1-line CLAUDE.md doc bullet. No reuse / efficiency / dead-code opportunities. Sibling components already use the same arbitrary-value idiom (`max-w-[400px]` in PublicLanding, `max-w-[420px]` in AddItemSheet, `max-w-[28rem]` elsewhere) — the change is consistent with the existing pattern.

## Gate 5 (`docs-and-tests-review`): pass

### Audit 1

Range: `origin/main..HEAD` (4 commits: c631bd9, 6004f83, f2d546e, e2823fb).

**Docs review:**

- `CLAUDE.md` — new Gotcha bullet documents the v4 spacing↔container token-shadowing trap with concrete empirical evidence (`@tailwindcss/node@4.2.4`, the failed alternative path, the chosen idiom, sibling examples). Voice + length match the existing Gotchas section. Cross-references the existing `@source` Gotcha indirectly. No staleness.
- `specs/confirmation-toast-width/spec.md` — full spec with Decisions D1-D5 verbatim, Outcome section explaining empirical fallback from D1's primary path to D2's surgical path. Aligns with the actual diff. Provenance + Sources sections present and accurate.
- No other docs (METRICS.md, OVERVIEW.md, ARCHITECTURE.md, package READMEs) need updates — no new metrics, no new component, no architectural change.

**Tests review:**

- No new tests added. Spec D4 explicitly justifies: jsdom can't compute widths from class names; `apps/web/components/ConfirmationToast.test.tsx` already covers structural behavior (renders, ARIA, contains message). The structural backstop is Gate 4's responsive screenshots, captured here (5 screenshots + computed-width assertion at >100px).
- Unit suite passes: `pnpm turbo run test:unit` → 252/252.
- Type-safety: `max-w-[24rem]` is a Tailwind v4 arbitrary-value literal — parsed at compile time by Tailwind's classname parser. No TS escape required.

**Verdict:** zero high-severity findings; spec correctly documents both the failed primary path and the shipped surgical path; CLAUDE.md captures the empirical evidence so the next person editing `globals.css` doesn't re-investigate.

## Gate 6 (`review`): pass

Diff scan against base branch:

- No SQL → SQL safety: `n/a`.
- No LLM call site → trust-boundary: `n/a`.
- No conditional side effects (the className change is a static literal in the JSX).
- No structural concerns. The new className uses Tailwind v4 arbitrary-value syntax which compiles deterministically.

## Gate 7 (`cso`): n/a

CSS-only fix; no security surface touched. No new dependencies, secrets, env-vars, RLS code, edge-function changes, LLM prompts. The 1-line className change has zero security implication. CLAUDE.md addition is developer documentation (mentions `@tailwindcss/node@4.2.4` package name and `--spacing-*` token names — no secrets).

## Gate 8 (`design-review`): pass

Visual audit against the captured screenshots:

- Toast renders bottom-center across all 4 combos.
- Width is content-driven for short messages (~126px in screenshots) and capped at 24rem (=384px) for long messages — correct intended behavior.
- Light/dark theme inversion works (token-driven `bg-text-primary` + `text-background`).
- Touch target ~44px (text-[14px] + py-sm padding) meets the min.
- No 8px vertical-stripe regression at any captured combo.
- No AI-slop, no spacing inconsistency, no hierarchy issue.

## Gate design-conformance (ak): pass

DESIGN.md mentions confirmation toasts at lines 53 (semantic Info color), 82 (brand-personality surface), 106 ("Slides in from bottom with `short` duration spring. Auto-dismisses after 3s. Does not block the list."). The diff preserves all three: the toast still slides in, still auto-dismisses (existing `useEffect` in ConfirmationToast.tsx), and still doesn't block (the outer wrapper retains `pointer-events-none`). Width is not a documented contract claim. No claim violated.

## Gate 9 (`qa`): pass (live walk)

> **Audit-1 amendment 2026-05-08**: this section was rewritten after a re-run
> against a healthy local Supabase stack (`auth/v1/health` returns 200; admin
> `createUser` works; the prior "Database error querying schema" symptom no
> longer reproduces). The original Audit-1 stamp recorded a synthetic
> DOM-injection substitution under a Gate-9 dismissal — that substitution
> has been retracted in favor of the authentic walk recorded here.

Live walk drives the real user-facing flow that surfaces ConfirmationToast:

1. Admin API pre-confirms a fixed test user (idempotent, bypasses signup
   rate-limit + email-domain gate).
2. UI sign-in → onboarding (create household "Toast QA") → `/list`.
3. AddItemSheet opens via FAB → user types `Tilapia` → submits.
4. Cascading store-disambig fires (no `purchase_history` for fresh
   household) → first store option picked → confirm.
5. ConfirmationToast renders bottom-center on `/list` with text
   `Added Tilapia to Costco`. Inner-pill width measured via Playwright
   `boundingBox()` — `190.89px`, inside the regression bound `(100, 384]`.
6. Same flow re-run dark-themed (`Mantequilla`) → `225.23px`, pass.
7. Long-message cap-evidence (synthetic ~110-character message rendered
   through the production `ConfirmationToast.tsx:37` class set) →
   `384.0px`, exact 24rem cap, pass.
8. Mobile (375×667) light + dark re-run with `Aceitunas` / `Pimientos` →
   both render the toast correctly (visual evidence captured).

All assertions pass; no console errors fatal to the flow (PostHog
network blocks under devcontainer firewall are expected and noted in
the log). Test user + household cleanup verified at end of run.

Evidence:

- Spec: `apps/web/e2e/confirmation-toast-width-qa-walk.spec.ts`
  (qa-walk Playwright project, opt-in; not in fast-job CI).
- Per-verb artifacts: `specs/confirmation-toast-width/qa-walk/verb-N-<slug>.{png,json}`
  (6 verbs).
- Hero shots: `specs/confirmation-toast-width/hero/{confirmation-toast,confirmation-toast-dark,confirmation-toast-long-message}.png`.
- 4-combo + long screenshots: `specs/confirmation-toast-width/screenshots/`
  (1440 light/dark, 1440 light long, 375 light/dark).
- Run log: `specs/confirmation-toast-width/qa-walk.log` —
  ISO timestamps + per-verb width measurements + cleanup confirmation.

Caveats acknowledged in the run:

- Verb 6 (long-message cap) injects a synthetic long string because
  seed canonical_item names are short (max ~30 chars); the toast DOM
  uses the verbatim production class set
  (`max-w-[24rem] rounded-default bg-text-primary px-md py-sm font-body
text-[14px] text-background shadow-lg`) so the 384px cap measurement
  is authentic — only the message text is synthetic. Verbs 4/5 (the
  load-bearing live-flow evidence) use real server-resolved messages
  end-to-end.
- `auth.admin.listUsers()` 500s on this stack ("Database error
  finding users" — already documented in `helpers/admin-client.ts:74`).
  The walk uses an inline `createOrFindTestUser` that calls
  `createUser` directly + falls back to an anon-client `signInWithPassword`
  to recover the UUID, bypassing `listUsers()`. No impact on test
  correctness.

## Gate 10 (`benchmark`): n/a

Pure CSS-token rule generation; no measurable performance change. Tailwind emits one additional rule (`.max-w-\[24rem\]{max-width:24rem}`) of identical cost to the previous `.max-w-sm{max-width:8px}` (after token shadowing). No bundle-size delta, no runtime delta, no Core Web Vitals impact.

## Gate 11 (`convention`): pass

- `bash /devshop/kit/scripts/commit-hooks/check-file-headers.sh main` → exit 0 (no flagged files).
- ConfirmationToast.tsx: 1-line CSS change to an existing file with existing header — no new JSDoc / header obligation.
- No new migrations → ROLLBACK + ON DELETE checks `n/a`.
- No new `subscribeTo<X>` helpers → realtime publication check `n/a`.
- PRODUCT-ROADMAP / kit-ROADMAP completed-item sweep: nothing on this PR matches a roadmap entry that needs removal.

## Gate 13 (`hero-shots`): pass

3 hero shots committed at `specs/confirmation-toast-width/hero/`:

- `confirmation-toast.png` — default success toast at correct width (1440 light).
- `confirmation-toast-dark.png` — same toast in dark theme.
- `confirmation-toast-long-message.png` — long message demonstrating 24rem cap with line-wrap.

## Dismissals

The single remaining dismissed finding is environmental, accepted:

1. **`changed-tests-local` smoke-set "failure"**: the harness invokes `playwright test --project=chromium` but this repo's projects are `mobile`/`desktop`/`qa-walk`. Pre-existing harness/repo mismatch — not introduced by this diff and orthogonal to a CSS class fix. Re-running the actual Playwright config with `--project=desktop` succeeded (5/5 specs).

> The Gate-9 dismissal originally recorded here ("`/qa` live happy-path skip
> due to local-Supabase auth-schema break") was retracted in the 2026-05-08
> Audit-1 amendment — the live walk re-ran successfully against the now-healthy
> stack. See **Gate 9** above for the authentic outcome and evidence pointers.

## Counts

- `passed`: 10 (slow-job-lifecycle, responsive-theme, simplify, docs-and-tests-review, review, design-review, design-conformance, qa, convention, hero-shots)
- `findings_pending`: 0
- `n_a`: 5 (docs-check, metrics-check, rls-coverage, cso, benchmark)
- `blocked`: 0

(Per ak-pre-ship contract, the canonical 11 gates + Gate 13 hero shots: 10 pass / 5 n/a / 1 finding-environmental-dismissed / 0 blocked. The pre-amendment count showed 9 pass / 1 dismissal-on-Gate-9; the 2026-05-08 amendment cleared the dismissal and Gate 9 is now `pass (live walk)`.)

---

## Audit 2 — post-pre-ship CI workflow fix

<!-- audited-at: 3d1546c6ff60b237d1b67e068cec172d2cbdd380 -->
<!-- range: e2823fb..3d1546c -->

Date: 2026-05-07
Label: post-pre-ship (incremental — single-commit re-audit)
Findings: high=0 medium=0 low=0

### Range scope

Two commits added on top of the prior pre-ship target (`e2823fb`):

- `3ef24da` — `chore(confirmation-toast-width): pre-ship audit + hero shots` — adds `specs/confirmation-toast-width/{review.md, hero/*.png}` only. Spec-dir artifacts; no source-code or reference-doc surface touched.
- `3d1546c` — `fix(ci): drop pnpm version: latest, fall through to package.json#packageManager` — edits `.github/workflows/ci.yml` only. Drops `with: version: latest` from both `pnpm/action-setup@v3` blocks (fast + slow jobs); adds inline comment documenting the 2026-05-07 pnpm-11 / Node-20 incompatibility (pnpm 11 requires Node 22.13+ for `node:sqlite`; workflow pins `node-version: 20`). The fallback target `pnpm@10.33.0` is verified present in `/workspace/package.json`'s `"packageManager"` field.

No source code, edge functions, migrations, API wrappers, page/route additions, test files, or product-surface docs touched.

### Gates re-run (incremental)

| Gate                                                 | Outcome                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cheap regression (`lint typecheck test:unit`)        | pass — `pnpm turbo run lint typecheck test:unit` → 7/7 turbo tasks successful. Web 252 tests pass, ui 56 tests pass. No regressions from the unchanged toast fix.                                                                                                                                |
| `review` (manual diff review)                        | pass — change is correct (`packageManager: pnpm@10.33.0` verified in package.json), inline comment is substantive (names symptom, root cause, fix, dated), symmetric across fast + slow jobs.                                                                                                    |
| `simplify`                                           | pass — diff is itself a simplification (removed `with: version: latest`, replaced with a documenting comment). No further simplification opportunity.                                                                                                                                            |
| `convention`                                         | pass — `kit/scripts/commit-hooks/check-file-headers.sh main` returned empty. Workflow YAML has no header / JSDoc / migration / realtime triggers.                                                                                                                                                |
| `docs-and-tests-review` (`/ak-check-docs-and-tests`) | pass — see findings below (zero in both domains).                                                                                                                                                                                                                                                |
| `cso` (lite — workflow diff scan)                    | pass — security-positive: replacing `version: latest` (floating tag) with packageManager fall-through (pinned `pnpm@10.33.0`) tightens supply-chain pinning. Diff touches no `secrets.*`, no `env:`, no action permissions, no token-handling step. Action ref `pnpm/action-setup@v3` unchanged. |

### Gates intentionally NOT re-run (per caller direction)

| Gate                            | Reason                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `responsive-theme` (Gate 3)     | n/a — CSS unchanged since prior audit (`apps/web/components/ConfirmationToast.tsx` + `globals.css` untouched in range).                                                           |
| `design-review` (Gate 8)        | n/a — no visual change.                                                                                                                                                           |
| `design-conformance` (Gate 8b)  | n/a — no visual / copy change.                                                                                                                                                    |
| `qa` (Gate 9, live walkthrough) | n/a — no new UI; the Audit-1 visual-evidence record (now superseded by the 2026-05-08 amendment to a live walk) covered the toast surface and Audit-2's range adds no UI surface. |
| `benchmark` (Gate 10)           | n/a — workflow YAML has no Web Vitals impact.                                                                                                                                     |
| Hero screenshots (Gate 13)      | n/a — visuals unchanged; prior hero shots remain canonical.                                                                                                                       |

### Docs findings

- (none) — no source surface or reference doc (`CLAUDE.md`, `METRICS.md`, `OVERVIEW.md`, `ARCHITECTURE.md`, `apps/*/README.md`, `packages/*/README.md`, `supabase/functions/README.md`) touched. The inline workflow YAML comment is locally adequate (names symptom, root cause, dated). The pnpm-11 / Node-20 incompat is generic to GitHub Actions tooling, not a lalista-specific gotcha — no `CLAUDE.md § Gotchas` entry warranted.

### Tests findings

- (none) — Section A/B/C triggers all zero: no API wrapper changes, no page/route additions, no migrations, no edge function changes, no test files touched, no `Tests-Coverage-Bypass:` trailers in range. The unchanged test suite passed end-to-end via `pnpm turbo run lint typecheck test:unit` — confirms no regression from the workflow change.

### Bypass trailer audit

- (none) — no `Docs-Coverage-Bypass:` or `Tests-Coverage-Bypass:` trailers harvested in `e2823fb..3d1546c`.

### Counts (this incremental run only — not cumulative)

- `passed`: 6 (cheap-regression, review, simplify, convention, docs-and-tests-review, cso)
- `findings_pending`: 0
- `n_a`: 6 (responsive-theme, design-review, design-conformance, qa, benchmark, hero-shots)
- `blocked`: 0
