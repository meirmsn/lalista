// What: Unit tests for the auth middleware's 4-cell matrix (auth × path) + matcher
// Why: Middleware is the single choke point that keeps unauthed users out of the
//      app; regressions here are invisible in pages and only show up in prod
// Does NOT: Hit the real Supabase API — the client is fully mocked

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pathToRegexp } from './middleware.test.helpers';

const getUserMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

import { middleware, config as middlewareConfig } from './middleware';

/** Build a NextRequest for `pathname` against the local origin. */
function makeRequest(pathname: string) {
  return new NextRequest(new URL(`http://localhost:3000${pathname}`));
}

describe('middleware (auth × path matrix)', () => {
  beforeEach(() => {
    getUserMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('unauthed request to /: passes through (public landing per D7)', async () => {
    // Post-D7 (specs/core-flows/spec.md), `/` is a public landing — unauth
    // visitors see the marketing screen instead of a redirect to sign-in.
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await middleware(makeRequest('/'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('unauthed request to /list: redirects to /sign-in with next= preserved', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await middleware(makeRequest('/list'));

    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('next')).toBe('/list');
  });

  it('unauthed request to /item/e-1: redirects to /sign-in with next= preserved', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await middleware(makeRequest('/item/e-1'));

    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('next')).toBe('/item/e-1');
  });

  it('unauthed request to /sign-in: passes through (no redirect loop)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await middleware(makeRequest('/sign-in'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('authed request to /sign-in: redirects to /onboarding', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });

    const res = await middleware(makeRequest('/sign-in'));

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(new URL(location!).pathname).toBe('/onboarding');
  });

  // Post-chapter-1l: each new public path must (a) pass through unauth
  // and (b) decide independently whether to redirect authed users.
  it.each([
    '/sign-up',
    '/forgot-password',
    '/reset-password',
    '/auth/callback',
  ] as const)(
    'unauthed request to %s passes through (no redirect loop)',
    async (path) => {
      getUserMock.mockResolvedValue({ data: { user: null } });
      const res = await middleware(makeRequest(path));
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    }
  );

  it('authed request to /sign-up: redirects to /onboarding', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await middleware(makeRequest('/sign-up'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/onboarding');
  });

  it('authed request to /forgot-password: redirects to /onboarding', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await middleware(makeRequest('/forgot-password'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/onboarding');
  });

  it('authed request to /reset-password: passes through (recovery flow needs the screen)', async () => {
    // Recovery flow: the user clicked an email link → /auth/callback
    // exchanged the code → session is now live → redirected here. Bouncing
    // to /onboarding would strand them with no way to set a new password.
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await middleware(makeRequest('/reset-password'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('authed request to /auth/callback: passes through (handler does the redirect itself)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await middleware(makeRequest('/auth/callback?code=abc'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('authed request to /: passes through (household gate is /onboarding, not middleware)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });

    const res = await middleware(makeRequest('/'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('authed request to /onboarding: passes through so the server component can render', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });

    const res = await middleware(makeRequest('/onboarding'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  // ----------------------------------------------------------------------
  // T11 (household-collaborators) — /join/ allow-list.
  // ----------------------------------------------------------------------
  it('unauthed request to /join/abc-123: passes through (public, prefix-matched)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/join/abc-123'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('unauthed request to /join/anything-with-hyphens-and-base64url_chars: passes through', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(
      makeRequest('/join/abc-_DEF1234567890abcdef1234567')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('unauthed request to /joined (typo, single segment, no slash) gets /sign-in?next=…', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/joined'));
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('next')).toBe('/joined');
  });

  it('unauthed request to /join (no trailing slash, no token segment) gets /sign-in?next=…', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/join'));
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get('location')!);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('next')).toBe('/join');
  });

  it('authed request to /join/abc-123: passes through (page handles the flow internally)', async () => {
    // /join/<token> is NOT in REDIRECT_AUTHED_PATHS — authed users mid-flow
    // hit the page, which decides between accept_invite / <OwnInviteLink> /
    // <AlreadyInHousehold>.
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await middleware(makeRequest('/join/abc-123'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('middleware matcher', () => {
  const matcher = middlewareConfig.matcher[0];

  it('excludes _next/static, _next/image, favicon.ico, manifest.json, icons from matching', () => {
    const re = pathToRegexp(matcher);
    expect(re.test('/_next/static/chunks/main.js')).toBe(false);
    expect(re.test('/_next/image?url=foo')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
    expect(re.test('/manifest.json')).toBe(false);
    expect(re.test('/icons/icon-512.png')).toBe(false);
  });

  it('excludes root-level public-image assets (regression: Gmail proxy hit auth wall on email logo before this exclusion)', () => {
    const re = pathToRegexp(matcher);
    expect(re.test('/lalista-email-logo.png')).toBe(false);
    expect(re.test('/apple-touch-icon.png')).toBe(false);
    expect(re.test('/icon-192.png')).toBe(false);
    expect(re.test('/icon-512.png')).toBe(false);
    expect(re.test('/icon.svg')).toBe(false);
    // Common image extensions any future template/asset might use:
    expect(re.test('/whatever.jpg')).toBe(false);
    expect(re.test('/whatever.jpeg')).toBe(false);
    expect(re.test('/whatever.gif')).toBe(false);
    expect(re.test('/whatever.webp')).toBe(false);
    expect(re.test('/whatever.ico')).toBe(false);
  });

  it('matches app routes', () => {
    const re = pathToRegexp(matcher);
    expect(re.test('/')).toBe(true);
    expect(re.test('/sign-in')).toBe(true);
    expect(re.test('/onboarding')).toBe(true);
    expect(re.test('/list/abc')).toBe(true);
  });
});
