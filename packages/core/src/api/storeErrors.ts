// What: Typed-error mapping shared by every my-stores wrapper (stores.ts).
// Why: Migration 016's RPCs (`add_household_store`, `remove_household_store`)
//      raise Postgres `P0001` for the three domain errors they care about:
//      `'not a household member'`, `'must provide store_id or name'`,
//      `'name must be 1-60 chars'`. UI surfaces need a typed union so error
//      rendering is exhaustive at the type level. Mirror of `inviteErrors.ts`.
// Does NOT: Map non-D11 Supabase errors (network, RLS, etc.) — those
//           propagate verbatim as `PostgrestError`.

/**
 * Typed error union for the my-stores feature. Wrappers throw `StoreRpcError`
 * (with `kind` set to one of these values) when the RPC returns a known
 * errcode/message we want UI to branch on. Anything else propagates as the
 * SDK's raw `PostgrestError`.
 *
 * Note: there is no `'duplicate'` member — `add_household_store` uses
 * `on conflict do nothing` so duplicate-add is silently idempotent.
 */
export type StoreError =
  | 'not_member' // P0001 'not a household member'
  | 'unknown_store' // P0001 'must provide store_id or name'
  | 'name_invalid' // P0001 'name must be 1-60 chars'
  | 'not_visible' // P0001 'store not visible' (Model B cross-household guard)
  | 'unknown'; // catch-all (postgrest-error-shape passthrough)

/**
 * Wrapper-level error thrown when a my-stores RPC returns a known P0001
 * message. `kind` is a typed `StoreError` union member; UI maps it to copy.
 */
export class StoreRpcError extends Error {
  readonly kind: StoreError;
  /** Underlying PostgrestError-shaped object (whatever shape the SDK returned). */
  readonly cause: { code?: string; message?: string } | undefined;

  constructor(kind: StoreError, cause?: { code?: string; message?: string }) {
    super(`store RPC failed: ${kind}`);
    this.name = 'StoreRpcError';
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * Map a Postgres-shaped error to a typed `StoreError` kind. Returns `'unknown'`
 * when the error doesn't match a known kind — callers wrap in `StoreRpcError`
 * either way so the typed-error story stays consistent across the feature.
 *
 * Mapping rules per spec § API contracts:
 * - `P0001` with substring `'not a household member'` → `'not_member'`.
 * - `P0001` with substring `'must provide store_id or name'` → `'unknown_store'`.
 * - `P0001` with substring `'name must be 1-60'` → `'name_invalid'`.
 * - `P0001` with substring `'store not visible'` → `'not_visible'`.
 * - Anything else → `'unknown'` (catch-all; callers may still inspect `.cause`).
 */
export function mapStoreError(
  err: { code?: string; message?: string } | null | undefined
): StoreError {
  if (!err) return 'unknown';
  const code = err.code ?? '';
  const message = (err.message ?? '').toLowerCase();
  if (code !== 'P0001') return 'unknown';
  if (message.includes('not a household member')) return 'not_member';
  if (message.includes('must provide store_id or name')) return 'unknown_store';
  if (message.includes('name must be 1-60')) return 'name_invalid';
  if (message.includes('store not visible')) return 'not_visible';
  return 'unknown';
}

/**
 * Convenience: always throw a `StoreRpcError`. Mapping always produces a kind
 * (catch-all `'unknown'`), so callers don't need to re-throw the raw error
 * separately the way `throwMappedInviteError` does — every my-stores RPC
 * failure is a `StoreRpcError`.
 */
export function throwMappedStoreError(err: {
  code?: string;
  message?: string;
}): never {
  throw new StoreRpcError(mapStoreError(err), err);
}
