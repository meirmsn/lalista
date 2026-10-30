# Plan — lalista

Forward-looking plan at the feature/PR grain.

- Pipeline phase per active branch: each feature's `specs/<name>/tasks.md`
- Shipped (rich history): `BUILD-LOG.md`
- Deferred / long-term: `PRODUCT-ROADMAP.md`
- Tactical bugs/polish: `TODOS.md`
- Plan history (including dropped rows): `git log --follow PLAN.md`

## Active

_No work in progress._

## Planned

| #   | Feature                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | structured-intent-parsing | Replace Claude's translator-only role in `supabase/functions/add-item/index.ts` with structured intent extraction — compound adds, quantity, unit, brand hints, store hints. Loops extracted items through existing pg_trgm match + routing independently; `AddItemResponse` grows an `entries[]` field for N-row optimistic inserts. `per-household-items-catalog` hard dep relaxes to "before 2nd household onboards" (single-household v0 can't self-contaminate). Source: `PRODUCT-ROADMAP.md § v0 § 1k`. Open `/ak-spec`-time decisions captured inline (compound cap, context window, unit normalization, compound-disambig UX). |

<!--
Conventions:
- Status lives in section membership (Active vs Planned) — no status column.
- A Planned row transitions to Active when /ak-spec runs: drop #, add Branch + Spec columns.
- An Active row disappears when the feature ships — BUILD-LOG.md carries the full record.
- A row that's dropped (rescope, deprecated) — delete it; git log + commit message is the audit trail.
- "Not now, maybe later" work belongs in PRODUCT-ROADMAP.md, not Planned.
- Planned ordered by # ascending (smallest = next up). Renumber on reorder.
-->
