// What: Unit tests for AwaitingConfirmationCard — countdown, resend, auth-event redirect.
// Why: Each behavior is load-bearing: a broken countdown lies to the user
//      about when to retry; a missing onAuthStateChange listener strands
//      the user even after they click the link. Pin them.
// Does NOT: Hit Supabase; mocks @lalista/core's onAuthStateChange and the
//           supabase.auth.resend method via the createClient mock factory.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const { replaceMock, resendMock, trackResentMock, onAuthStateChangeMock } =
  vi.hoisted(() => ({
    replaceMock: vi.fn(),
    resendMock: vi.fn(),
    trackResentMock: vi.fn(),
    onAuthStateChangeMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      resend: resendMock,
    },
  }),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return { ...actual, onAuthStateChange: onAuthStateChangeMock };
});

vi.mock('@/lib/analytics', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/analytics')>('@/lib/analytics');
  return { ...actual, trackEmailConfirmationResent: trackResentMock };
});

import { AwaitingConfirmationCard } from './AwaitingConfirmationCard';

describe('<AwaitingConfirmationCard>', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    resendMock.mockReset();
    trackResentMock.mockReset();
    onAuthStateChangeMock.mockReset();
    onAuthStateChangeMock.mockReturnValue({ unsubscribe: vi.fn() });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders the email back as <strong>{email}</strong>', () => {
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    expect(screen.getByText('alice@test.local')).toBeInTheDocument();
    expect(screen.getByText('alice@test.local').tagName).toBe('STRONG');
  });

  it('starts disabled with "Resend in 1:00" countdown', () => {
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    const button = screen.getByRole('button', { name: /resend in 1:00/i });
    expect(button).toBeDisabled();
  });

  it('countdown decrements once per second', () => {
    vi.useFakeTimers();
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByRole('button', { name: /resend in 0:59/i })
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(
      screen.getByRole('button', { name: /resend in 0:54/i })
    ).toBeInTheDocument();
  });

  it('button enables at 0; resend click calls auth.resend + trackEmailConfirmationResent', async () => {
    vi.useFakeTimers();
    resendMock.mockResolvedValue({ data: {}, error: null });
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const button = screen.getByRole('button', { name: /resend confirmation/i });
    expect(button).not.toBeDisabled();
    // Switch back to real timers before awaiting the resend promise — vitest's
    // waitFor uses real timers internally for its retry loop, so leaving fake
    // timers on after the click means the assertion never re-checks.
    vi.useRealTimers();
    fireEvent.click(button);
    await waitFor(() =>
      expect(resendMock).toHaveBeenCalledWith({
        type: 'signup',
        email: 'alice@test.local',
      })
    );
    expect(trackResentMock).toHaveBeenCalledWith({ source: 'sign-up' });
  });

  it('SIGNED_IN auth event triggers router.replace("/onboarding")', () => {
    let storedCallback: ((event: string, session: unknown) => void) | undefined;
    onAuthStateChangeMock.mockImplementation((_, cb) => {
      storedCallback = cb;
      return { unsubscribe: vi.fn() };
    });
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    act(() => {
      storedCallback?.('SIGNED_IN', { access_token: 't' });
    });
    expect(replaceMock).toHaveBeenCalledWith('/onboarding');
  });

  it('does not redirect on non-SIGNED_IN events', () => {
    let storedCallback: ((event: string, session: unknown) => void) | undefined;
    onAuthStateChangeMock.mockImplementation((_, cb) => {
      storedCallback = cb;
      return { unsubscribe: vi.fn() };
    });
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    act(() => {
      storedCallback?.('TOKEN_REFRESHED', { access_token: 't' });
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('omitting onEdit hides the "Edit and try again" affordance', () => {
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    expect(
      screen.queryByRole('button', { name: /edit and try again/i })
    ).not.toBeInTheDocument();
  });

  it('passing onEdit renders the back-link button and calls it on click', () => {
    const onEdit = vi.fn();
    render(
      <AwaitingConfirmationCard email="alice@test.local" onEdit={onEdit} />
    );
    const editButton = screen.getByRole('button', {
      name: /edit and try again/i,
    });
    fireEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  // household-collaborators chapter 1m: invite-context caption variant.
  it('renders the "your invite is saved" caption when inviteContext=true (D4 / Pass 2)', () => {
    render(
      <AwaitingConfirmationCard email="alice@test.local" inviteContext={true} />
    );
    expect(
      screen.getByTestId('awaiting-confirmation-invite-caption').textContent
    ).toMatch(/your invite is saved/i);
  });

  it('omits the invite caption when inviteContext is absent (existing behavior preserved)', () => {
    render(<AwaitingConfirmationCard email="alice@test.local" />);
    expect(
      screen.queryByTestId('awaiting-confirmation-invite-caption')
    ).toBeNull();
  });
});
