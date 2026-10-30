// What: Render-branch tests for HouseholdAuditSection.
// Why: Pin the empty / populated / error states + the event-string formatter
//      so the v0 state-change observability surface stays human-readable
//      across edits.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HouseholdAuditSection } from './HouseholdAuditSection';

const fetchAuditMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('@lalista/core', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    fetchHouseholdAudit: (...args: unknown[]) => fetchAuditMock(...args),
  };
});

describe('HouseholdAuditSection', () => {
  beforeEach(() => {
    fetchAuditMock.mockReset();
  });

  it('empty: renders "no activity yet."', async () => {
    fetchAuditMock.mockResolvedValue([]);
    render(<HouseholdAuditSection />);
    await waitFor(() =>
      expect(screen.getByText('no activity yet.')).toBeTruthy()
    );
  });

  it('populated: formats each event_type into a human sentence', async () => {
    fetchAuditMock.mockResolvedValue([
      {
        id: 'a1',
        eventType: 'invite_created',
        actorUserId: 'u1',
        actorName: 'Alice',
        targetUserId: null,
        targetName: null,
        inviteId: 'i1',
        oldName: null,
        newName: null,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
      {
        id: 'a2',
        eventType: 'invite_used',
        actorUserId: 'u2',
        actorName: 'Bob',
        targetUserId: 'u2',
        targetName: 'Bob',
        inviteId: 'i1',
        oldName: null,
        newName: null,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      },
      {
        id: 'a3',
        eventType: 'member_removed',
        actorUserId: 'u1',
        actorName: 'Alice',
        targetUserId: 'u3',
        targetName: 'Carol',
        inviteId: null,
        oldName: null,
        newName: null,
        createdAt: new Date(Date.now() - 30_000).toISOString(),
      },
      {
        id: 'a4',
        eventType: 'household_renamed',
        actorUserId: 'u1',
        actorName: 'Alice',
        targetUserId: null,
        targetName: null,
        inviteId: null,
        oldName: 'Old',
        newName: 'New',
        createdAt: new Date(Date.now() - 5_000).toISOString(),
      },
    ]);
    render(<HouseholdAuditSection />);
    await waitFor(() =>
      expect(screen.getByText('Alice created an invite link.')).toBeTruthy()
    );
    expect(screen.getByText('Bob joined via invite.')).toBeTruthy();
    expect(screen.getByText('Alice removed Carol.')).toBeTruthy();
    expect(
      screen.getByText('Alice renamed the household to New.')
    ).toBeTruthy();
  });

  it("falls back to 'someone' when actor or target name is null", async () => {
    fetchAuditMock.mockResolvedValue([
      {
        id: 'a1',
        eventType: 'member_removed',
        actorUserId: null,
        actorName: null,
        targetUserId: null,
        targetName: null,
        inviteId: null,
        oldName: null,
        newName: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    render(<HouseholdAuditSection />);
    await waitFor(() =>
      expect(screen.getByText('someone removed someone.')).toBeTruthy()
    );
  });

  it('renders an error caption when fetch fails', async () => {
    fetchAuditMock.mockRejectedValue(new Error('boom'));
    render(<HouseholdAuditSection />);
    await waitFor(() =>
      expect(screen.getByText("Couldn't load activity.")).toBeTruthy()
    );
  });
});
