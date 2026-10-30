// What: Tests for the auth-event → analytics wiring in <Providers>.
// Why: The fresh-account detection (auth_signed_up vs. auth_signed_in) is
//      load-bearing for the activation funnel; pin the created_at proximity
//      window so a refactor can't silently break the split.
// Does NOT: Initialize PostHog (mocked); test session-duration math
//           (already covered indirectly by track* tests).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const {
  trackSignedInMock,
  trackSignedUpMock,
  trackSignedOutMock,
  onAuthStateChangeMock,
} = vi.hoisted(() => ({
  trackSignedInMock: vi.fn(),
  trackSignedUpMock: vi.fn(),
  trackSignedOutMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: { init: vi.fn(), capture: vi.fn() },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ __kind: 'test-client' }),
}));

vi.mock('@/lib/analytics', () => ({
  trackSignedIn: trackSignedInMock,
  trackSignedUp: trackSignedUpMock,
  trackSignedOut: trackSignedOutMock,
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return { ...actual, onAuthStateChange: onAuthStateChangeMock };
});

import { Providers } from './providers';

type Cb = (event: string, session: unknown) => void;

/**
 *
 */
function captureCallback(): Cb {
  let cb: Cb | undefined;
  onAuthStateChangeMock.mockImplementation((_, fn: Cb) => {
    cb = fn;
    return { unsubscribe: vi.fn() };
  });
  render(<Providers>child</Providers>);
  return cb!;
}

describe('<Providers> auth-event → analytics wiring', () => {
  beforeEach(() => {
    trackSignedInMock.mockReset();
    trackSignedUpMock.mockReset();
    trackSignedOutMock.mockReset();
    onAuthStateChangeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SIGNED_IN with fresh user.created_at fires trackSignedUp (not trackSignedIn)', () => {
    const cb = captureCallback();
    cb('SIGNED_IN', {
      access_token: 't',
      expires_at: 1,
      expires_in: 1,
      user: { created_at: new Date().toISOString() },
    });
    expect(trackSignedUpMock).toHaveBeenCalledWith('email');
    expect(trackSignedInMock).not.toHaveBeenCalled();
  });

  it('SIGNED_IN with old user.created_at fires trackSignedIn (not trackSignedUp)', () => {
    const cb = captureCallback();
    const aLongTimeAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();
    cb('SIGNED_IN', {
      access_token: 't',
      expires_at: 1,
      expires_in: 1,
      user: { created_at: aLongTimeAgo },
    });
    expect(trackSignedInMock).toHaveBeenCalledWith('email');
    expect(trackSignedUpMock).not.toHaveBeenCalled();
  });

  it('SIGNED_IN without user.created_at falls back to trackSignedIn', () => {
    const cb = captureCallback();
    cb('SIGNED_IN', {
      access_token: 't',
      expires_at: 1,
      expires_in: 1,
      user: {},
    });
    expect(trackSignedInMock).toHaveBeenCalledWith('email');
    expect(trackSignedUpMock).not.toHaveBeenCalled();
  });

  it('SIGNED_OUT fires trackSignedOut with elapsed seconds', () => {
    const cb = captureCallback();
    cb('SIGNED_IN', {
      access_token: 't',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      user: { created_at: new Date().toISOString() },
    });
    cb('SIGNED_OUT', null);
    expect(trackSignedOutMock).toHaveBeenCalledTimes(1);
    expect(trackSignedOutMock.mock.calls[0]![0]).toBeGreaterThanOrEqual(0);
  });
});
