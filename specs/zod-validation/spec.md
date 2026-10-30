<!-- feature: zod-validation -->
<!-- date: 2026-04-27 -->
<!-- adopts: /devshop/kit/docs/guide/conventions.md § Runtime Validation at LLM / Edge-Function Boundaries -->

# Spec: zod-validation (PR 6)

Adopts the devshop convention shipped 2026-04-27 in
`/devshop/kit/docs/guide/conventions.md § Runtime Validation at LLM /
Edge-Function Boundaries`. Lalista is the canonical first-adopter — this PR
is also the verification that the convention works on first use.

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1j` — primary scope.
- `/devshop/kit/docs/guide/conventions.md § Runtime Validation at LLM /
Edge-Function Boundaries` — the pattern (when/when-not, schema-module,
  wrapper-site `.safeParse()` + Sentry-scrubbed payload + typed error).
- `packages/core/src/api/addItem.ts` — the wrapper to gate.
- `packages/core/src/models/index.ts § AddItemResponse` — the response type
  to derive from the schema (one source of truth).
- `apps/web/components/{AddItemSheet,DisambiguationSheet}.tsx` — the call
  sites that catch the new typed error and route to Sentry.

---

## Core user story

The Zod gate sits in `invokeAddItem`'s response path. Every existing E2E spec
that exercises the add-item flow (auth-edge-cases, add-new, force-create-race,
core-flows-qa-walk, item-detail, realtime) transitively exercises the gate's
happy path: the response parses cleanly, the gate is invisible, the user
adds an item and sees it on the list.

The gate's _failure_ path (server returns malformed shape) can't be exercised
end-to-end against a real edge function — the server doesn't deliberately
return malformed data. Coverage for that path is unit-test only:

1. Missing required field → `AddItemValidationError` thrown.
2. Wrong type on a nested field → error issues carry a readable path.
3. Unknown forward-compat field → passes through, available on the result.

**`## Core user story` body for Gate 9**: `N/A — runtime validation gate
embedded in an existing wrapper; no new user-facing flow. Coverage is
existing add-item E2E specs (happy path) + new unit tests in
addItem.test.ts (failure paths).`

---

## Render conditions

`N/A — backend-only PR; no UI elements added or modified.`

---

## Decisions

1. **Parse client-side only.** Server-side parse is belt-and-suspenders that
   only catches Claude's malformed output, which the wrapper catches anyway.
   Per `PRODUCT-ROADMAP.md § 1j` open decision #1.
2. **Reuse the existing toast copy** ("Couldn't add. Check your connection
   and try again."). User-visible difference is zero in practice; Sentry is
   what actually routes the bug. Per open decision #2.
3. **Type derived from schema** via `z.infer<typeof AddItemResponseSchema>`
   in `models/index.ts`. The convention says one source of truth; we choose
   the schema as the source so additions are runtime-validated by default.
4. **`.passthrough()` on every object** so PR 7's forward-compat additions
   (`entries[]`, etc.) flow through without crashing the older client.
5. **Sentry capture lives in apps/web**, not in `@lalista/core`. The core
   stays framework-neutral (no `@sentry/nextjs` dep). The wrapper throws a
   typed `AddItemValidationError`; the call sites in `AddItemSheet` and
   `DisambiguationSheet` catch and call `reportAddItemValidationError`,
   which Sentry-captures with `tags: { boundary: 'add-item', failure:
'zod-validation' }` and `extra: { issues, raw_excerpt }` (truncated to
   500 chars to cap event size).

---

## Tasks

1. Add `zod ^3.23.8` to `packages/core/package.json` and run `pnpm install`.
2. Create `packages/core/src/schemas/addItem.ts` with
   `DisambiguationCandidateSchema` + `AddItemResponseSchema`. Object schemas
   use `.passthrough()`.
3. Create `packages/core/src/errors.ts` exporting
   `AddItemValidationError extends Error` with `issues: ZodIssue[]` and
   `raw: unknown` properties.
4. Update `packages/core/src/api/addItem.ts`: change `client.functions.invoke<unknown>`,
   `.safeParse()` the result, throw `AddItemValidationError` on failure.
5. Update `packages/core/src/models/index.ts` to derive `AddItemResponse` and
   `DisambiguationCandidate` from `z.infer<typeof ...Schema>`.
6. Update `packages/core/src/index.ts` to export
   `AddItemResponseSchema`, `DisambiguationCandidateSchema`, and
   `AddItemValidationError`.
7. Add 3 new tests to `packages/core/src/api/addItem.test.ts`: missing field
   throws `AddItemValidationError`; wrong type surfaces readable issue path;
   unknown field passes through.
8. Create `apps/web/lib/reportAddItemValidationError.ts` — Sentry-capture
   helper with truncated raw payload.
9. Update `apps/web/components/AddItemSheet.tsx` and
   `DisambiguationSheet.tsx`: catch `AddItemValidationError` → call helper,
   then show existing toast.

---

## Out of scope

- Schemas for other API wrappers (PostgREST, RPCs) — generated types + CI
  drift check cover them.
- Schemas for form inputs — HTML5 + Supabase SDK cover them.
- Server-side parse in `supabase/functions/add-item/index.ts` — open decision
  #1 above.
- Compound-add response shape (`entries[]`) — that's PR 7's scope; this
  schema's `.passthrough()` ensures PR 7's additions don't crash this client
  if PR 7 ships first or out of order.
