// What: Unit tests for the InviteError mapping shared across feature wrappers.
// Why: T12 (spec § Tests) — the 6 typed InviteError values plus the 23505
//      unique-constraint case must each map to the right kind. Wrappers
//      forward to this single function so behavior stays consistent.
// Does NOT: Hit a database — the input is a synthetic `{code, message}` shape
//           that mirrors what `PostgrestError` ships.

import { describe, expect, it } from 'vitest';
import {
  InviteRpcError,
  mapInviteError,
  throwMappedInviteError,
} from './inviteErrors';

describe('mapInviteError', () => {
  it('maps 23505 with household_members_one_per_user_v0 to already_in_household', () => {
    expect(
      mapInviteError({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "household_members_one_per_user_v0"',
      })
    ).toBe('already_in_household');
  });

  it('maps P0001 already in a household to already_in_household', () => {
    expect(
      mapInviteError({ code: 'P0001', message: 'already in a household' })
    ).toBe('already_in_household');
  });

  it('maps P0001 invite invalid or expired to expired_or_invalid', () => {
    expect(
      mapInviteError({ code: 'P0001', message: 'invite invalid or expired' })
    ).toBe('expired_or_invalid');
  });

  it('maps P0001 cannot orphan household to cannot_orphan', () => {
    expect(
      mapInviteError({ code: 'P0001', message: 'cannot orphan household' })
    ).toBe('cannot_orphan');
  });

  it('maps P0001 owner cannot leave to owner_cannot_leave', () => {
    expect(
      mapInviteError({
        code: 'P0001',
        message: 'owner cannot leave (transfer ownership first — v1 feature)',
      })
    ).toBe('owner_cannot_leave');
  });

  it('maps P0001 name must be 1-60 chars to name_invalid', () => {
    expect(
      mapInviteError({ code: 'P0001', message: 'name must be 1-60 chars' })
    ).toBe('name_invalid');
  });

  it('maps P0001 invite not found or already used to not_found_or_used', () => {
    expect(
      mapInviteError({
        code: 'P0001',
        message: 'invite not found or already used',
      })
    ).toBe('not_found_or_used');
  });

  it('maps P0001 member not found to not_found_or_used (remove_member)', () => {
    expect(mapInviteError({ code: 'P0001', message: 'member not found' })).toBe(
      'not_found_or_used'
    );
  });

  it('returns null for non-matching codes (e.g. 42501 auth)', () => {
    expect(
      mapInviteError({ code: '42501', message: 'auth required' })
    ).toBeNull();
  });

  it('returns null for null / undefined input', () => {
    expect(mapInviteError(null)).toBeNull();
    expect(mapInviteError(undefined)).toBeNull();
  });

  it('returns null for 23505 with a different constraint name (no false-positives)', () => {
    expect(
      mapInviteError({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "stores_name_key"',
      })
    ).toBeNull();
  });
});

describe('throwMappedInviteError', () => {
  it('throws InviteRpcError when the error maps to a known kind', () => {
    expect(() =>
      throwMappedInviteError({
        code: 'P0001',
        message: 'already in a household',
      })
    ).toThrow(InviteRpcError);
    try {
      throwMappedInviteError({
        code: 'P0001',
        message: 'already in a household',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(InviteRpcError);
      expect((e as InviteRpcError).kind).toBe('already_in_household');
    }
  });

  it('re-throws the original error when no mapping exists', () => {
    const raw = { code: '42501', message: 'auth required' };
    expect(() => throwMappedInviteError(raw)).toThrow();
    try {
      throwMappedInviteError(raw);
    } catch (e) {
      expect(e).toBe(raw); // identity — verbatim re-throw
    }
  });
});
