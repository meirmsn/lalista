// What: Behavior tests for /reset-password — validation, updateUser call, success/error.
// Why: This is the screen that lands the new password; pin the validation
//      gates + the analytics fire so a mis-edit can't drop them.
// Does NOT: Hit Supabase; updateUser is mocked at the createClient level.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { pushMock, updateUserMock, trackCompletedMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  updateUserMock: vi.fn(),
  trackCompletedMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { updateUser: updateUserMock },
  }),
}));

vi.mock('@/lib/analytics', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/analytics')>('@/lib/analytics');
  return { ...actual, trackPasswordResetCompleted: trackCompletedMock };
});

import ResetPasswordPage from './page';
import { AuthEmailProvider } from '../_email-context';

/**
 *
 */
function renderPage() {
  return render(
    <AuthEmailProvider>
      <ResetPasswordPage />
    </AuthEmailProvider>
  );
}

describe('<ResetPasswordPage>', () => {
  beforeEach(() => {
    pushMock.mockReset();
    updateUserMock.mockReset();
    trackCompletedMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders both password fields + Set new password button', () => {
    renderPage();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /set new password/i })
    ).toBeInTheDocument();
  });

  it('submit with matching valid passwords calls updateUser + tracks completed + pushes /list', async () => {
    updateUserMock.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'NewStrong1!');
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      'NewStrong1!'
    );
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith({
        password: 'NewStrong1!',
      })
    );
    expect(trackCompletedMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/list');
  });

  it('mismatched passwords block submit with inline error', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'Aaaaaa1!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'Bbbbbb1!');
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/don.?t match/i);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('short password blocks submit', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText(/confirm new password/i), 'short');
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /at least 8 characters/i
    );
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('server error renders via AuthErrorDisplay', async () => {
    updateUserMock.mockResolvedValue({
      data: {},
      error: { message: 'Password should be at least 8 characters.' },
    });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'LongerPw1!');
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      'LongerPw1!'
    );
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /at least 8 characters/i
      )
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('network failure shows generic error', async () => {
    updateUserMock.mockRejectedValue(new Error('fetch failed'));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'LongerPw1!');
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      'LongerPw1!'
    );
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/can.?t reach/i)
    );
  });
});
