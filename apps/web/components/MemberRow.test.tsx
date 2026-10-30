// What: Snapshot + interaction tests for MemberRow.
// Why: Pin the owner-vs-member render branches + remove-button visibility
//      so future edits don't accidentally show the affordance to non-owners
//      or on the owner's own row.
// Does NOT: Run the actual remove RPC — `onRemove` is mocked.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberRow } from './MemberRow';
import type { Member } from '@lalista/core';

/**
 *
 */
function memberFixture(overrides: Partial<Member> = {}): Member {
  return {
    userId: 'u1',
    displayName: 'Alice',
    role: 'member',
    joinedAt: '2026-05-09T00:00:00Z',
    ...overrides,
  };
}

describe('MemberRow', () => {
  it('shows the remove button when viewer is owner and member is non-owner non-self', () => {
    const onRemove = vi.fn();
    render(
      <MemberRow
        member={memberFixture({ userId: 'm1', role: 'member' })}
        isCurrentUser={false}
        viewerIsOwner={true}
        onRemove={onRemove}
      />
    );
    const btn = screen.getByRole('button', { name: 'Remove Alice' });
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('hides the remove button on the owner row even for owner viewers', () => {
    render(
      <MemberRow
        member={memberFixture({ role: 'owner' })}
        isCurrentUser={false}
        viewerIsOwner={true}
      />
    );
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('hides the remove button on the current-user row (owners use leave_household)', () => {
    render(
      <MemberRow
        member={memberFixture()}
        isCurrentUser={true}
        viewerIsOwner={true}
      />
    );
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('hides the remove button when viewer is not an owner', () => {
    render(
      <MemberRow
        member={memberFixture()}
        isCurrentUser={false}
        viewerIsOwner={false}
      />
    );
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('appends "(you)" suffix on the current-user row', () => {
    render(
      <MemberRow
        member={memberFixture()}
        isCurrentUser={true}
        viewerIsOwner={false}
      />
    );
    expect(screen.getByText('(you)')).not.toBeNull();
  });

  it('renders displayName ?? "someone" with the matching initial', () => {
    const { rerender } = render(
      <MemberRow
        member={memberFixture({ displayName: null })}
        isCurrentUser={false}
        viewerIsOwner={false}
      />
    );
    expect(screen.getByText('someone')).not.toBeNull();
    expect(screen.getByText('?')).not.toBeNull();

    rerender(
      <MemberRow
        member={memberFixture({ displayName: 'Bob' })}
        isCurrentUser={false}
        viewerIsOwner={false}
      />
    );
    expect(screen.getByText('Bob')).not.toBeNull();
    expect(screen.getByText('B')).not.toBeNull();
  });

  it('dims the row + disables the button when isRemoving=true (Tier A1 fade)', () => {
    const onRemove = vi.fn();
    render(
      <MemberRow
        member={memberFixture()}
        isCurrentUser={false}
        viewerIsOwner={true}
        isRemoving={true}
        onRemove={onRemove}
      />
    );
    const row = screen.getByTestId('member-row');
    expect(row.className).toContain('opacity-50');
    const btn = screen.getByRole('button', { name: 'Remove Alice' });
    expect(btn).toHaveProperty('disabled', true);
  });
});
