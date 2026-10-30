// What: Unit tests for the StoreError mapping shared across my-stores wrappers.
// Why: Every wrapper forwards to this single function so behavior stays
//      consistent across the feature. Mirror of inviteErrors.test.ts shape.
// Does NOT: Hit a database — the input is a synthetic `{code, message}` shape
//           that mirrors what `PostgrestError` ships.

import { describe, expect, it } from 'vitest';
import {
  StoreRpcError,
  mapStoreError,
  throwMappedStoreError,
} from './storeErrors';

describe('mapStoreError', () => {
  it('maps P0001 not a household member → not_member', () => {
    expect(
      mapStoreError({ code: 'P0001', message: 'not a household member' })
    ).toBe('not_member');
  });

  it('maps P0001 must provide store_id or name → unknown_store', () => {
    expect(
      mapStoreError({ code: 'P0001', message: 'must provide store_id or name' })
    ).toBe('unknown_store');
  });

  it('maps P0001 name must be 1-60 chars → name_invalid', () => {
    expect(
      mapStoreError({ code: 'P0001', message: 'name must be 1-60 chars' })
    ).toBe('name_invalid');
  });

  it('maps P0001 store not visible → not_visible (Model B cross-household guard)', () => {
    expect(mapStoreError({ code: 'P0001', message: 'store not visible' })).toBe(
      'not_visible'
    );
  });

  it('returns unknown for non-P0001 codes (e.g. 42501 auth)', () => {
    expect(mapStoreError({ code: '42501', message: 'auth required' })).toBe(
      'unknown'
    );
  });

  it('returns unknown for null / undefined input', () => {
    expect(mapStoreError(null)).toBe('unknown');
    expect(mapStoreError(undefined)).toBe('unknown');
  });

  it('returns unknown for P0001 with unfamiliar message', () => {
    expect(
      mapStoreError({ code: 'P0001', message: 'something else entirely' })
    ).toBe('unknown');
  });

  it('is case-insensitive on the message substring match', () => {
    expect(
      mapStoreError({ code: 'P0001', message: 'NOT a household MEMBER' })
    ).toBe('not_member');
  });
});

describe('throwMappedStoreError', () => {
  it('throws StoreRpcError with the mapped kind for a known P0001', () => {
    expect(() =>
      throwMappedStoreError({
        code: 'P0001',
        message: 'not a household member',
      })
    ).toThrow(StoreRpcError);
    try {
      throwMappedStoreError({
        code: 'P0001',
        message: 'not a household member',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(StoreRpcError);
      expect((e as StoreRpcError).kind).toBe('not_member');
      expect((e as StoreRpcError).cause).toMatchObject({
        code: 'P0001',
        message: 'not a household member',
      });
    }
  });

  it('throws StoreRpcError with kind=unknown for an unknown error', () => {
    expect(() =>
      throwMappedStoreError({ code: '42501', message: 'auth required' })
    ).toThrow(StoreRpcError);
    try {
      throwMappedStoreError({ code: '42501', message: 'auth required' });
    } catch (e) {
      expect((e as StoreRpcError).kind).toBe('unknown');
    }
  });
});
