// What: Render + sign-out interaction test for RemovedFromHouseholdNotice.
// Why: Pin the copy + the sign-out link branch so a future refactor of
//      D15's text doesn't accidentally break the canonical strings.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RemovedFromHouseholdNotice } from './RemovedFromHouseholdNotice';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const signOutMock = vi.fn();
vi.mock('@lalista/core', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    signOut: (...args: unknown[]) => signOutMock(...args),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({})),
}));

describe('RemovedFromHouseholdNotice', () => {
  it('renders the canonical D15 copy + uppercase REMOVED FROM HOUSEHOLD caption', () => {
    render(<RemovedFromHouseholdNotice />);
    expect(screen.getByText(/REMOVED FROM HOUSEHOLD/i)).toBeTruthy();
    expect(
      screen.getByText(
        /the household owner removed you\. you can create your own household below, or sign out\./i
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /sign out and use a different account/i,
      })
    ).toBeTruthy();
  });

  it('does NOT show the household name (privacy / handles renamed-after-removal)', () => {
    render(<RemovedFromHouseholdNotice />);
    // No props — the component never accepts a name. Defensive check on copy
    // surface so future refactors don't add an arg silently.
    expect(screen.queryByText(/casa/i)).toBeNull();
  });

  it('signs out and navigates to /sign-in on link click', async () => {
    pushMock.mockReset();
    signOutMock.mockReset();
    signOutMock.mockResolvedValue(undefined);
    render(<RemovedFromHouseholdNotice />);
    fireEvent.click(
      screen.getByRole('button', {
        name: /sign out and use a different account/i,
      })
    );
    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith('/sign-in');
  });
});
