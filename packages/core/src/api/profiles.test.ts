// What: Unit tests for the profiles wrappers
// Why: `fetchMyProfile` is a two-call chain (getUser → select) — easy to
//      regress the null-auth branch; `updateMyProfile` trims + rejects empty
//      input, both behaviors that must not drift
// Does NOT: Exercise RLS (integration test owns that — profiles.integration.test.ts)

import { describe, expect, it, vi } from 'vitest';
import { fetchMyProfile, updateMyProfile } from './profiles';

/**
 * Build a minimal fake Supabase client where `auth.getUser` returns the
 * supplied user and `from('profiles')` exposes a chain-terminating mock. The
 * inner `terminator` is the awaited result (`{ data, error }`) — callers pass
 * whatever the wrapper under test expects.
 */
function buildClient({
  user,
  terminator,
  terminalMethod = 'maybeSingle',
}: {
  user: { id: string } | null;
  terminator: { data: unknown; error: unknown };
  terminalMethod?: 'maybeSingle' | 'single';
}) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminator);
  chain.single = vi.fn().mockResolvedValue(terminator);
  // Ensure the right terminator is the promise-returning one.
  if (terminalMethod === 'single') {
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.single = vi.fn().mockResolvedValue(terminator);
  }
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn().mockReturnValue(chain),
  };
  return { client, chain };
}

describe('fetchMyProfile', () => {
  it('returns null when unauthenticated (auth.getUser → null)', async () => {
    const { client } = buildClient({
      user: null,
      terminator: { data: null, error: null },
    });

    await expect(fetchMyProfile(client as never)).resolves.toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns the profile row for the current user', async () => {
    const row = {
      user_id: 'u1',
      display_name: 'Meir',
      created_at: '2026-04-23T00:00:00Z',
    };
    const { client, chain } = buildClient({
      user: { id: 'u1' },
      terminator: { data: row, error: null },
    });

    const profile = await fetchMyProfile(client as never);

    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(profile).toEqual(row);
  });

  it('returns null when the profile row is missing (maybeSingle → data=null)', async () => {
    const { client } = buildClient({
      user: { id: 'u1' },
      terminator: { data: null, error: null },
    });

    await expect(fetchMyProfile(client as never)).resolves.toBeNull();
  });

  it('throws the Supabase error verbatim', async () => {
    const { client } = buildClient({
      user: { id: 'u1' },
      // Non-PGRST205 errors propagate — e.g. RLS denial (42501).
      terminator: {
        data: null,
        error: { message: 'RLS denied', code: '42501' },
      },
    });

    await expect(fetchMyProfile(client as never)).rejects.toMatchObject({
      message: 'RLS denied',
    });
  });

  // PGRST205 = relation does not exist. Rollout window: front-end deploys
  // before `supabase db push` applies migration 012 to prod. Settings is an
  // RSC — without this guard, the rollout window renders a 500 instead of
  // falling back to email-local-part.
  it('returns null (not throw) when the profiles table is missing (PGRST205)', async () => {
    const { client } = buildClient({
      user: { id: 'u1' },
      terminator: {
        data: null,
        error: {
          message: 'relation "public.profiles" does not exist',
          code: 'PGRST205',
        },
      },
    });

    await expect(fetchMyProfile(client as never)).resolves.toBeNull();
  });
});

describe('updateMyProfile', () => {
  it('trims whitespace and forwards to update().eq().select().single()', async () => {
    const row = {
      user_id: 'u1',
      display_name: 'Meir',
      created_at: '2026-04-23T00:00:00Z',
    };
    const { client, chain } = buildClient({
      user: { id: 'u1' },
      terminator: { data: row, error: null },
      terminalMethod: 'single',
    });

    const result = await updateMyProfile(client as never, '  Meir  ');

    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(chain.update).toHaveBeenCalledWith({ display_name: 'Meir' });
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(result).toEqual(row);
  });

  it('rejects empty strings before hitting the network', async () => {
    const { client } = buildClient({
      user: { id: 'u1' },
      terminator: { data: null, error: null },
      terminalMethod: 'single',
    });

    await expect(updateMyProfile(client as never, '   ')).rejects.toThrow(
      /empty/i
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it('rejects >80 char strings before hitting the network (mirrors CHECK)', async () => {
    // Mirrors the migration-012 CHECK(char_length(display_name) <= 80).
    // Failing fast here gives a clean error; without the guard, callers get
    // a raw Postgres constraint-violation bubble that's harder to surface
    // usefully in the toast UX.
    const { client } = buildClient({
      user: { id: 'u1' },
      terminator: { data: null, error: null },
      terminalMethod: 'single',
    });

    await expect(
      updateMyProfile(client as never, 'A'.repeat(81))
    ).rejects.toThrow(/80 characters/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('rejects when the caller is unauthenticated', async () => {
    const { client } = buildClient({
      user: null,
      terminator: { data: null, error: null },
      terminalMethod: 'single',
    });

    await expect(updateMyProfile(client as never, 'Meir')).rejects.toThrow(
      /authenticated/i
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws the Supabase error verbatim', async () => {
    const { client } = buildClient({
      user: { id: 'u1' },
      terminator: { data: null, error: { message: 'row-level security' } },
      terminalMethod: 'single',
    });

    await expect(
      updateMyProfile(client as never, 'Meir')
    ).rejects.toMatchObject({ message: 'row-level security' });
  });
});
