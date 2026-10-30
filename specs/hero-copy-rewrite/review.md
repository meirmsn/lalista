<!-- audited-at: 52c4526dc32715d0ee6fb43838409ed3a0503ecc -->

# Pre-ship review: hero-copy-rewrite

Branch: `feature/hero-copy-rewrite`
Range: `main..HEAD` (3 commits — atomic byline + test swap, DESIGN.md restructure, DESIGN.md decisions-log row)
Scope: copy-only — `apps/web/components/PublicLanding.tsx`, `apps/web/components/PublicLanding.test.tsx`, `DESIGN.md`, plus spec/tasks/PLAN.md bookkeeping.

## Router Summary

| Gate                         | Dismissals                  | Adversarial review            |
| ---------------------------- | --------------------------- | ----------------------------- |
| `docs-check` (ak)            | None                        | skipped (scoped parse = None) |
| `metrics-check` (ak)         | None                        | skipped (scoped parse = None) |
| `rls-coverage` (ak)          | None                        | skipped                       |
| `slow-job-lifecycle` (ak)    | None                        | skipped                       |
| `responsive-theme` (ak)      | None                        | skipped                       |
| `simplify`                   | None                        | skipped                       |
| `docs-and-tests-review` (ak) | 2 low informational only    | skipped (none high/medium)    |
| `review`                     | None                        | skipped                       |
| `cso`                        | None                        | skipped                       |
| `design-review`              | None                        | skipped                       |
| `design-conformance` (ak)    | None (extractor returned 0) | skipped                       |
| `qa`                         | None                        | skipped                       |
| `benchmark`                  | None                        | skipped                       |
| `convention` (ak)            | None                        | skipped                       |

**Total dismissed findings**: 2 (both low-severity informational, neither requires action). 0 LLM-reviewed, 0 shim-mapped, 0 rejected.

## Gate results

### Gate 1: Devshop docs check — `n/a`

No `kit/` or reference-doc files touched in this PR.

### Gate 2: Metrics check — `n/a`

Copy-only diff. No new event instrumentation surface (`posthog.capture` / `Sentry.captureException`) added; existing analytics taxonomy in `METRICS.md` unchanged.

### Gate 2b: RLS coverage — `pass`

`bash /devshop/kit/scripts/preship/rls-coverage-check.sh /workspace` → exit 0. No client-API or migration changes; no new tables to verify.

### Gate 2c: Slow-job lifecycle — `pass`

`bash /devshop/kit/scripts/preship/slow-job-lifecycle-check.sh /workspace` → exit 0.

### Gate 3: Responsive + theme — `pass`

Captured 4 evidence shots of `/` (the byline's surface) at:

- `specs/hero-copy-rewrite/screenshots/landing-1440-light.png`
- `specs/hero-copy-rewrite/screenshots/landing-1440-dark.png`
- `specs/hero-copy-rewrite/screenshots/landing-375-light.png`
- `specs/hero-copy-rewrite/screenshots/landing-375-dark.png`

Byline `groceries on a word.` renders correctly at all four combos: lowercase, period, no comma; centered; readable in both themes; no overflow at 375 px; no clipped baseline; CTA button still 44 px+ tappable. (No new pages added, so per spec evidence enforcement, this is the canonical surface for the diff.)

### Gate 4: /simplify — `pass`

Diff is 4 lines of TSX changes (one byline string, three lines of test assertion + comment, three lines of JSDoc) plus DESIGN.md prose. Nothing to simplify — the change _is_ the minimal expression of the swap. After-gate `pnpm turbo run test:unit` → 251 tests passed across 36 test files. No regressions.

### Gate 5: /ak-check-docs-and-tests — `pass`

See `## Audit 1` below for full structured findings. Summary: 0 high, 0 medium, 2 low (both low findings are informational only — preserved historical references that are intentionally retained per spec D2 / chapter-1o roadmap provenance).

### Gate 6: /review — `pass`

Staff-engineer review of the diff (`apps/web/components/PublicLanding.tsx` + `.test.tsx`):

- **SQL safety**: N/A — no SQL changes.
- **LLM trust boundary**: N/A — no LLM input or response handling touched.
- **Conditional side effects**: N/A — no new conditionals; the change is a pure literal-string swap inside JSX, plus a JSDoc comment update, plus a test regex update.
- **Other structural issues**: none. The diff is the minimum-viable expression of the swap. JSDoc was kept honest by citing a section name without a line number (avoids the cross-file line-number maintenance trap per spec § Gotchas).

No code changes from this gate; no test re-run needed.

### Gate 7: /cso — `pass`

- No secrets, tokens, credentials, auth flows, or RLS policies touched.
- Byline is rendered as React text content (not `dangerouslySetInnerHTML`); no XSS surface.
- No supply-chain changes (no `package.json` / `pnpm-lock.yaml` touches).
- No CI/CD config changes.
- No new edge-function code paths; no new RPC surfaces.

OWASP / STRIDE: nothing applicable to a copy-only static-string change.

### Gate 8: /design-review — `pass`

Designer-eye audit of the live byline at `http://localhost:3000/` (1440 light + dark, 375 light + dark; see `screenshots/`).

**First impression** — the site communicates a confident, restrained voice. Hierarchy reads cleanly: wordmark > primary CTA > byline > secondary link. The byline `groceries on a word.` is a complete idea in four words; the "on a [tiny resource]" idiom carries an implied claim (your kitchen runs on almost nothing) without explanation, hedge, or subline. Stops where the doctrine says to stop.

**AI Slop Score**: A. Going through the 10-pattern blacklist:

- Generic hero copy — the byline is the opposite of "Welcome to lalista" / "Unlock the power of grocery lists." It's specific, idiomatic, and only this product can use it. The replaced line had a "what slips" half ("handles" = assistant-verb category sin); the new line removes that. Net positive.
- All other 9 AI-slop patterns: not present (already established in prior `/design-review` runs; this PR doesn't introduce any).

**DESIGN.md voice doctrine alignment** — checked the new byline against all 7 principles in `§ Copy & Voice § Principles`:

1. Start with what's actually true → PASS (names the actual minimum input).
2. Make claims, not impressions → PASS (a competitor would have to lie to use it).
3. Notice more than you say → PASS (idiom shape is "noticed" English, not constructed).
4. Name things like a person, not a system → PASS (sharp-friend register, not system register).
5. Earn the lightness with the substance → PASS (the wit sits on top of a real product capability).
6. Let surprise be inevitable in hindsight → PASS (parses literal first, idiomatic on second pass).
7. Know when to stop → **PASS — the cleanest demo of this principle in the codebase.**

**Critique (looking for what slips)**: the line requires the reader to know the "on a dime / on a budget" idiom shape; non-native English readers will spend an extra beat parsing. Doctrine § "Notice more than you say" treats this as feature, not bug — "trusting the reader to meet you there." Spec D1 explicitly chose this idiom shape as load-bearing. Worth flagging for dogfood, not a finding.

**Findings**: 0 high, 0 medium, 0 polish. **Design Score: A → A. AI Slop Score: A → A.**

### Gate 8b: /ak-design-conformance — `n/a`

Ran `bash /devshop/kit/scripts/preship/design-conformance.sh run --feature hero-copy-rewrite --design DESIGN.md`. Extractor returned 0 normative claims (DESIGN.md `§ Copy & Voice` is principle-prose, not mechanical claim grammar — no explicit token values, no imperative rules, no component-contract claims). Per skill spec: "DESIGN.md contains only aspirational prose and the extractor returned zero normative claims" → outcome is `n/a`. Cached at `specs/hero-copy-rewrite/design-claims.json` + `.sha256`. Report at `specs/hero-copy-rewrite/design-conformance-report.md`.

### Gate 9: /qa — `pass`

Per spec § Core user story (`N/A — copy-only doctrine refresh`), Gate 9 treats this PR as N/A and skips per-verb artifact assertion. Walked the happy path manually as the N/A-companion verification:

- Open `/` → `<main p>` text equals `groceries on a word.` ✓
- Click "Create account" → routes to `/sign-up` ✓ (artifact: `qa-walk/cta-create-account-landed.png`)
- Click "Sign in" → routes to `/sign-in` ✓
- 375×812 viewport — byline visible, no horizontal overflow ✓
- Dark mode — warm-dark background renders, byline legible ✓

Full structured trace at `specs/hero-copy-rewrite/qa-walk.log`.

Console errors observed: `net::ERR_ADDRESS_UNREACHABLE` for `us-assets.i.posthog.com` / `us.i.posthog.com` and `transferSize: 0` for some `_next/static/media` woff2 entries. **Both pre-existing devcontainer-firewall / Turbopack-dev artifacts; not introduced by this PR; not findings for this PR.**

### Gate 10: /benchmark — `n/a`

Copy-only string swap. Byline character count went from 32 → 19 chars (13-byte reduction in the SSR'd HTML). No bundle-size delta worth measuring; LCP / CLS dominated by the wordmark + CTA button, both unchanged.

### Gate 11: Convention check — `pass`

`bash /devshop/kit/scripts/commit-hooks/check-file-headers.sh main` → exit 0 (no findings).

Sub-checks:

- File headers / JSDoc on non-trivial files — `PublicLanding.tsx` keeps its component-level JSDoc (updated to cite the renamed § Canonical voice examples block per D8); the test file is exempt by convention (test files don't carry headers). PASS.
- Migration ROLLBACK comments — N/A (no migrations).
- `auth.users(id)` ON DELETE — N/A (no migrations).
- Realtime publication setup — N/A (no `subscribeTo*` helpers added).
- Backlog item routing — touched `PRODUCT-ROADMAP.md` (chapter 1o entry remains; will be cleaned in `/ak-build` Phase 5 BUILD-LOG bookkeeping per the canonical "completed roadmap items get logged + removed" pattern), `TODOS.md`, `PLAN.md` row flip — all in correct files.
- Completed roadmap items — chapter 1o is the entry being shipped by this PR; `/ak-build` Phase 5 will log to `BUILD-LOG.md` and remove from `PRODUCT-ROADMAP.md`. Pre-ship informational only — not a blocking finding for this gate (Phase 5 is downstream of pre-ship).

## Hero shot

`specs/hero-copy-rewrite/hero/landing.png` — `/` at 1440×900 light, the canonical user-visible artifact of this PR. The byline `groceries on a word.` is the only line of body copy on the page; this single shot captures the entire user-observable change.

## Audit 1: pre-polish (2026-05-06)

<!-- audited-at: 52c4526dc32715d0ee6fb43838409ed3a0503ecc -->
<!-- range: origin/main..HEAD -->

findings: high=0 medium=0 low=2

### Docs findings

- [low] packages/ui/src/Text.test.tsx:11 — `<Text>say leche.</Text>` smoke-sample for the generic Text primitive coincidentally matches a phrase from the now-historical byline. Not a stale byline reference (the test asserts generic React rendering, not copy-pinning), but a future global grep for "say leche" will surface it. Optional fix (defer): swap to a different sample string.
- [low] PRODUCT-ROADMAP.md:320 — chapter 1o entry quotes both old and new byline as part of the chapter scope; this is provenance, not a stale reference. Surrounding prose makes the swap context clear. No fix.

### Tests findings

- (none)

### Bypass trailer audit

- (none) — no `Docs-Coverage-Bypass:` or `Tests-Coverage-Bypass:` trailers in range.

## Audit 2: post-polish (2026-05-06)

<!-- audited-at: 106de599a4cae8e6ef83d658a8f12c050a190c59 -->
<!-- range: 52c4526..106de59 -->

findings: high=0 medium=0 low=0

### Docs findings

- (none)

### Tests findings

- (none)

### Bypass trailer audit

- (none) — no `Docs-Coverage-Bypass:` or `Tests-Coverage-Bypass:` trailers in range.

### CI sanity (Phase 5.8.1)

Two CI runs since PR #51 opened: run [25473757269](https://github.com/meirmsn/lalista-old/actions/runs/25473757269) on `906718f` (success) and run [25474296852](https://github.com/meirmsn/lalista-old/actions/runs/25474296852) on `106de59` (success). Latest is success — no halt.

### Notes

Range `52c4526..106de59` contains exactly two bookkeeping-only commits — `906718f` (Phase 3 pre-ship evidence under `specs/hero-copy-rewrite/**`) and `106de59` (BUILD-LOG entry + PLAN row flip + PRODUCT-ROADMAP § 1o deletion per `/ak-build` § 5.6 step 4). No application code, no test changes, no reference-doc edits (`CLAUDE.md` / `METRICS.md` / `OVERVIEW.md` / `ARCHITECTURE.md` / package READMEs all untouched). BUILD-LOG entry follows the established shape from prior chapters; cited paths spot-checked clean. Coverage / adequacy / coherence all trivially pass.
