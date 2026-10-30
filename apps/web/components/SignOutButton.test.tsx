// What: Tests for SignOutButton — happy path, error path, disabled state,
//       Tier B threshold spinner + post-success label.
// Why: Sign-out failure handling is the only control on the Settings page;
//      stuck-in-signing-out state would strand users. Post-app-snappiness,
//      this button uses the Tier B affordance: instant disable on click,
//      spinner-after-250ms during the round-trip, "Signing out…" label
//      from the success transition through to the /sign-in redirect.
// Does NOT: Test the global auth_signed_out event — providers.tsx wires that

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { pushMock, signOutMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ __kind: 'browser-client' }),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    signOut: signOutMock,
  };
});

import { SignOutButton } from './SignOutButton';

describe('<SignOutButton>', () => {
  beforeEach(() => {
    pushMock.mockReset();
    signOutMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls signOut then pushes /sign-in on success', async () => {
    signOutMock.mockResolvedValue(undefined);
    render(<SignOutButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sign-in'));
  });

  it('surfaces an error inline on failure without pushing', async () => {
    signOutMock.mockRejectedValue(new Error('network'));
    render(<SignOutButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't sign out/i
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('instantly disables the button on click (Tier B — pre-threshold)', async () => {
    let resolve: ((v: unknown) => void) | undefined;
    signOutMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<SignOutButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    // Disabled is instant — the threshold doesn't gate the disabled state,
    // just the spinner + label.
    expect(screen.getByRole('button')).toBeDisabled();
    resolve?.(undefined);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sign-in'));
  });

  it('shows "Signing out…" label after the success transition (post-success)', async () => {
    signOutMock.mockResolvedValue(undefined);
    render(<SignOutButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    // After signOut resolves, success state flips and the label swaps to
    // "Signing out…" while router.push is pending.
    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveTextContent(/signing out/i)
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sign-in'));
  });

  // Note: the 250ms threshold spinner shape is pinned in
  // packages/ui/src/useSubmitFeedback.test.ts and SubmitButton.test.tsx.
  // SignOutButton consumes useSubmitFeedback directly so it inherits that
  // contract — re-asserting it here would duplicate the upstream coverage.
});
