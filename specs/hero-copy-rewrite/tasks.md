# Tasks: hero-copy-rewrite

Generated from `specs/hero-copy-rewrite/spec.md § Task order`. Atomic-commit
note: tasks 1+2 land in a single commit (atomic byline swap so CI fast-job is
green at every commit boundary). Tasks 3 and 4 may be one or two commits.

---

## Task: Update PublicLanding.tsx byline + JSDoc § reference

**Hat**: FE
**Depends on**: none
**Blocks**: Update PublicLanding.test.tsx assertion + comment (must land in same commit)
**Done when**: `apps/web/components/PublicLanding.tsx` line 23 reads `groceries on a word.`; JSDoc on lines 14–15 cites `DESIGN.md § Copy & Voice § Canonical voice examples` (no line number).
**Risk**: low
**Status**: done

## Task: Update PublicLanding.test.tsx assertion + comment

**Hat**: FE
**Depends on**: Update PublicLanding.tsx byline + JSDoc § reference (lockstep — same commit)
**Blocks**: none
**Done when**: line 35 comment cites the new byline + new DESIGN.md § path; line 40 regex is `/groceries on a word\./i`; `pnpm turbo run test:unit` passes.
**Risk**: low
**Status**: done

## Task: Restructure DESIGN.md § Copy & Voice (Canonical voice examples)

**Hat**: PM
**Depends on**: none
**Blocks**: Add DESIGN.md § Decisions Log row (the row references this restructure)
**Done when**: `### Canonical voice example` (singular) renamed to `### Canonical voice examples` (plural) with three teaching beats (original byline annotated for what works + what slips; claim register `skip the list-making session.`; brag register `groceries on a word.`); each beat is a quote + short annotation paragraph.
**Risk**: low
**Status**: done

## Task: Add DESIGN.md § Decisions Log row

**Hat**: PM
**Depends on**: Restructure DESIGN.md § Copy & Voice (Canonical voice examples)
**Blocks**: none
**Done when**: a new `2026-05-06` row is appended to the existing Decisions Log table covering byline swap + canonical-examples restructure as one tightly-coupled decision; rationale cites `PRODUCT-ROADMAP.md § v0 § 1o` opportunity-first / Tesla-mode framing; existing rows unreordered.
**Risk**: low
**Status**: done

---

## Decisions

- **JSDoc citation form** (Task 1): used `DESIGN.md § Copy & Voice § Canonical voice examples` (no line number) per spec § Gotchas — line numbers in cross-file citations are a maintenance trap; the section name suffices.
- **Tasks 1+2 grouped into one commit** (per spec § Task order atomic-commit grouping): byline + test moved together so CI fast-job is green at the commit boundary. tasks.md was bundled into the same commit because it's bookkeeping, not a separable code change.
- **Task 3 and Task 4 split into two commits**: spec § Task order called out tasks 3+4 as combinable or separable. Split them so the Decisions Log row reads as a discrete provenance entry that points back at the doctrine restructure commit, rather than burying both inside one diff.
- **Decisions Log row wording** (Task 4): wrote the Decision cell as "swap A → B; § rename" rather than two separate phrasings, per D5 — the restructure exists _because_ the byline changed, and a single combined cell makes that coupling explicit. Rationale cell cites `PRODUCT-ROADMAP.md § v0 § 1o` and quotes the "on a [tiny resource]" idiom rationale verbatim from D1 so a future reader doesn't need to chase three docs.
