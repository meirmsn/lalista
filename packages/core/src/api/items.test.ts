// What: Unit tests for list-entry API wrappers
// Why: Verify RPC usage, join shape, and error propagation without hitting a real DB
// Does NOT: Assert DB schema — that's integration tests in PR 4

import { describe, it, expect, vi } from 'vitest';
import {
  fetchListEntries,
  fetchListEntryById,
  markItemBought,
  deleteListEntry,
  RemovedFromHouseholdError,
} from './items';

/**
 *
 */
function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    household_id: 'house-1',
    item_id: 'item-1',
    store_id: 'store-1',
    brand: null,
    quantity: 1,
    unit: null,
    status: 'pending',
    added_at: '2026-04-17T10:00:00Z',
    added_by: 'user-1',
    items: { name_canonical: 'leche' },
    stores: { name: 'Whole Foods' },
    ...overrides,
  };
}

/**
 * Chain that terminates in `.order(...)` — used by `fetchListEntries` for
 * the list_entries select.
 */
function listEntriesChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue(result);
  return chain;
}

/**
 * Chain that terminates in `.maybeSingle()` — used by `fetchListEntryById`.
 */
function listEntryByIdChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  return chain;
}

/**
 * Chain for `profiles.select('user_id, display_name').in('user_id', [...])`
 * — used by `fetchDisplayNamesByUserId` for both fetchers. Default returns an
 * empty array so `addedByName` lands as null unless the test overrides it.
 */
function profilesInChain(
  result: { data: unknown; error: unknown } = { data: [], error: null }
) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue(result);
  return chain;
}

/**
 * Build a client whose `from(table)` returns different chains per table. The
 * `list_entries` chain handles the primary fetch; the `profiles` chain
 * hydrates display names on the second pass.
 */
function buildClient(
  listEntries: Record<string, unknown>,
  profiles: Record<string, unknown> = profilesInChain(),
  rpcReturn: { data: unknown; error: unknown } = {
    data: 'house-1',
    error: null,
  }
) {
  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'list_entries') return listEntries;
    if (table === 'profiles') return profiles;
    throw new Error(`unexpected from(${table}) in test`);
  });
  // Default: current_household_id() RPC returns the test household — for the
  // RemovedFromHouseholdError path callers override with `{ data: null }`.
  const rpcMock = vi.fn().mockResolvedValue(rpcReturn);
  return { from: fromMock, rpc: rpcMock };
}

describe('fetchListEntries', () => {
  it('returns hydrated entries with joined item, store, and display name', async () => {
    const listEntries = listEntriesChain({
      data: [rowFixture()],
      error: null,
    });
    const profiles = profilesInChain({
      data: [{ user_id: 'user-1', display_name: 'Meir' }],
      error: null,
    });
    const client = buildClient(listEntries, profiles);

    const result = await fetchListEntries(client as never, 'house-1');

    expect(client.from).toHaveBeenCalledWith('list_entries');
    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(client.rpc).toHaveBeenCalledWith('current_household_id');
    expect(listEntries.eq).toHaveBeenCalledWith('household_id', 'house-1');
    expect(listEntries.eq).toHaveBeenCalledWith('status', 'pending');
    expect(profiles.in).toHaveBeenCalledWith('user_id', ['user-1']);
    expect(result.currentHouseholdId).toBe('house-1');
    expect(result.entries).toEqual([
      {
        id: 'entry-1',
        householdId: 'house-1',
        itemId: 'item-1',
        itemName: 'leche',
        storeId: 'store-1',
        storeName: 'Whole Foods',
        brand: null,
        quantity: 1,
        unit: null,
        status: 'pending',
        addedAt: '2026-04-17T10:00:00Z',
        addedBy: 'user-1',
        addedByName: 'Meir',
      },
    ]);
  });

  it('falls back to addedByName: null when no profile row is readable', async () => {
    // Household-member RLS (migration 012) will return no row for authors who
    // don't share a household. UI renders "added by someone" in this case.
    const listEntries = listEntriesChain({
      data: [rowFixture()],
      error: null,
    });
    // Profiles table returns empty — simulates RLS-filtered result
    const client = buildClient(listEntries, profilesInChain());

    const result = await fetchListEntries(client as never, 'house-1');
    expect(result.entries[0]?.addedByName).toBeNull();
  });

  // Migration 009 made added_by nullable (ON DELETE SET NULL). UI renders
  // "added by someone" when the original adder's auth.users row is gone.
  it('propagates null added_by and addedByName when the authoring user is gone', async () => {
    const listEntries = listEntriesChain({
      data: [rowFixture({ added_by: null })],
      error: null,
    });
    const profiles = profilesInChain();
    const client = buildClient(listEntries, profiles);

    const result = await fetchListEntries(client as never, 'house-1');
    expect(result.entries[0]?.addedBy).toBeNull();
    expect(result.entries[0]?.addedByName).toBeNull();
    // Optimization: no ids to look up, so the profiles chain isn't hit.
    expect(profiles.in).not.toHaveBeenCalled();
  });

  it('filters by status when passed explicitly', async () => {
    const listEntries = listEntriesChain({ data: [], error: null });
    const client = buildClient(listEntries);

    await fetchListEntries(client as never, 'house-1', 'bought');

    expect(listEntries.eq).toHaveBeenCalledWith('status', 'bought');
  });

  it('returns empty entries array when no rows exist', async () => {
    const listEntries = listEntriesChain({ data: null, error: null });
    const client = buildClient(listEntries);

    const result = await fetchListEntries(client as never, 'house-1');

    expect(result.entries).toEqual([]);
    expect(result.currentHouseholdId).toBe('house-1');
  });

  it('throws the Supabase error verbatim', async () => {
    const listEntries = listEntriesChain({
      data: null,
      error: { message: 'RLS denied', code: '42501' },
    });
    const client = buildClient(listEntries);

    await expect(
      fetchListEntries(client as never, 'house-1')
    ).rejects.toMatchObject({ message: 'RLS denied' });
  });

  it('throws when the profiles hydration query errors', async () => {
    const listEntries = listEntriesChain({
      data: [rowFixture()],
      error: null,
    });
    const profiles = profilesInChain({
      data: null,
      // Non-PGRST205 error (e.g. RLS denial) still propagates — not swallowed.
      error: { message: 'profiles RLS denied', code: '42501' },
    });
    const client = buildClient(listEntries, profiles);

    await expect(
      fetchListEntries(client as never, 'house-1')
    ).rejects.toMatchObject({ message: 'profiles RLS denied' });
  });

  // PGRST205 = relation does not exist. This happens when migration 012 hasn't
  // yet been applied to the current environment (e.g. the rollout window
  // between front-end deploy and `supabase db push`). Treat as empty
  // hydration rather than failing the entire list view.
  it('degrades to null addedByName (not throw) when the profiles table is missing', async () => {
    const listEntries = listEntriesChain({
      data: [rowFixture()],
      error: null,
    });
    const profiles = profilesInChain({
      data: null,
      error: {
        message: 'relation "public.profiles" does not exist',
        code: 'PGRST205',
      },
    });
    const client = buildClient(listEntries, profiles);

    const result = await fetchListEntries(client as never, 'house-1');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.addedBy).toBe('user-1');
    expect(result.entries[0]?.addedByName).toBeNull();
  });

  it('dedupes repeat authors into a single profiles.in() lookup', async () => {
    const listEntries = listEntriesChain({
      data: [
        rowFixture({ id: 'e1', added_by: 'user-1' }),
        rowFixture({ id: 'e2', added_by: 'user-1' }),
        rowFixture({ id: 'e3', added_by: 'user-2' }),
      ],
      error: null,
    });
    const profiles = profilesInChain({
      data: [
        { user_id: 'user-1', display_name: 'Meir' },
        { user_id: 'user-2', display_name: 'Dad' },
      ],
      error: null,
    });
    const client = buildClient(listEntries, profiles);

    await fetchListEntries(client as never, 'house-1');

    // .in() receives deduped ids — caller performance matters here.
    expect(profiles.in).toHaveBeenCalledTimes(1);
    const call = (profiles.in as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe('user_id');
    expect(new Set(call?.[1])).toEqual(new Set(['user-1', 'user-2']));
  });

  // T9 CRITICAL — fetchListEntries threads currentHouseholdId; throws
  // RemovedFromHouseholdError when the helper returns null.
  it('throws RemovedFromHouseholdError when current_household_id() returns null', async () => {
    const listEntries = listEntriesChain({ data: [], error: null });
    const client = buildClient(listEntries, profilesInChain(), {
      data: null,
      error: null,
    });

    await expect(
      fetchListEntries(client as never, 'house-1')
    ).rejects.toBeInstanceOf(RemovedFromHouseholdError);
    // Importantly, the list_entries query is NOT issued — we bail before it
    // so realtime-leaked rows can't be exposed to the removed user.
    expect(client.from).not.toHaveBeenCalled();
  });

  it('propagates current_household_id() RPC errors verbatim', async () => {
    const listEntries = listEntriesChain({ data: [], error: null });
    const client = buildClient(listEntries, profilesInChain(), {
      data: null,
      error: { message: 'rpc broken', code: '42501' },
    });

    await expect(
      fetchListEntries(client as never, 'house-1')
    ).rejects.toMatchObject({ message: 'rpc broken' });
  });
});

describe('fetchListEntryById', () => {
  it('returns a hydrated entry with the resolved display name', async () => {
    const listEntries = listEntryByIdChain({
      data: rowFixture(),
      error: null,
    });
    const profiles = profilesInChain({
      data: [{ user_id: 'user-1', display_name: 'Meir' }],
      error: null,
    });
    const client = buildClient(listEntries, profiles);

    const entry = await fetchListEntryById(client as never, 'entry-1');

    expect(client.from).toHaveBeenCalledWith('list_entries');
    expect(listEntries.eq).toHaveBeenCalledWith('id', 'entry-1');
    expect(entry).toEqual({
      id: 'entry-1',
      householdId: 'house-1',
      itemId: 'item-1',
      itemName: 'leche',
      storeId: 'store-1',
      storeName: 'Whole Foods',
      brand: null,
      quantity: 1,
      unit: null,
      status: 'pending',
      addedAt: '2026-04-17T10:00:00Z',
      addedBy: 'user-1',
      addedByName: 'Meir',
    });
  });

  // Uses maybeSingle — PGRST116 no-rows is surfaced as data=null, not an error.
  it('returns null when the entry does not exist', async () => {
    const listEntries = listEntryByIdChain({ data: null, error: null });
    const client = buildClient(listEntries);

    const entry = await fetchListEntryById(client as never, 'missing');
    expect(entry).toBeNull();
  });

  it('throws when the Supabase query errors', async () => {
    const listEntries = listEntryByIdChain({
      data: null,
      error: { message: 'RLS denied' },
    });
    const client = buildClient(listEntries);

    await expect(
      fetchListEntryById(client as never, 'entry-1')
    ).rejects.toMatchObject({ message: 'RLS denied' });
  });

  it('skips the profiles lookup when added_by is null', async () => {
    const listEntries = listEntryByIdChain({
      data: rowFixture({ added_by: null }),
      error: null,
    });
    const profiles = profilesInChain();
    const client = buildClient(listEntries, profiles);

    const entry = await fetchListEntryById(client as never, 'entry-1');
    expect(entry?.addedBy).toBeNull();
    expect(entry?.addedByName).toBeNull();
    expect(profiles.in).not.toHaveBeenCalled();
  });

  it('falls back to addedByName: null when the author profile is not readable', async () => {
    const listEntries = listEntryByIdChain({
      data: rowFixture(),
      error: null,
    });
    // Profiles returns empty — non-household author is RLS-filtered out.
    const client = buildClient(listEntries, profilesInChain());

    const entry = await fetchListEntryById(client as never, 'entry-1');
    expect(entry?.addedBy).toBe('user-1');
    expect(entry?.addedByName).toBeNull();
  });
});

describe('markItemBought', () => {
  it('calls the mark_item_bought RPC with the entry id', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    await markItemBought(client as never, 'entry-1');

    expect(client.rpc).toHaveBeenCalledWith('mark_item_bought', {
      p_entry_id: 'entry-1',
    });
  });

  it('throws when the RPC errors', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'entry not found' },
      }),
    };

    await expect(
      markItemBought(client as never, 'missing')
    ).rejects.toMatchObject({ message: 'entry not found' });
  });
});

/**
 *
 */
function deleteChainFrom(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockResolvedValue(result);
  return chain;
}

describe('deleteListEntry', () => {
  it('deletes the entry by id', async () => {
    const chain = deleteChainFrom({ data: null, error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };

    await deleteListEntry(client as never, 'entry-1');

    expect(client.from).toHaveBeenCalledWith('list_entries');
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('id', 'entry-1');
  });

  it('throws when the delete fails', async () => {
    const chain = deleteChainFrom({
      data: null,
      error: { message: 'forbidden' },
    });
    const client = { from: vi.fn().mockReturnValue(chain) };

    await expect(
      deleteListEntry(client as never, 'entry-1')
    ).rejects.toMatchObject({ message: 'forbidden' });
  });
});
