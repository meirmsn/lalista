// What: Unit tests for audit.ts wrapper — fetchHouseholdAudit two-query shape,
//       'someone' fallback for missing/deleted profiles, sort + limit pass-through.
// Why: D13/C1 — the two-query display-name hydration pattern is load-bearing.
//      A future "simplify into a single PostgREST join" refactor would silently
//      break because auth.users is a different schema; this test pins the shape.
// Does NOT: Hit a database — that's the integration suite (case 6 deferred).

import { describe, expect, it, vi } from 'vitest';
import { fetchHouseholdAudit } from './audit';

/**
 *
 */
function auditRow(
  overrides: Partial<{
    id: string;
    event_type: string;
    actor_user_id: string | null;
    target_user_id: string | null;
    invite_id: string | null;
    old_name: string | null;
    new_name: string | null;
    created_at: string;
  }> = {}
) {
  return {
    id: 'a1',
    event_type: 'invite_created',
    actor_user_id: 'u1',
    target_user_id: null,
    invite_id: 'i1',
    old_name: null,
    new_name: null,
    created_at: '2026-05-09T00:00:00Z',
    ...overrides,
  };
}

/**
 *
 */
function auditChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
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
  audit: Record<string, unknown>,
  profiles: Record<string, unknown> = profilesInChain()
) {
  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'household_audit_events') return audit;
    if (table === 'profiles') return profiles;
    throw new Error(`unexpected from(${table}) in test`);
  });
  return { from: fromMock };
}

describe('fetchHouseholdAudit', () => {
  it('hydrates actorName and targetName via the two-query profiles lookup', async () => {
    const audit = auditChain({
      data: [
        auditRow({
          id: 'a1',
          event_type: 'member_removed',
          actor_user_id: 'u1',
          target_user_id: 'u2',
          invite_id: null,
        }),
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
    const client = buildClient(audit, profiles);

    const result = await fetchHouseholdAudit(client as never);

    expect(client.from).toHaveBeenCalledWith('household_audit_events');
    expect(client.from).toHaveBeenCalledWith('profiles');
    // Sorted desc by created_at.
    expect(audit.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(audit.limit).toHaveBeenCalledWith(20);
    // Profiles call should include both unique ids.
    const inCall = (profiles.in as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(inCall?.[0]).toBe('user_id');
    expect(new Set(inCall?.[1])).toEqual(new Set(['u1', 'u2']));

    expect(result[0]?.actorName).toBe('Alice');
    expect(result[0]?.targetName).toBe('Bob');
    expect(result[0]?.eventType).toBe('member_removed');
  });

  it('falls back to actorName: null when the profile is missing (someone fallback)', async () => {
    const audit = auditChain({
      data: [auditRow({ actor_user_id: 'gone-user', target_user_id: null })],
      error: null,
    });
    const client = buildClient(audit, profilesInChain());
    const result = await fetchHouseholdAudit(client as never);
    expect(result[0]?.actorName).toBeNull();
    expect(result[0]?.actorUserId).toBe('gone-user');
  });

  it('skips profiles lookup when no audit rows reference users', async () => {
    const audit = auditChain({
      data: [
        auditRow({
          actor_user_id: null,
          target_user_id: null,
          event_type: 'household_renamed',
          old_name: 'A',
          new_name: 'B',
        }),
      ],
      error: null,
    });
    const profiles = profilesInChain();
    const client = buildClient(audit, profiles);

    const result = await fetchHouseholdAudit(client as never);
    expect(profiles.in).not.toHaveBeenCalled();
    expect(result[0]?.eventType).toBe('household_renamed');
    expect(result[0]?.oldName).toBe('A');
    expect(result[0]?.newName).toBe('B');
  });

  it('passes through the limit override', async () => {
    const audit = auditChain({ data: [], error: null });
    const client = buildClient(audit);
    await fetchHouseholdAudit(client as never, 5);
    expect(audit.limit).toHaveBeenCalledWith(5);
  });

  it('returns empty array when no rows', async () => {
    const audit = auditChain({ data: [], error: null });
    const client = buildClient(audit);
    expect(await fetchHouseholdAudit(client as never)).toEqual([]);
  });

  it('throws on audit-table errors', async () => {
    const audit = auditChain({ data: null, error: { message: 'denied' } });
    const client = buildClient(audit);
    await expect(fetchHouseholdAudit(client as never)).rejects.toMatchObject({
      message: 'denied',
    });
  });

  it('tolerates PGRST205 on profiles (missing table) — names null, no throw', async () => {
    const audit = auditChain({
      data: [auditRow({ actor_user_id: 'u1' })],
      error: null,
    });
    const profiles = profilesInChain({
      data: null,
      error: {
        code: 'PGRST205',
        message: 'relation "public.profiles" does not exist',
      },
    });
    const client = buildClient(audit, profiles);
    const result = await fetchHouseholdAudit(client as never);
    expect(result[0]?.actorName).toBeNull();
    expect(result[0]?.actorUserId).toBe('u1');
  });
});
