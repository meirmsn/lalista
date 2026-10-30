<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: hero-copy-rewrite -->
<!-- date: 2026-05-06 -->

# Spec: hero-copy-rewrite (PR N)

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1o` — primary scope (hero-copy rewrite — opportunity-first byline)
- `PLAN.md` row #3 — branch tracker entry for hero-copy-rewrite
- `DESIGN.md § Copy & Voice` (lines 140–174) — voice doctrine being deepened; § Canonical voice example being restructured
- `apps/web/components/PublicLanding.tsx` — byline source (line 23) + JSDoc § reference (line 14–15)
- `apps/web/components/PublicLanding.test.tsx` — existing canonical-byline assertion (line 35 comment + line 40 assertion)
- Conversation 2026-05-06 — copy-direction brainstorm that landed on `groceries on a word.` (Tesla-mode opportunity-first; "on a [tiny resource]" idiom)
- Prior spec `specs/app-snappiness/spec.md` — style + structure reference

Replace the public-landing byline with an opportunity-first ("on a [tiny resource]" idiom) line, restructure DESIGN.md's `§ Canonical voice example` block from one example into three teaching beats (claim register + brag register + the original annotated for what works and what slips), and log the decision in DESIGN.md `§ Decisions Log`. Copy-only — no layout, no typography, no CTAs, no new files, no new tests.

---

## Decisions (resolved at spec time)

8 `/ak-spec`-time decisions resolved in Phase 0 with the user (conversation 2026-05-06). Recorded below verbatim so Phase 1 preserves them and a crashed Phase 1 resumes without re-asking.

### D1: Final byline copy

**Decision:** `groceries on a word.` — lowercase, no comma, period.

**Rationale:** "On a [tiny resource]" is an established English idiom shape ("on a dime" / "on a budget" / "on a whim") that means "sustained with the minimum resource possible." Folds input cost (a single word) and ongoing kitchen-continuity outcome into four words. Opportunity-first per § 1o's motivation: the brag is "your kitchen runs on almost nothing," not "we make grocery lists less bad." Could a competitor use it? No — every other grocery app needs more than a word.

### D2: Keep or replace the original byline in DESIGN.md?

**Decision:** Keep `say leche. it handles the rest.` as a teaching example, annotated for what works (front half) and what slips (back half).

**Rationale:** The front half is still the strongest demo of the bilingual + restraint move (lowercase + period; bilingual without making a thing of it; voice-first without saying "voice"). The back half's failure — "handles" is the assistant-verb the doctrine itself warns against ("category sin"); "the rest" is impressionistic where the line should make a claim — is itself useful teaching material for future copy work. Replacing it loses both teaching surfaces.

### D3: Comma vs no-comma in the new byline

**Decision:** `groceries on a word.` (no comma), not `groceries, on a word.` (with comma).

**Rationale:** The comma adds a half-beat that softens the punch; the unbroken phrase reads more confidently. The "on a [tiny resource]" idiom is established enough to carry without the punctuation crutch.

### D4: Three teaching beats in `### Canonical voice examples`

**Decision:** Restructure the singular `### Canonical voice example` block into a plural `### Canonical voice examples` block with three teaching beats:

1. **Original byline as a teaching example** — annotated for what works (front half) and what slips (back half — "handles" = assistant-verb category sin; "the rest" = impressionistic where it should be a claim).
2. **Claim register** — `skip the list-making session.` Names the specific nonsense competitors leave in (the planning session itself); restraint as feature; makes a statement someone could disagree with.
3. **Brag register** — `groceries on a word.` Tesla-mode future-state outcome via the "on a [tiny resource]" idiom; states the future-state without describing the mechanism.

**Rationale:** Plural canonical examples teach two registers (claim + brag) at once and let the original earn its keep as a "what slips" example without being demoted to oblivion. Doctrine deepens without bloating.

### D5: DESIGN.md Decisions Log row count

**Decision:** A single row capturing both the byline swap and the canonical-examples restructure as one decision.

**Rationale:** Tightly coupled — the restructure exists _because_ the byline changed. Splitting into two rows reads as if the doctrine restructure was independent doctrine work, which it isn't.

### D6: New tests?

**Decision:** None. Swap the existing byline assertion to the new string; no new test files; no E2E added.

**Rationale:** The roadmap is explicit that this is a copy-only chapter — no rendering/layout/CTA changes; the existing `PublicLanding` smoke test already asserts the byline string and pins the no-extra-interactive-elements invariant. Symmetric to how prior copy-only chapters (e.g. password-strength wording) handled it.

### D7: Update both the test comment and the assertion regex

**Decision:** Update both `apps/web/components/PublicLanding.test.tsx:35` (comment citing the old byline) and `apps/web/components/PublicLanding.test.tsx:40` (regex `/say leche\. it handles the rest\./i`) to reflect the new copy.

**Rationale:** A stale comment that says "DESIGN.md line 140 prescribes …" while the assertion matches a different string is its own correctness signal — future readers don't know which is the source of truth. Update both atomically.

### D8: PublicLanding JSDoc § reference

**Decision:** Update `apps/web/components/PublicLanding.tsx:14–15`'s JSDoc reference from `DESIGN.md § Voice line 140's canonical example` to point at the renamed `§ Canonical voice examples` (plural) at its new line number.

**Rationale:** The JSDoc cites a section that's about to be renamed; leaving the cite stale invalidates a teaching pointer for future readers. Cheap to update in the same commit as the byline swap.

---

<!-- /ak-spec (Phase 1) expands the file from here: In scope, Screens, Data
     model changes, API contracts, Offline behavior, Metrics, Files to
     create/modify, Tests, Dependencies, Task order, Gotchas, Acceptance /
     rollout / rollback. The Decisions section above stays verbatim. -->

## Core user story

N/A — copy-only doctrine refresh. The user-observable change is a 4-word string swap on `/` (the public landing). No new flow, no new verb, no new render conditions. The existing `PublicLanding` smoke test (`apps/web/components/PublicLanding.test.tsx`) pins the visible byline string and the no-extra-interactive-elements invariant — Gate 9 may treat this PR as N/A and skip per-verb artifact assertion.

## In scope

- **Byline string swap** on `apps/web/components/PublicLanding.tsx:23` — `say leche. it handles the rest.` → `groceries on a word.` (D1, D3).
- **JSDoc § reference update** on `apps/web/components/PublicLanding.tsx:14–15` — `DESIGN.md § Voice line 140's canonical example` → `DESIGN.md § Copy & Voice § Canonical voice examples` at its new line number (D8).
- **Test assertion + comment swap** on `apps/web/components/PublicLanding.test.tsx:35` (comment) and `:40` (regex) so both reflect the new byline atomically (D6, D7).
- **`DESIGN.md § Copy & Voice` restructure** of `### Canonical voice example` (singular, lines 170–174) into `### Canonical voice examples` (plural) with three teaching beats (D2, D4):
  1. Original byline `say leche. it handles the rest.` — annotated for what works (front half — lowercase + period; bilingual without making a thing of it; voice-first without saying "voice"; implies store-routing without explaining it) and what slips (back half — "handles" is the assistant-verb the category sin warns against; "the rest" is impressionistic where the line should be a claim).
  2. **Claim register** — `skip the list-making session.` Names the specific nonsense competitors leave in (the planning session itself); restraint as feature; makes a statement someone could disagree with.
  3. **Brag register** — `groceries on a word.` Tesla-mode future-state outcome via the "on a [tiny resource]" idiom; states the future-state without describing the mechanism.
- **`DESIGN.md § Decisions Log` row** — single new row (date `2026-05-06`) capturing both the byline swap and the canonical-examples restructure as one tightly-coupled decision (D5).

## Out of scope (by design)

- Hero subline / secondary copy on `/`. No subline exists today; don't preemptively add one (per the doctrine's "Know when to stop").
- Public-landing layout, typography, CTA copy, link targets, palette. All unchanged.
- Hero copy on any other surface (auth screens, onboarding, future marketing pages).
- Other voice-doctrine line edits beyond the canonical-examples block.
- New tests, new test files, new E2E specs (D6 — copy-only chapter; existing test gets its assertion swapped).
- New METRICS events. Pure copy change; analytics taxonomy unchanged.
- Translation / bilingual variants of the new byline. EN-only stays EN-only at v0.

## Render conditions

N/A — no new UI element introduced, no visibility logic added or modified, no `if (…)` / `&&` / `?:` added inside any JSX/TSX file. The diff replaces a literal string in one `<p>` and rewrites prose in `DESIGN.md`. Per the spec convention this section may be omitted on backend-only / refactor / pure-text PRs; declared explicitly so the gate knows it was considered.

## Files to create / modify

| Path                                         | Change                                         | Why                                                                                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/PublicLanding.tsx`      | modify (line 23 + 14–15)                       | Byline string swap (D1) + JSDoc § reference update so the cited section name + line number match post-restructure DESIGN.md (D8).                                                               |
| `apps/web/components/PublicLanding.test.tsx` | modify (line 35 + 40)                          | Comment + assertion regex updated atomically — stale-comment-vs-live-assertion drift is its own correctness signal (D7).                                                                        |
| `DESIGN.md`                                  | modify (lines 170–174 + § Decisions Log table) | Restructure singular `### Canonical voice example` into plural `### Canonical voice examples` with three teaching beats (D2, D4); add a new row to the Decisions Log table for the change (D5). |

No files created. No files deleted. No new tests, no new fixtures, no new assets.

## Data model changes

None.

## API contracts

None.

## Service dependencies

None new. No env vars, no third-party APIs, no edge-function changes, no migrations.

## Offline behavior

N/A — `/` is a static-render unauthed page with no remote data; behavior identical online and offline. The byline is a literal in the React component bundle, served from the CDN edge.

## Metrics

No new events. No existing-event instrumentation added. Per D6 + roadmap § 1o, this is a copy-only chapter; analytics taxonomy in `METRICS.md` is unchanged.

## Tests

Per D6 — no new test files, no new E2E specs.

- **Modified**: `apps/web/components/PublicLanding.test.tsx` — the `it('renders the canonical byline from DESIGN.md § Voice', …)` block at line 34 keeps its shape; line 35's comment and line 40's regex both swap to the new byline string. The other four tests in the file (wordmark, primary CTA, secondary CTA, no-extra-interactive-elements invariant) are unchanged and continue to pass — they are the structural guardrails that this PR does NOT touch.
- **Unchanged**: every other unit / integration / E2E spec in the repo. No E2E asserts byline text today; the public-landing E2E coverage exercises CTA navigation (`/sign-up` and `/sign-in` link targets), which is unaffected.
- **CI surfaces**: vitest fast-job runs `PublicLanding.test.tsx` — the assertion swap must land in the same commit as the component change or fast-job goes red on CI. See § Gotchas.

## Dependencies

None. The four tasks (component, test, DESIGN.md restructure, DESIGN.md decisions-log row) are largely independent — the only ordering constraint is that the component change and the test change must land in the same commit for CI to stay green (atomic byline swap; see § Task order task 1+2 grouping note).

## Task order

Mirrors the Phase 0 tracker (tasks #2–#5). All four tasks land in this PR; tasks 1 and 2 are committed together (atomic byline swap so CI fast-job stays green at every commit boundary), tasks 3 and 4 follow as separate commits since they're doctrine work that can be reviewed independently.

1. **Update `PublicLanding.tsx` byline + JSDoc § reference** (D1, D8). Swap `say leche. it handles the rest.` → `groceries on a word.` on line 23. Update the JSDoc on lines 14–15 to cite `DESIGN.md § Copy & Voice § Canonical voice examples` (the renamed plural section). Don't ship this commit alone — the test will fail. Land together with task 2.
2. **Update `PublicLanding.test.tsx` assertion + comment** (D6, D7). Line 35 comment: replace the old-byline citation with the new line. Line 40 regex: `/say leche\. it handles the rest\./i` → `/groceries on a word\./i`. Commit together with task 1 as a single atomic byline-swap commit so CI fast-job is green at every commit boundary on the branch.
3. **Restructure `DESIGN.md § Copy & Voice`** (D2, D4). Lines 170–174 — rename `### Canonical voice example` → `### Canonical voice examples` (plural) and replace the single annotated quote with the three-beat structure: original byline annotated for what works + what slips; `skip the list-making session.` as the claim register; `groceries on a word.` as the brag register. Keep the three beats short — paragraph each, not a full essay.
4. **Add `DESIGN.md § Decisions Log` row** (D5). Single new row with `2026-05-06` as the date, decision text covering byline swap + canonical-examples restructure as one tightly-coupled decision (the restructure exists because the byline changed), rationale citing the opportunity-first / Tesla-mode framing from `PRODUCT-ROADMAP.md § v0 § 1o`. Append to the existing table; don't reorder existing rows.

## Gotchas

- **The existing `PublicLanding` test pins the byline regex on line 40 with `/say leche\. it handles the rest\./i`.** Editing `PublicLanding.tsx` without updating the test in lockstep makes CI fast-job (`pnpm turbo run test:unit`) go red on the very next push. Land the component change and the test change in the same commit. Phase 0 task 2 exists specifically to enforce this lockstep.
- **The DESIGN.md Decisions Log row is the most likely thing to need a fresh look at review time.** The byline swap is mechanical (one string, one assertion); the canonical-examples restructure is opinionated but bounded to one ~10-line section. The Decisions Log row is the only place where wording the rationale sloppily reads as if the doctrine restructure was independent doctrine work — which it isn't, per D5. Treat the row's "Decision" + "Rationale" cells as copy in their own right and apply the doctrine to them: claim, not impression; concrete, not vague; restraint over completeness.
- **The JSDoc reference on `PublicLanding.tsx:14–15` cites a section name + line number that's about to change.** After task 3 lands, `### Canonical voice example` (singular, line ~170) becomes `### Canonical voice examples` (plural, possibly at a slightly different line because the body grows from 5 lines to ~12). Update the JSDoc citation to the new section name; don't try to pin a new line number in the JSDoc (line numbers in cross-file citations are a maintenance trap — section names suffice).
- **Don't "improve" the original byline while restructuring DESIGN.md.** The original `say leche. it handles the rest.` stays exactly as-is in the new `### Canonical voice examples` block (per D2). The teaching value is in the line being preserved verbatim with annotation pointing at the failure — rewriting it loses both the historical record and the teaching surface.
- **Watch for stray references to the old byline elsewhere in the repo.** A grep for `say leche` should return only the files this PR touches (`PublicLanding.tsx`, `PublicLanding.test.tsx`, the original-byline quote inside the new DESIGN.md block, plus this spec). If it returns anything else, that file got a citation copy somewhere and needs an update too — surface it during `/ak-implement` rather than leaving a stale reference.
- **No subline / no second hero line.** Resist the urge to "fix" the new four-word byline by adding clarifying copy. Per § Out of scope and the doctrine's "Know when to stop" — a single perfectly placed gesture lands because it arrives once and leaves. If first-time-visitor confusion surfaces in dogfood, that's a separate roadmap entry.

## Acceptance

- `/` (public landing for unauth visitors) renders `groceries on a word.` as the byline at 375px and 1440px, light + dark, matching the existing typographic styling (no class changes — same `<p>` wrapper).
- `pnpm turbo run test:unit` passes — `PublicLanding.test.tsx` continues to assert the byline string, now pinned to the new copy.
- `DESIGN.md § Copy & Voice § Canonical voice examples` (plural) renders three teaching beats; the original byline is preserved verbatim with explicit "what works / what slips" annotation; `groceries on a word.` and `skip the list-making session.` appear as the brag and claim register beats respectively.
- `DESIGN.md § Decisions Log` has a new `2026-05-06` row for the byline + canonical-examples change, formatted consistently with the existing rows (Date / Decision / Rationale columns).
- No diff outside `apps/web/components/PublicLanding.tsx`, `apps/web/components/PublicLanding.test.tsx`, `DESIGN.md`, `PLAN.md` (planned→active flip), `BUILD-LOG.md` (Phase 5.6 entry written by `/ak-build`), and this spec file. If anything else changed, scope crept.

## Rollout

- Standard auto-deploy on merge to `main` via Vercel (`apps/web/vercel.json`); no migration step, no edge-function deploy, no env-var rotation, no DNS / SMTP / dashboard touch.
- No staged rollout, no feature flag — copy change, deploy globally on merge.
- Post-deploy canary: open `https://lalista.store/` and confirm the byline reads `groceries on a word.`. That's the entire post-deploy verification.

## Rollback

- Single revert commit on `main` reverses the byline + DESIGN.md changes atomically. The PR is small enough (4 files, byline + test + DESIGN.md restructure + Decisions Log row) that `git revert <merge-commit> -m 1` produces a clean reversal with no residual touched files.
- No data to migrate back, no sessions to invalidate, no caches to bust beyond Vercel's automatic CDN cache invalidation on the next deploy.
- If the rollback is for taste reasons (the new byline doesn't land in dogfood), the symmetric forward-fix is a fresh PR with a different byline string — not a flag flip — because the byline is a literal in the React bundle, not a runtime config value.
