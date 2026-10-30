// What: Unit tests for members.ts wrappers — fetchMembers (two-query hydration),
//       removeMember (RPC + InviteError mapping).
// Why: Verify the addedByName-style two-query pattern (D13/C1) on
//      household_members + profiles, the 'someone' fallback when profile is
//      absent, and PGRST205 tolerance.
// Does NOT: Hit a database — chained mocks shape the supabase-js surface.

import { describe, expect, it, vi } from 'vitest';
import { fetchMembers, removeMember } from './members';
import { InviteRpcError } from './inviteErrors';

/**
 *
 */
function memberRow(
  overrides: Partial<{
    user_id: string;
    role: string;
    joined_at: string;
  }> = {}
) {
  return {
    user_id: 'u1',
    role: 'member',
    joined_at: '2026-05-09T00:00:00Z',
    ...overrides,
  };
}

/**
 *
 */
function membersOrderChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue(result);
  return chain;
}

/**
 *
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
 *
 */
function buildClient(
  members: Record<string, unknown>,
  profiles: Record<string, unknown> = profilesInChain()
) {
  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'household_members') return members;
    if (table === 'profiles') return profiles;
    throw new Error(`unexpected from(${table}) in test`);
  });
  return { from: fromMock };
}

describe('fetchMembers', () => {
  it('hydrates each member with display_name from the profiles two-query lookup', async () => {
    const members = membersOrderChain({
      data: [
        memberRow({ user_id: 'u1', role: 'owner' }),
        memberRow({ user_id: 'u2', role: 'member' }),
      ],
      error: null,
    });
    const profiles = profilesInChain({
      data: [
        { user_id: 'u1', display_name: 'Alice' },
        { user_id: 'u2', display_name: 'Bob' },
      ],
      error: null,
    });
    const client = buildClient(members, profiles);

    const result = await fetchMembers(client as never);

    expect(client.from).toHaveBeenCalledWith('household_members');
    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(profiles.in).toHaveBeenCalledWith('user_id', ['u1', 'u2']);
    expect(result).toEqual([
      {
        userId: 'u1',
        displayName: 'Alice',
        role: 'owner',
        joinedAt: '2026-05-09T00:00:00Z',
      },
      {
        userId: 'u2',
        displayName: 'Bob',
        role: 'member',
        joinedAt: '2026-05-09T00:00:00Z',
      },
    ]);
  });

  it('falls back to displayName: null when profile row is missing (someone fallback)', async () => {
    const members = membersOrderChain({
      data: [memberRow({ user_id: 'u1' })],
      error: null,
    });
    const client = buildClient(members, profilesInChain());

    const result = await fetchMembers(client as never);
    expect(result[0]?.displayName).toBeNull();
  });

  it('skips the profiles lookup when there are no members', async () => {
    const members = membersOrderChain({ data: [], error: null });
    const profiles = profilesInChain();
    const client = buildClient(members, profiles);

    const result = await fetchMembers(client as never);
    expect(result).toEqual([]);
    expect(profiles.in).not.toHaveBeenCalled();
  });

  it('dedupes user_ids in the profiles.in() call (defensive — single membership per user, but defensive)', async () => {
    const members = membersOrderChain({
      data: [
        memberRow({ user_id: 'u1' }),
        // In v0 this duplicate cannot happen (unique constraint), but the
        // wrapper should still dedupe defensively in case migration 015 is
        // dropped (v1 multi-household chapter).
        memberRow({ user_id: 'u1' }),
      ],
      error: null,
    });
    const profiles = profilesInChain({
      data: [{ user_id: 'u1', display_name: 'A' }],
      error: null,
    });
    const client = buildClient(members, profiles);

    await fetchMembers(client as never);
    expect(profiles.in).toHaveBeenCalledTimes(1);
    const call = (profiles.in as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[1]).toEqual(['u1']);
  });

  it('tolerates PGRST205 (profiles table missing) — returns null displayNames, does not throw', async () => {
    const members = membersOrderChain({
      data: [memberRow({ user_id: 'u1' })],
      error: null,
    });
    const profiles = profilesInChain({
      data: null,
      error: {
        code: 'PGRST205',
        message: 'relation "public.profiles" does not exist',
      },
    });
    const client = buildClient(members, profiles);
    const result = await fetchMembers(client as never);
    expect(result[0]?.displayName).toBeNull();
  });

  it('throws non-PGRST205 profiles errors (RLS denial etc.)', async () => {
    const members = membersOrderChain({
      data: [memberRow({ user_id: 'u1' })],
      error: null,
    });
    const profiles = profilesInChain({
      data: null,
      error: { code: '42501', message: 'RLS denied' },
    });
    const client = buildClient(members, profiles);
    await expect(fetchMembers(client as never)).rejects.toMatchObject({
      message: 'RLS denied',
    });
  });

  it('throws when the household_members select errors', async () => {
    const members = membersOrderChain({
      data: null,
      error: { message: 'denied' },
    });
    const client = buildClient(members);
    await expect(fetchMembers(client as never)).rejects.toMatchObject({
      message: 'denied',
    });
  });
});

describe('removeMember', () => {
  it('calls remove_member RPC with the user id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await removeMember({ rpc } as never, 'u2');
    expect(rpc).toHaveBeenCalledWith('remove_member', { p_user_id: 'u2' });
  });

  it('maps P0001 member not found to InviteRpcError not_found_or_used', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'member not found' },
    });
    try {
      await removeMember({ rpc } as never, 'u2');
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteRpcError);
      expect((e as InviteRpcError).kind).toBe('not_found_or_used');
    }
  });

  it('re-throws 42501 only-owners verbatim (defense-in-depth: UI hides the button)', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'only owners can remove members' },
    });
    await expect(removeMember({ rpc } as never, 'u2')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
