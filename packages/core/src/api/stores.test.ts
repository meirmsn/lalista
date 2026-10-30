// What: Unit tests for store directory + per-household My Stores wrappers.
// Why: Confirm table/RPC names, arg shapes, return shapes, and StoreRpcError
//      mapping on P0001 failures. Mirrors the inviteErrors integration through
//      the wrappers (invitations.test.ts).
// Does NOT: Assert RLS or trigger semantics — covered in
//           `packages/core/src/migrations/016_household_stores.integration.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import {
  fetchStores,
  fetchMyStores,
  fetchStoreCatalogSuggestions,
  addHouseholdStore,
  removeHouseholdStore,
} from './stores';
import { StoreRpcError } from './storeErrors';

/**
 * Build a `.from('stores').select(...).order(...)` chain mock.
 */
function chainFrom(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue(result);
  return chain;
}

describe('fetchStores', () => {
  it('returns stores ordered by name', async () => {
    const stores = [
      {
        id: 's1',
        name: 'Aldi',
        online_cart_supported: false,
        created_at: '2026-04-17T10:00:00Z',
        is_global: true,
        created_by_household_id: null,
      },
    ];
    const chain = chainFrom({ data: stores, error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };

    const result = await fetchStores(client as never);

    expect(client.from).toHaveBeenCalledWith('stores');
    expect(chain.order).toHaveBeenCalledWith('name');
    expect(result).toEqual(stores);
  });

  it('returns empty array when no stores', async () => {
    const chain = chainFrom({ data: null, error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };

    const result = await fetchStores(client as never);
    expect(result).toEqual([]);
  });

  it('throws when the query errors', async () => {
    const chain = chainFrom({
      data: null,
      error: { message: 'network' },
    });
    const client = { from: vi.fn().mockReturnValue(chain) };

    await expect(fetchStores(client as never)).rejects.toMatchObject({
      message: 'network',
    });
  });
});

describe('fetchMyStores', () => {
  it('selects through household_stores join and flattens + sorts by name', async () => {
    const data = [
      {
        stores: {
          id: 's-b',
          name: 'Walmart',
          online_cart_supported: true,
          created_at: '2026-05-01T00:00:00Z',
          is_global: true,
          created_by_household_id: null,
        },
      },
      {
        stores: {
          id: 's-a',
          name: 'Costco',
          online_cart_supported: true,
          created_at: '2026-05-01T00:00:00Z',
          is_global: true,
          created_by_household_id: null,
        },
      },
    ];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockResolvedValue({ data, error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };

    const result = await fetchMyStores(client as never);
    expect(client.from).toHaveBeenCalledWith('household_stores');
    expect(chain.select).toHaveBeenCalledWith('stores(*)');
    expect(result.map((s) => s.name)).toEqual(['Costco', 'Walmart']);
  });

  it('drops null joins defensively', async () => {
    const data = [
      {
        stores: {
          id: 's-a',
          name: 'Aldi',
          online_cart_supported: false,
          created_at: '2026-05-01T00:00:00Z',
          is_global: true,
          created_by_household_id: null,
        },
      },
      { stores: null },
    ];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockResolvedValue({ data, error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };

    const result = await fetchMyStores(client as never);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Aldi');
  });

  it('throws when the query errors', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    const client = { from: vi.fn().mockReturnValue(chain) };
    await expect(fetchMyStores(client as never)).rejects.toMatchObject({
      message: 'rls denied',
    });
  });
});

describe('fetchStoreCatalogSuggestions', () => {
  /**
   * Build a stores ILIKE chain mock. Threshold no longer fetched client-side
   * (it lives in `store_name_match_threshold` config and is enforced
   * server-side inside `add_household_store`).
   */
  function suggestionsClient(suggestionsResult: {
    data: unknown;
    error: unknown;
  }) {
    const storeChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(suggestionsResult),
    };
    const client = { from: vi.fn().mockReturnValue(storeChain) };
    return { client, storeChain };
  }

  it('returns empty for blank query without hitting the DB', async () => {
    const { client } = suggestionsClient({ data: [], error: null });
    const result = await fetchStoreCatalogSuggestions(client as never, '   ');
    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('queries stores by ILIKE on the trimmed query and returns up to 5', async () => {
    const rows = [
      {
        id: 's1',
        name: 'Trader Joe’s',
        online_cart_supported: false,
        created_at: '2026-05-01T00:00:00Z',
        is_global: true,
        created_by_household_id: null,
      },
    ];
    const { client, storeChain } = suggestionsClient({
      data: rows,
      error: null,
    });
    const result = await fetchStoreCatalogSuggestions(client as never, ' joe ');
    expect(client.from).toHaveBeenCalledWith('stores');
    expect(storeChain.ilike).toHaveBeenCalledWith('name', '%joe%');
    expect(storeChain.limit).toHaveBeenCalledWith(20);
    expect(result).toEqual(rows);
  });

  it('throws when the stores query errors', async () => {
    const { client } = suggestionsClient({
      data: null,
      error: { message: 'kaboom' },
    });
    await expect(
      fetchStoreCatalogSuggestions(client as never, 'aldi')
    ).rejects.toMatchObject({ message: 'kaboom' });
  });
});

describe('addHouseholdStore', () => {
  it('calls add_household_store RPC with both args set and unmarshals row', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ store_id: 's1', was_created: true }],
        error: null,
      }),
    };
    const result = await addHouseholdStore(client as never, {
      name: 'Sprouts',
    });
    expect(client.rpc).toHaveBeenCalledWith('add_household_store', {
      p_store_id: undefined,
      p_name: 'Sprouts',
    });
    expect(result).toEqual({ storeId: 's1', wasCreated: true });
  });

  it('calls add_household_store with storeId set when only storeId given', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ store_id: 's2', was_created: false }],
        error: null,
      }),
    };
    const result = await addHouseholdStore(client as never, {
      storeId: 's2',
    });
    expect(client.rpc).toHaveBeenCalledWith('add_household_store', {
      p_store_id: 's2',
      p_name: undefined,
    });
    expect(result).toEqual({ storeId: 's2', wasCreated: false });
  });

  it('throws StoreRpcError with kind=name_invalid on P0001 name must be 1-60', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'name must be 1-60 chars' },
      }),
    };
    await expect(
      addHouseholdStore(client as never, { name: 'x'.repeat(61) })
    ).rejects.toBeInstanceOf(StoreRpcError);
    try {
      await addHouseholdStore(client as never, { name: 'x'.repeat(61) });
    } catch (e) {
      expect((e as StoreRpcError).kind).toBe('name_invalid');
    }
  });

  it('throws StoreRpcError with kind=not_member when caller has no household', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'not a household member' },
      }),
    };
    try {
      await addHouseholdStore(client as never, { name: 'Sprouts' });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as StoreRpcError).kind).toBe('not_member');
    }
  });

  it('throws StoreRpcError with kind=unknown_store when both args null', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'must provide store_id or name' },
      }),
    };
    try {
      await addHouseholdStore(client as never, {});
      throw new Error('expected throw');
    } catch (e) {
      expect((e as StoreRpcError).kind).toBe('unknown_store');
    }
  });
});

describe('removeHouseholdStore', () => {
  it('calls remove_household_store RPC with p_store_id', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    await removeHouseholdStore(client as never, 's1');
    expect(client.rpc).toHaveBeenCalledWith('remove_household_store', {
      p_store_id: 's1',
    });
  });

  it('throws StoreRpcError on RPC failure', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'not a household member' },
      }),
    };
    try {
      await removeHouseholdStore(client as never, 's1');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoreRpcError);
      expect((e as StoreRpcError).kind).toBe('not_member');
    }
  });
});
