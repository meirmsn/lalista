// What: Unit tests for household + membership queries
// Why: Onboarding flow depends on correct empty-vs-member detection
// Does NOT: Test RLS — that's integration tests in PR 4

import { describe, it, expect, vi } from 'vitest';
import {
  fetchUserHouseholds,
  fetchUserMemberships,
  createHousehold,
  fetchMyHousehold,
  renameHousehold,
  leaveHousehold,
} from './households';
import { InviteRpcError } from './inviteErrors';

/**
 *
 */
function selectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockResolvedValue(result);
  return chain;
}

describe('fetchUserHouseholds', () => {
  it('returns households joined through household_members', async () => {
    const household = {
      id: 'h1',
      name: 'Casa',
      created_at: '2026-04-17T10:00:00Z',
    };
    const chain = selectChain({
      data: [{ households: household }],
      error: null,
    });
    const client = { from: vi.fn().mockReturnValue(chain) };

    const result = await fetchUserHouseholds(client as never, 'user-1');

    expect(client.from).toHaveBeenCalledWith('household_members');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result).toEqual([household]);
  });

  it('filters out rows with null households', async () => {
    const chain = selectChain({
      data: [{ households: null }],
      error: null,
    });
    const client = { from: vi.fn().mockReturnValue(chain) };

    const result = await fetchUserHouseholds(client as never, 'user-1');
    expect(result).toEqual([]);
  });

  it('returns empty array for a user with no memberships', async () => {
    const chain = selectChain({ data: [], error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };

    expect(await fetchUserHouseholds(client as never, 'user-1')).toEqual([]);
  });

  it('throws when the query errors', async () => {
    const chain = selectChain({
      data: null,
      error: { message: 'denied' },
    });
    const client = { from: vi.fn().mockReturnValue(chain) };

    await expect(
      fetchUserHouseholds(client as never, 'user-1')
    ).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('fetchUserMemberships', () => {
  it('returns the raw membership rows', async () => {
    const row = {
      household_id: 'h1',
      user_id: 'u1',
      role: 'owner',
      joined_at: '2026-04-17T10:00:00Z',
    };
    const chain = selectChain({ data: [row], error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };

    const result = await fetchUserMemberships(client as never, 'u1');
    expect(result).toEqual([row]);
  });
});

describe('createHousehold', () => {
  /** Build a mock of `.from('households').select('*').eq('id', ...).single()` */
  function householdSelectChain(result: {
    data: unknown;
    error: unknown;
  }): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(result);
    return chain;
  }

  it('calls the create_household_with_owner RPC and returns the new household', async () => {
    const household = {
      id: 'h1',
      name: 'Casa',
      created_at: '2026-04-17T10:00:00Z',
    };
    const rpc = vi.fn().mockResolvedValue({ data: 'h1', error: null });
    const selectChain = householdSelectChain({ data: household, error: null });
    const client = { rpc, from: vi.fn().mockReturnValue(selectChain) };

    const result = await createHousehold(client as never, 'Casa');

    expect(rpc).toHaveBeenCalledWith('create_household_with_owner', {
      p_name: 'Casa',
    });
    expect(client.from).toHaveBeenCalledWith('households');
    expect(selectChain.eq).toHaveBeenCalledWith('id', 'h1');
    expect(result).toEqual(household);
  });

  it('throws when the RPC returns an error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'not authenticated' },
    });
    const client = { rpc, from: vi.fn() };

    await expect(
      createHousehold(client as never, 'Casa')
    ).rejects.toMatchObject({ message: 'not authenticated' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws when the RPC returns no id (defensive)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc, from: vi.fn() };

    await expect(createHousehold(client as never, 'Casa')).rejects.toThrow(
      /no id/i
    );
  });

  it('throws when the post-RPC SELECT fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'h1', error: null });
    const selectChain = householdSelectChain({
      data: null,
      error: { message: 'row not visible' },
    });
    const client = { rpc, from: vi.fn().mockReturnValue(selectChain) };

    await expect(
      createHousehold(client as never, 'Casa')
    ).rejects.toMatchObject({ message: 'row not visible' });
  });
});

describe('fetchMyHousehold', () => {
  /** Build a chain of `from(table).select(...).eq(...).maybeSingle()` */
  function maybeSingleChain(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    return chain;
  }

  /** Build a chain of `from(table).select(...).eq(...).single()` */
  function singleChain(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(result);
    return chain;
  }

  /**
   *
   */
  function buildClient(
    user: { id: string } | null,
    members: Record<string, unknown>,
    households?: Record<string, unknown>
  ) {
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      },
      from: vi.fn().mockImplementation((t: string) => {
        if (t === 'household_members') return members;
        if (t === 'households') return households;
        throw new Error(`unexpected from(${t})`);
      }),
    };
  }

  it('returns null when unauthenticated', async () => {
    const client = buildClient(
      null,
      maybeSingleChain({ data: null, error: null })
    );
    expect(await fetchMyHousehold(client as never)).toBeNull();
  });

  it('returns null when the user has no membership', async () => {
    const members = maybeSingleChain({ data: null, error: null });
    const client = buildClient({ id: 'u1' }, members);
    expect(await fetchMyHousehold(client as never)).toBeNull();
  });

  it('returns the household + role when the user is an owner', async () => {
    const members = maybeSingleChain({
      data: { household_id: 'h1', role: 'owner' },
      error: null,
    });
    const households = singleChain({
      data: { id: 'h1', name: 'Casa A', created_at: '2026-05-01T00:00:00Z' },
      error: null,
    });
    const client = buildClient({ id: 'u1' }, members, households);

    const result = await fetchMyHousehold(client as never);
    expect(result).toEqual({
      id: 'h1',
      name: 'Casa A',
      createdAt: '2026-05-01T00:00:00Z',
      myRole: 'owner',
    });
  });

  it('returns the household + member role when the user is a member', async () => {
    const members = maybeSingleChain({
      data: { household_id: 'h1', role: 'member' },
      error: null,
    });
    const households = singleChain({
      data: { id: 'h1', name: 'Casa A', created_at: '2026-05-01T00:00:00Z' },
      error: null,
    });
    const client = buildClient({ id: 'u1' }, members, households);
    const result = await fetchMyHousehold(client as never);
    expect(result?.myRole).toBe('member');
  });

  it('throws when the membership query errors', async () => {
    const members = maybeSingleChain({
      data: null,
      error: { message: 'denied' },
    });
    const client = buildClient({ id: 'u1' }, members);
    await expect(fetchMyHousehold(client as never)).rejects.toMatchObject({
      message: 'denied',
    });
  });
});

describe('renameHousehold', () => {
  it('calls rename_household RPC with the new name', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await renameHousehold({ rpc } as never, 'Casa Bonita');
    expect(rpc).toHaveBeenCalledWith('rename_household', {
      p_new_name: 'Casa Bonita',
    });
  });

  it('maps P0001 name must be 1-60 to InviteRpcError name_invalid', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'name must be 1-60 chars' },
    });
    try {
      await renameHousehold({ rpc } as never, '');
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteRpcError);
      expect((e as InviteRpcError).kind).toBe('name_invalid');
    }
  });

  it('re-throws 42501 verbatim (non-owner)', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'only owners can rename' },
    });
    await expect(renameHousehold({ rpc } as never, 'X')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('leaveHousehold', () => {
  it('calls leave_household RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await leaveHousehold({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith('leave_household');
  });

  it('maps P0001 owner cannot leave to owner_cannot_leave', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'owner cannot leave (transfer ownership first — v1 feature)',
      },
    });
    try {
      await leaveHousehold({ rpc } as never);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteRpcError);
      expect((e as InviteRpcError).kind).toBe('owner_cannot_leave');
    }
  });

  it('maps P0001 cannot orphan to cannot_orphan', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'cannot orphan household' },
    });
    try {
      await leaveHousehold({ rpc } as never);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteRpcError);
      expect((e as InviteRpcError).kind).toBe('cannot_orphan');
    }
  });
});
