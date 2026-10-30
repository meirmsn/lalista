// What: Behavior tests for the /forgot-password screen — submit, no-enumeration
//       success copy, edit-email round-trip, resend countdown.
// Why: The no-enumeration promise is structural; pin it with an assertion
//      that the success copy renders regardless of whether resetPasswordForEmail
//      "found" the email. Countdown UX is also pinned.
// Does NOT: Hit Supabase; resetPasswordForEmail is mocked at the createClient level.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { resetMock, trackRequestedMock } = vi.hoisted(() => ({
  resetMock: vi.fn(),
  trackRequestedMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { resetPasswordForEmail: resetMock },
  }),
}));

vi.mock('@/lib/analytics', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/analytics')>('@/lib/analytics');
  return { ...actual, trackPasswordResetRequested: trackRequestedMock };
});

import ForgotPasswordPage from './page';
import { AuthEmailProvider } from '../_email-context';

/**
 *
 */
function renderPage() {
  return render(
    <AuthEmailProvider>
      <ForgotPasswordPage />
    </AuthEmailProvider>
  );
}

describe('<ForgotPasswordPage>', () => {
  beforeEach(() => {
    resetMock.mockReset();
    trackRequestedMock.mockReset();
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:3000' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders email + Send reset link button', () => {
    renderPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /send reset link/i })
    ).toBeInTheDocument();
  });

  it('email format validation blocks submit', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it('submit calls resetPasswordForEmail with absolute callback URL + ?type=recovery', async () => {
    resetMock.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'alice@test.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1));
    expect(resetMock).toHaveBeenCalledWith('alice@test.local', {
      redirectTo: 'http://localhost:3000/auth/callback?type=recovery',
    });
    expect(trackRequestedMock).toHaveBeenCalledTimes(1);
  });

  it('submit always renders success copy (no-enumeration), regardless of response shape', async () => {
    // Even if Supabase returns a "user found"-shaped object, we must not
    // distinguish — the component never inspects response.data.
    resetMock.mockResolvedValue({
      data: { user: null }, // pretend something exists
      error: null,
    });
    renderPage();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/email/i),
      'never-existed@test.local'
    );
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /check your email/i })
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/if .*is registered/i)).toBeInTheDocument();
    expect(screen.getByText(/never-existed@test\.local/i)).toBeInTheDocument();
  });

  it('success state renders Resend (1:00) initially', async () => {
    resetMock.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'alice@test.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /resend in 1:00/i })
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole('button', { name: /resend in 1:00/i })
    ).toBeDisabled();
  });

  it('Edit email returns to the form with the email preserved', async () => {
    resetMock.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'alice@test.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /check your email/i })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: /edit email/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/email/i)).toHaveValue('alice@test.local');
  });

  it('resend click while countdown > 0 is a no-op', async () => {
    resetMock.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'alice@test.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /resend in 1:00/i })
      ).toBeDisabled()
    );
    expect(resetMock).toHaveBeenCalledTimes(1);
    // Click does nothing because button is disabled.
    fireEvent.click(screen.getByRole('button', { name: /resend in 1:00/i }));
    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});
