// What: Unit tests for the /auth/callback route handler — every branch.
// Why: Magic-link UX is invisible to the user except via these redirects;
//      a misrouted recovery sends a user to /onboarding instead of
//      /reset-password and they can never set a new password. Pin every
//      branch.
// Does NOT: Hit Supabase; createServerClient is mocked at the lib level.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { exchangeMock } = vi.hoisted(() => ({
  exchangeMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeMock },
  }),
}));

import { GET } from './route';

/**
 *
 */
function makeRequest(qs: string) {
  return new NextRequest(new URL(`http://localhost:3000/auth/callback${qs}`));
}

describe('/auth/callback route handler', () => {
  beforeEach(() => {
    exchangeMock.mockReset();
  });

  it('?code=…&type=recovery → exchange + redirect to /reset-password', async () => {
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(makeRequest('?code=abc123&type=recovery'));
    expect(exchangeMock).toHaveBeenCalledWith('abc123');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password'
    );
  });

  it('?code=…&type=signup → exchange + redirect to /onboarding', async () => {
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(makeRequest('?code=abc123&type=signup'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/onboarding');
  });

  it('?code=… (no type) → defaults to /onboarding', async () => {
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(makeRequest('?code=abc123'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/onboarding');
  });

  it('missing code on recovery → /sign-in?reset-error=expired', async () => {
    const res = await GET(makeRequest('?type=recovery'));
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('reset-error')).toBe('expired');
  });

  it('missing code on non-recovery → /sign-in?confirm-error=expired', async () => {
    const res = await GET(makeRequest('?type=signup'));
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('confirm-error')).toBe('expired');
  });

  it('exchange error on recovery → /sign-in?reset-error=expired', async () => {
    exchangeMock.mockResolvedValue({
      data: {},
      error: { message: 'expired' },
    });
    const res = await GET(makeRequest('?code=expired&type=recovery'));
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('reset-error')).toBe('expired');
  });

  it('exchange error on signup → /sign-in?confirm-error=expired', async () => {
    exchangeMock.mockResolvedValue({
      data: {},
      error: { message: 'expired' },
    });
    const res = await GET(makeRequest('?code=expired&type=signup'));
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('confirm-error')).toBe('expired');
  });

  it('recovery redirect always lands on /reset-password (D10), even on success', async () => {
    // Pinned: even if a session was already present pre-callback (a Supabase
    // edge case), recovery type ALWAYS routes to /reset-password. The handler
    // doesn't pre-check session.
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(makeRequest('?code=fresh&type=recovery'));
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password'
    );
  });

  // household-collaborators (D3): when the confirmation email's link carries
  // ?invite=<token>, redirect to /join/<token> so the user lands inside the
  // inviter's household rather than the standalone /onboarding flow.
  it('?code=…&invite=<token> → exchange + redirect to /join/<token>', async () => {
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(makeRequest('?code=abc123&invite=tok-abc'));
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/join/tok-abc');
  });

  it('?code=…&invite=<token> with type=signup also routes to /join/<token>', async () => {
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(makeRequest('?code=abc123&type=signup&invite=t1'));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/join/t1');
  });

  it('recovery type wins over invite (security: never redirect a recovery to /join)', async () => {
    // If a malicious party crafted a recovery URL with ?invite= the handler
    // must NOT honor the invite — recovery flows are reserved for the
    // /reset-password path.
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(makeRequest('?code=abc&type=recovery&invite=bad'));
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password'
    );
  });

  it('encodes the invite token in the redirect path', async () => {
    exchangeMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(
      makeRequest('?code=abc&invite=' + encodeURIComponent('a/b+c='))
    );
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/join/a%2Fb%2Bc%3D'
    );
  });
});
