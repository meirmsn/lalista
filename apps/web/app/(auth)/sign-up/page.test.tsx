// What: Behavior tests for the /sign-up screen — covers the four sign-up branches:
//       (a) error → friendly copy, (b) identities=[] → already-registered nudge,
//       (c) session present → /onboarding, (d) no-session → AwaitingConfirmationCard.
// Why: The branch matrix is the load-bearing logic; visual/css is not.
// Does NOT: Hit Supabase; signUpWithPassword is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { pushMock, signUpMock, searchParamsState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signUpMock: vi.fn(),
  // Mutable container so tests can flip the URL params per-case.
  searchParamsState: { current: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => searchParamsState.current,
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
    __kind: 'test-client',
    auth: { resend: vi.fn() },
  }),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    signUpWithPassword: signUpMock,
    onAuthStateChange: () => ({ unsubscribe: vi.fn() }),
  };
});

import SignUpPage from './page';
import { AuthEmailProvider } from '../_email-context';

/**
 *
 */
function renderPage() {
  return render(
    <AuthEmailProvider>
      <SignUpPage />
    </AuthEmailProvider>
  );
}

/**
 *
 */
async function fillAndSubmit(
  email = 'new@test.local',
  password = 'Hunter2pass!'
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole('button', { name: /create account/i }));
  return user;
}

describe('<SignUpPage>', () => {
  beforeEach(() => {
    pushMock.mockReset();
    signUpMock.mockReset();
    // Clear any per-test ?invite= override.
    searchParamsState.current = new URLSearchParams();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders email + password + Create account + Sign in link', () => {
    renderPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create account/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/sign-in'
    );
  });

  it('valid input calls signUpWithPassword (no displayName per D11)', async () => {
    signUpMock.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          identities: [{ id: 'i', provider: 'email' }],
        },
        session: null,
      },
      error: null,
    });
    renderPage();
    await fillAndSubmit('new@test.local', 'Hunter2pass!');

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
    expect(signUpMock).toHaveBeenCalledWith(
      expect.anything(),
      'new@test.local',
      'Hunter2pass!',
      undefined,
      undefined
    );
  });

  it('session present (auto-confirm) → router.push("/onboarding")', async () => {
    signUpMock.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          identities: [{ id: 'i', provider: 'email' }],
        },
        session: { access_token: 't', refresh_token: 'r' },
      },
      error: null,
    });
    renderPage();
    await fillAndSubmit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/onboarding'));
  });

  it('no session + identities populated → AwaitingConfirmationCard', async () => {
    signUpMock.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          identities: [{ id: 'i', provider: 'email' }],
        },
        session: null,
      },
      error: null,
    });
    renderPage();
    await fillAndSubmit('new@test.local');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /check your email/i })
      ).toBeInTheDocument()
    );
    expect(screen.getByText('new@test.local')).toBeInTheDocument();
  });

  it('no session + identities=[] (existing-account) → AwaitingConfirmationCard, no-enumeration', async () => {
    // Supabase returns the same "fake user with empty identities" shape when
    // a sign-up is attempted against an existing confirmed account. We
    // intentionally render the same AwaitingConfirmationCard as for a real
    // new user — surfacing the difference would leak account existence.
    // The existing-account user just never receives an email; they figure
    // it out via the resend countdown / Edit email affordance.
    signUpMock.mockResolvedValue({
      data: {
        user: { id: 'fake-uuid', identities: [] },
        session: null,
      },
      error: null,
    });
    renderPage();
    await fillAndSubmit('existing@test.local');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /check your email/i })
      ).toBeInTheDocument()
    );
    // Critically: NO error alert. An "already registered" message would
    // defeat the no-enumeration parity with /sign-in + /forgot-password.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('AwaitingConfirmationCard "Edit and try again" flips back to the form', async () => {
    // After a successful sign-up (auto-confirm path stubbed off via no
    // session) the card is mounted; clicking Edit and try again must reset
    // the local awaitingConfirmation state so the form re-renders. A plain
    // <Link href="/sign-up"> would no-op here since the user is already on
    // /sign-up — the bug this test pins.
    signUpMock.mockResolvedValue({
      data: {
        user: { id: 'u1', identities: [{ id: 'i', provider: 'email' }] },
        session: null,
      },
      error: null,
    });
    renderPage();
    await fillAndSubmit('typo@test.local');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /check your email/i })
      ).toBeInTheDocument()
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /edit and try again/i })
    );

    // Form is back; heading swaps to the sign-up screen's own.
    expect(
      await screen.findByRole('heading', { name: /create your account/i })
    ).toBeInTheDocument();
    // Email persisted via the auth-flow context (typo recovery surface).
    expect(screen.getByLabelText(/email/i)).toHaveValue('typo@test.local');
  });

  it('explicit error → friendly copy via AuthErrorDisplay', async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email rate limit exceeded' },
    });
    renderPage();
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i)
    );
  });

  it('email format validation blocks submit', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), 'Hunter2pass!');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('short password blocks submit with friendly nudge', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'alice@test.local');
    await user.type(screen.getByLabelText(/password/i), 'short');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /at least 8 characters/i
    );
    expect(signUpMock).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------
  // household-collaborators (chapter 1m)
  // ----------------------------------------------------------------------
  it('renders the "joining a lalista household." caption when ?invite= is in the URL', () => {
    searchParamsState.current = new URLSearchParams('?invite=tok-123');
    renderPage();
    expect(screen.getByTestId('sign-up-invite-context').textContent).toMatch(
      /joining a lalista household\./i
    );
  });

  it('omits the caption when ?invite= is absent (existing behavior preserved)', () => {
    searchParamsState.current = new URLSearchParams();
    renderPage();
    expect(screen.queryByTestId('sign-up-invite-context')).toBeNull();
  });

  it('passes ?invite=<token> as the 5th positional arg to signUpWithPassword', async () => {
    searchParamsState.current = new URLSearchParams('?invite=tok-abc');
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1' }, session: null },
      error: null,
    });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.type(screen.getByLabelText(/password/i), 'Aa1!aa1!');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(signUpMock).toHaveBeenCalled());
    // Args are (client, email, password, displayName?, inviteToken?). We
    // pass undefined as the 4th arg so displayName falls through.
    expect(signUpMock).toHaveBeenCalledWith(
      expect.anything(),
      'a@b.com',
      'Aa1!aa1!',
      undefined,
      'tok-abc'
    );
  });
});
