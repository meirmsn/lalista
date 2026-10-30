// What: Unit tests for invitations.ts wrappers — createInvite, fetchPendingInvites,
//       revokeInvite, acceptInvite.
// Why: T12 (spec § Tests) — every InviteError mapping case lands here. Plus
//      verifies URL building uses NEXT_PUBLIC_SITE_URL when set vs
//      window.location.origin fallback (D5).
// Does NOT: Test the RPC SQL itself — that's the integration suite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInvite,
  fetchPendingInvites,
  revokeInvite,
  acceptInvite,
} from './invitations';
import { InviteRpcError } from './inviteErrors';

/** Build a chain mock for `from(table).select(...).eq(...).single()`. */
function singleSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

/** Build a chain for `from(table).select(...).order(...)`. */
function orderSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue(result);
  return chain;
}

describe('createInvite', () => {
  // Restore env between tests so no other test leaks state.
  const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
  });

  it('calls create_invite RPC, fetches expires_at, builds the URL with NEXT_PUBLIC_SITE_URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://lalista.store';
    const rpc = vi.fn().mockResolvedValue({ data: 'abc123', error: null });
    const chain = singleSelectChain({
      data: { expires_at: '2026-05-17T00:00:00Z' },
      error: null,
    });
    const client = { rpc, from: vi.fn().mockReturnValue(chain) };

    const result = await createInvite(client as never);

    expect(rpc).toHaveBeenCalledWith('create_invite');
    expect(client.from).toHaveBeenCalledWith('household_invitations');
    expect(chain.eq).toHaveBeenCalledWith('token', 'abc123');
    expect(result).toEqual({
      token: 'abc123',
      url: 'https://lalista.store/join/abc123',
      expiresAt: '2026-05-17T00:00:00Z',
    });
  });

  it('strips a trailing slash from NEXT_PUBLIC_SITE_URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://lalista.store/';
    const rpc = vi.fn().mockResolvedValue({ data: 'tok', error: null });
    const chain = singleSelectChain({
      data: { expires_at: 'X' },
      error: null,
    });
    const client = { rpc, from: vi.fn().mockReturnValue(chain) };
    const result = await createInvite(client as never);
    expect(result.url).toBe('https://lalista.store/join/tok');
  });

  it('falls back to window.location.origin when NEXT_PUBLIC_SITE_URL is unset and window is available', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    // core's vitest config uses node env (no window). Stub a minimal window
    // shape on globalThis to exercise the fallback branch — apps/web's
    // jsdom-environment tests cover the real-window case.
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      location: { origin: 'http://example.invalid' },
    };
    try {
      const rpc = vi.fn().mockResolvedValue({ data: 'tok2', error: null });
      const chain = singleSelectChain({
        data: { expires_at: 'X' },
        error: null,
      });
      const client = { rpc, from: vi.fn().mockReturnValue(chain) };
      const result = await createInvite(client as never);
      expect(result.url).toBe('http://example.invalid/join/tok2');
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  });

  it('returns an empty origin when NEXT_PUBLIC_SITE_URL is unset and window is unavailable (SSR)', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    // No window — pure SSR path. The visible-broken URL is the right surface
    // to debug (better than a `localhost` placeholder that would 404 silently).
    const rpc = vi.fn().mockResolvedValue({ data: 'tok3', error: null });
    const chain = singleSelectChain({
      data: { expires_at: 'X' },
      error: null,
    });
    const client = { rpc, from: vi.fn().mockReturnValue(chain) };
    const result = await createInvite(client as never);
    expect(result.url).toBe('/join/tok3');
  });

  it('encodes token in the URL path', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://lalista.store';
    const rpc = vi.fn().mockResolvedValue({ data: 'a/b+c', error: null });
    const chain = singleSelectChain({
      data: { expires_at: 'X' },
      error: null,
    });
    const client = { rpc, from: vi.fn().mockReturnValue(chain) };
    const result = await createInvite(client as never);
    expect(result.url).toBe('https://lalista.store/join/a%2Fb%2Bc');
  });

  it('maps RPC P0001 owner-side error to InviteRpcError or re-throws auth errors', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://lalista.store';
    // 42501 (auth) does NOT map — should re-throw as-is.
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'only owners can create invites' },
    });
    const client = { rpc, from: vi.fn() };

    await expect(createInvite(client as never)).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('fetchPendingInvites', () => {
  const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://lalista.store';
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
  });

  it('returns rows mapped to Invite shape with computed urls', async () => {
    const chain = orderSelectChain({
      data: [
        {
          id: 'i1',
          token: 't1',
          expires_at: '2026-05-17T00:00:00Z',
          created_at: '2026-05-10T00:00:00Z',
        },
      ],
      error: null,
    });
    const client = { from: vi.fn().mockReturnValue(chain) };
    const result = await fetchPendingInvites(client as never);
    expect(client.from).toHaveBeenCalledWith('household_invitations');
    expect(result).toEqual([
      {
        id: 'i1',
        token: 't1',
        url: 'https://lalista.store/join/t1',
        expiresAt: '2026-05-17T00:00:00Z',
        createdAt: '2026-05-10T00:00:00Z',
      },
    ]);
  });

  it('returns empty array when no rows', async () => {
    const chain = orderSelectChain({ data: [], error: null });
    const client = { from: vi.fn().mockReturnValue(chain) };
    expect(await fetchPendingInvites(client as never)).toEqual([]);
  });

  it('throws when the RLS-scoped query errors', async () => {
    const chain = orderSelectChain({
      data: null,
      error: { message: 'denied' },
    });
    const client = { from: vi.fn().mockReturnValue(chain) };
    await expect(fetchPendingInvites(client as never)).rejects.toMatchObject({
      message: 'denied',
    });
  });
});

describe('revokeInvite', () => {
  it('calls revoke_invite with the invite id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await revokeInvite({ rpc } as never, 'i1');
    expect(rpc).toHaveBeenCalledWith('revoke_invite', { p_invite_id: 'i1' });
  });

  it('maps P0001 not found to InviteRpcError not_found_or_used', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'invite not found or already used' },
    });
    try {
      await revokeInvite({ rpc } as never, 'i1');
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteRpcError);
      expect((e as InviteRpcError).kind).toBe('not_found_or_used');
    }
  });

  it('re-throws non-mapped errors verbatim', async () => {
    const raw = { code: '42501', message: 'only owners can revoke invites' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: raw });
    await expect(revokeInvite({ rpc } as never, 'i1')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('acceptInvite', () => {
  it('calls accept_invite RPC and returns the household_id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'h1', error: null });
    const id = await acceptInvite({ rpc } as never, 'tok');
    expect(rpc).toHaveBeenCalledWith('accept_invite', { p_token: 'tok' });
    expect(id).toBe('h1');
  });

  it('maps P0001 invite invalid or expired to expired_or_invalid', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'invite invalid or expired' },
    });
    try {
      await acceptInvite({ rpc } as never, 'tok');
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteRpcError);
      expect((e as InviteRpcError).kind).toBe('expired_or_invalid');
    }
  });

  it('maps P0001 already in a household to already_in_household', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'already in a household' },
    });
    await expect(acceptInvite({ rpc } as never, 'tok')).rejects.toMatchObject({
      kind: 'already_in_household',
    });
  });

  it('maps 23505 unique-constraint race to already_in_household', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "household_members_one_per_user_v0"',
      },
    });
    await expect(acceptInvite({ rpc } as never, 'tok')).rejects.toMatchObject({
      kind: 'already_in_household',
    });
  });

  it('throws when the RPC returns no data and no error (defensive)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(acceptInvite({ rpc } as never, 'tok')).rejects.toThrow(
      /no household_id/i
    );
  });
});
