// What: Typed-error mapping shared by every household-collaborators wrapper
//       (invitations.ts, members.ts, audit.ts, plus the renameHousehold +
//       leaveHousehold extensions in households.ts).
// Why: Migration 015's RPCs use Postgres errcodes — `42501` for auth/access
//      and `P0001` for domain errors (D8). The single-household v0 unique
//      constraint surfaces as `23505` (D7). UI surfaces need a typed union
//      so error rendering is exhaustive at the type level.
// Does NOT: Map non-D8/D7 Supabase errors (network, RLS, etc.) — those
//           propagate verbatim as `PostgrestError`.

/**
 * Typed error union for the household-collaborators feature. Wrappers throw
 * `InviteRpcError` (with `kind` set to one of these values) when the RPC
 * returns a known errcode/message we want UI to branch on. Anything else
 * propagates as the SDK's raw `PostgrestError`.
 */
export type InviteError =
  | 'expired_or_invalid'
  | 'already_in_household'
  | 'cannot_orphan'
  | 'owner_cannot_leave'
  | 'name_invalid'
  | 'not_found_or_used';

/**
 * Wrapper-level error thrown when a household-collaborators RPC returns a
 * known D8 P0001 / 42501 message OR the D7 23505 unique-constraint violation.
 * `kind` is a typed `InviteError` union member; UI maps it to copy.
 */
export class InviteRpcError extends Error {
  readonly kind: InviteError;
  /** Underlying PostgrestError-shaped object (whatever shape the SDK returned). */
  readonly cause: { code?: string; message?: string } | undefined;

  constructor(kind: InviteError, cause?: { code?: string; message?: string }) {
    super(`invite RPC failed: ${kind}`);
    this.name = 'InviteRpcError';
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * Map a Postgres-shaped error to a typed `InviteError` kind, or return null
 * if the error doesn't match a known kind. Callers throw `InviteRpcError`
 * with the kind, or re-throw the original error when this returns null.
 *
 * Mapping rules per spec § Friendly-error mapping:
 * - `23505` with constraint name match `household_members_one_per_user_v0` →
 *   `'already_in_household'` (D7 — DB-layer race backstop).
 * - `P0001` with substring `'already in a household'` → `'already_in_household'`
 *   (application-layer check in accept_invite).
 * - `P0001` with substring `'invite invalid or expired'` → `'expired_or_invalid'`.
 * - `P0001` with substring `'cannot orphan'` → `'cannot_orphan'`.
 * - `P0001` with substring `'owner cannot leave'` → `'owner_cannot_leave'`.
 * - `P0001` with substring `'name must be 1-60'` → `'name_invalid'`.
 * - `P0001` with substring `'not found'` (covers
 *   `'invite not found or already used'` from revoke_invite, `'member not
 *   found'` from remove_member) → `'not_found_or_used'`.
 * - Anything else: null (caller re-throws).
 */
export function mapInviteError(
  err: { code?: string; message?: string } | null | undefined
): InviteError | null {
  if (!err) return null;
  const code = err.code ?? '';
  const message = (err.message ?? '').toLowerCase();

  if (
    code === '23505' &&
    message.includes('household_members_one_per_user_v0')
  ) {
    return 'already_in_household';
  }
  if (code !== 'P0001') return null;
  if (message.includes('already in a household')) return 'already_in_household';
  if (message.includes('invite invalid or expired'))
    return 'expired_or_invalid';
  if (message.includes('cannot orphan')) return 'cannot_orphan';
  if (message.includes('owner cannot leave')) return 'owner_cannot_leave';
  if (message.includes('name must be 1-60')) return 'name_invalid';
  if (message.includes('not found')) return 'not_found_or_used';
  return null;
}

/**
 * Convenience: throw an InviteRpcError if the error maps to a known kind;
 * otherwise re-throw the original. Wrappers call this in their RPC catch
 * branch to keep the typed-error story consistent across the feature.
 */
export function throwMappedInviteError(err: {
  code?: string;
  message?: string;
}): never {
  const kind = mapInviteError(err);
  if (kind) {
    throw new InviteRpcError(kind, err);
  }
  // Re-throw verbatim — Supabase's PostgrestError already has a usable shape
  // for the upstream observability pipeline.
  throw err;
}
