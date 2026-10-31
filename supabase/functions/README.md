# supabase/functions

> Edge functions for lalista. Up to [OVERVIEW.md](../../OVERVIEW.md) for the product context, [ARCHITECTURE.md](../../ARCHITECTURE.md) for where this fits in the system.

## What's here

One function today: `add-item`. The single orchestration call that takes a free-text utterance + household ID and returns either a row to optimistically insert or a disambiguation question for the client. Hides Claude API + pg_trgm matching + history-based store routing + brand-preference lookup behind a single endpoint.

Functions auto-deploy to Supabase via `.github/workflows/deploy-functions.yml` on push:main when `supabase/functions/**` changes. The web app deploys to Cloudflare Workers separately (CI's `deploy` job); **the two are not deployed atomically** — see `CLAUDE.md § Edge function changes need explicit deploy step` for the test-plan obligation.

## Function list

| Function   | Method | Auth | Purpose                                                                                                                                         |
| ---------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `add-item` | POST   | JWT  | Parse utterance → match → route → either insert + return entry, or return disambiguation question. Logs every decision to `disambiguation_log`. |

## Function: `add-item`

### Request

```ts
{
  utterance: string;                  // free-text, English / Spanish / spanglish
  household_id: string;               // RLS scope
  candidate_item_id?: string;         // disambig follow-up: user picked a candidate
  confirmed_store_id?: string;        // disambig follow-up: user confirmed store
  confirmed_brand?: string;           // disambig follow-up: user confirmed brand
  force_create_with_label?: boolean;  // user picked "Add as new" — bypass NLP + trigram, insert items(name_canonical = utterance) verbatim
}
```

### Response

```ts
{
  entry_id?: string;                              // present when insert happened (silent path)
  canonical_item: { id; name } | null;            // matched item
  store: { id; name } | null;                     // routed store
  brand: string | null;                           // resolved brand hint
  needs_followup: boolean;                        // true → client opens DisambiguationSheet
  followup_type?: 'store' | 'item' | 'brand' | 'quantity';
  followup_question?: string;
  followup_options?: Array<{ id; label }>;
  already_on_list?: boolean;                      // dedup: same item+store already pending
  store_confidence?: number;                      // 0–1; only on history-routed paths
  error?: string;
  // Future: entries[] for compound utterances ("milk and eggs") — PR 7
  // ...passthrough fields tolerated by client (Zod .passthrough() in the wrapper schema)
}
```

The shape is validated client-side at the wrapper boundary by `AddItemResponseSchema` (`packages/core/src/schemas/addItem.ts`). Schema drift (missing field, wrong type) throws a typed `AddItemValidationError` and gets reported to Sentry with a 500-char `raw_excerpt`.

### Auth

The function validates the caller's JWT before any write. The legacy `--no-verify-jwt` deploy flag (`TODOS.md` carries the cleanup) means token verification is in function code, not the gateway. Without a valid JWT → returns 401.

The **force-create branch** (PR 5) inserts `items(name_canonical = utterance)` directly. It uses the `items_insert` RLS policy (migration 011) so the user's own JWT is sufficient — no service-role escalation. This is the "principle of least privilege" pattern documented in `CLAUDE.md § Principle of least privilege for RLS-bypass writes`.

### External services

- **Anthropic Claude API** — NLP normalization. Reads `Deno.env.get('ANTHROPIC_API_KEY')` at runtime. The QA/PROD split is handled at the surrounding surfaces (CI re-export, GH `production` environment secret `ANTHROPIC_API_KEY_PROD` pushed by `deploy-functions.yml`); function code never sees the prefix. See `CLAUDE.md § Anthropic API key split` for the operator setup checklist.
- **Postgres** (via REST) — pg_trgm match against `items.name_canonical`, history query against `purchase_history`, `disambiguation_log` write.

## Conventions

- **One file per function** under `supabase/functions/<name>/index.ts` (Deno entrypoint).
- **Validate JWT before writing**: every function reads the caller's JWT and rejects unauthenticated requests. The auth model is in function code, not gateway-level.
- **Prefer narrowest privilege escalation**: when a write needs RLS bypass, prefer (1) a table-level RLS policy (e.g. `items_insert`), then (2) `SECURITY DEFINER` RPC with explicit auth check, then (3) service-role admin client. Last resort. See `CLAUDE.md § Principle of least privilege`.
- **Validate response shape at the client**: every edge-function response should be a Zod-validated schema in `packages/core/src/schemas/`. Use `.passthrough()` on objects so forward-compatible additions (new fields) flow through old clients without breaking. See `addItem.ts` schema as the canonical example.
- **Log every decision to `disambiguation_log`**: confidence scores, candidates considered, decision type. Powers post-launch threshold tuning via `config` table.
- **Test plan must cover the deploy step**: when a PR touches `supabase/functions/**`, the test plan MUST include either (a) a slow-job CI E2E that exercises the new path against deployed function code, OR (b) an explicit `supabase functions deploy <name>` step. Without this, the new front-end ships to prod calling the unchanged back-end. See `CLAUDE.md § Edge function changes need explicit deploy step`.
- **Local dev**: `supabase functions serve add-item` reads from gitignored `supabase/functions/.env` (which bridges `ANTHROPIC_API_KEY_QA` → `ANTHROPIC_API_KEY` for the function process). See operator checklist in `CLAUDE.md § Anthropic API key split`.

## See also

- [OVERVIEW.md](../../OVERVIEW.md) — product context (the "add item" flow this function powers)
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — system view (where this function sits in the data flow)
- [`packages/core/README.md`](../../packages/core/README.md) — `invokeAddItem` wrapper that calls this function
- `CLAUDE.md § Where Things Happen` — path index
- `CLAUDE.md § Gotchas` — load-bearing rules around edge-function deploys + auth + Anthropic key handling
- [`supabase/migrations/`](../migrations/) — the schema this function reads/writes
