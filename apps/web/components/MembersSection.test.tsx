// What: Render + branch tests for MembersSection.
// Why: Pin the load + empty-state + role-branched (owner vs member)
//      surface contracts. Mocks @lalista/core wrappers so we don't hit
//      the network.
// Does NOT: Test the full mutation lifecycle — those land in E2E specs
//           per the per-surface invariant (task 17).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MembersSection } from './MembersSection';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const fetchMembersMock = vi.fn();
const fetchPendingInvitesMock = vi.fn();
const removeMemberMock = vi.fn();
const leaveHouseholdMock = vi.fn();
const revokeInviteMock = vi.fn();

vi.mock('@lalista/core', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    fetchMembers: (...args: unknown[]) => fetchMembersMock(...args),
    fetchPendingInvites: (...args: unknown[]) =>
      fetchPendingInvitesMock(...args),
    removeMember: (...args: unknown[]) => removeMemberMock(...args),
    leaveHousehold: (...args: unknown[]) => leaveHouseholdMock(...args),
    revokeInvite: (...args: unknown[]) => revokeInviteMock(...args),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({})),
}));

describe('MembersSection', () => {
  beforeEach(() => {
    fetchMembersMock.mockReset();
    fetchPendingInvitesMock.mockReset();
    removeMemberMock.mockReset();
    leaveHouseholdMock.mockReset();
    revokeInviteMock.mockReset();
  });

  it('owner view: renders members + pending invites + invite CTA', async () => {
    fetchMembersMock.mockResolvedValue([
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
    fetchPendingInvitesMock.mockResolvedValue([
      {
        id: 'i1',
        token: 't1',
        url: 'https://lalista.store/join/t1',
        expiresAt: '2026-05-17T00:00:00Z',
        createdAt: '2026-05-10T00:00:00Z',
      },
    ]);

    render(
      <MembersSection
        currentUserId="u1"
        viewerIsOwner={true}
        onInviteCtaClick={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Pending invites')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'invite someone' })).toBeTruthy();
    // Owner sees Bob's remove button (Bob is non-owner non-self).
    expect(screen.getByRole('button', { name: /Remove Bob/i })).toBeTruthy();
  });

  it('member view: hides invite CTA + pending invites, shows Leave household button', async () => {
    fetchMembersMock.mockResolvedValue([
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
    fetchPendingInvitesMock.mockResolvedValue([]);

    render(
      <MembersSection
        currentUserId="u2"
        viewerIsOwner={false}
        onInviteCtaClick={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'invite someone' })).toBeNull();
    expect(screen.queryByText('Pending invites')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Leave household/i })
    ).toBeTruthy();
    // Member view does NOT call fetchPendingInvites — RLS would deny but we
    // also avoid the unnecessary roundtrip.
    expect(fetchPendingInvitesMock).not.toHaveBeenCalled();
  });

  it('owner view, only-the-owner state: renders the empty "just you so far" copy', async () => {
    fetchMembersMock.mockResolvedValue([
      {
        userId: 'u1',
        displayName: 'Alice',
        role: 'owner',
        joinedAt: '2026-05-09T00:00:00Z',
      },
    ]);
    fetchPendingInvitesMock.mockResolvedValue([]);

    render(
      <MembersSection
        currentUserId="u1"
        viewerIsOwner={true}
        onInviteCtaClick={() => {}}
      />
    );

    await waitFor(() =>
      expect(screen.getByText('just you so far')).toBeTruthy()
    );
    expect(screen.getByText('send a link.')).toBeTruthy();
  });

  it('renders an inline error caption when load fails', async () => {
    fetchMembersMock.mockRejectedValue(new Error('boom'));
    fetchPendingInvitesMock.mockResolvedValue([]);

    render(
      <MembersSection
        currentUserId="u1"
        viewerIsOwner={true}
        onInviteCtaClick={() => {}}
      />
    );

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load members/i)).toBeTruthy()
    );
  });
});
