// What: Behavior tests for the sign-in screen — sign-in only (no signup fallback)
// Why: Post-chapter-1l, /sign-up handles the signup branch; /sign-in only
//      validates inputs, calls signInWithPassword once, and branches on
//      result. Tests pin those behaviors only.
// Does NOT: Cover the signup fallback or awaiting-confirmation flow — those
//           live in /sign-up tests + AwaitingConfirmationCard tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { pushMock, signInMock, getSearchParam } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInMock: vi.fn(),
  getSearchParam: vi.fn(() => null) as unknown as (k: string) => string | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: getSearchParam }),
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
  createClient: () => ({ __kind: 'test-client' }),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return { ...actual, signInWithPassword: signInMock };
});

import SignInPage from './page';
import { AuthEmailProvider } from '../_email-context';

/**
 *
 */
function renderPage() {
  return render(
    <AuthEmailProvider>
      <SignInPage />
    </AuthEmailProvider>
  );
}

/**
 *
 */
async function fillAndSubmit(
  email = 'alice@test.local',
  password = 'Password123!'
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
  return user;
}

describe('<SignInPage>', () => {
  beforeEach(() => {
    pushMock.mockReset();
    signInMock.mockReset();
    (getSearchParam as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getSearchParam as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      null
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders email + password + Sign in button + Forgot/Create-one links', () => {
    renderPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^sign in$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /forgot password\?/i })
    ).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: /create one/i })).toHaveAttribute(
      'href',
      '/sign-up'
    );
  });

  it('submit with valid creds calls signInWithPassword once and pushes /onboarding', async () => {
    signInMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    renderPage();

    await fillAndSubmit('alice@test.local', 'Password123!');

    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    expect(signInMock).toHaveBeenCalledWith(
      expect.anything(),
      'alice@test.local',
      'Password123!'
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/onboarding'));
  });

  it('rate-limit error surfaces as friendly message', async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'Email rate limit exceeded' },
    });
    renderPage();
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i)
    );
    expect(screen.getByRole('alert').textContent).not.toMatch(
      /email rate limit exceeded/i
    );
  });

  it('email-not-confirmed maps to friendly copy', async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'Email not confirmed' },
    });
    renderPage();
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /check your email to confirm/i
      )
    );
  });

  it('invalid-credentials maps to friendly copy + create-account hint', async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    renderPage();
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /email and password don.?t match/i
      )
    );
    // The "trying to create an account instead?" hint links to /sign-up — a
    // signed-in user who landed here meaning to register has a one-tap path.
    const hintLink = screen.getByRole('link', { name: /create an account/i });
    expect(hintLink).toHaveAttribute('href', '/sign-up');
    // No signUpWithPassword path on /sign-in anymore.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('non-credential errors do NOT show the create-account hint', async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'rate limit exceeded for emails' },
    });
    renderPage();
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i)
    );
    // Hint is scoped to invalid-credentials, not "any error".
    expect(
      screen.queryByRole('link', { name: /create an account/i })
    ).not.toBeInTheDocument();
  });

  it('network failure shows generic error', async () => {
    signInMock.mockRejectedValue(new Error('fetch failed'));
    renderPage();
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/can.?t reach/i)
    );
  });

  it('email format validation blocks submit (no @)', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('empty password blocks submit', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'alice@test.local');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /enter a password/i
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('button is disabled while request is in-flight', async () => {
    let resolveSignIn: ((v: unknown) => void) | undefined;
    signInMock.mockReturnValue(
      new Promise((r) => {
        resolveSignIn = r;
      })
    );
    renderPage();

    await fillAndSubmit();

    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeDisabled();

    resolveSignIn?.({ data: { user: { id: 'u1' } }, error: null });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^sign in$/i })
      ).not.toBeDisabled()
    );
  });

  it('reset-error=expired query param surfaces friendly copy', () => {
    (getSearchParam as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'reset-error' ? 'expired' : null)
    );
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(/reset link expired/i);
  });

  it('confirm-error=expired query param surfaces friendly copy', () => {
    (getSearchParam as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'confirm-error' ? 'expired' : null)
    );
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /confirmation link expired/i
    );
  });
});
