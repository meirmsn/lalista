// What: Route-protection middleware for /sign-in vs. authenticated paths
// Why: Block unauthed users from the app, redirect authed users away from /sign-in,
//      and refresh the Supabase session cookie on every request. See
//      specs/auth/spec.md § Middleware for the auth × path matrix and
//      specs/core-flows/spec.md § D7 for the `/` public-path decision.
// Does NOT: Query the database (no household check — that's /onboarding's job as a
//           server component). Does not redirect authed users off `/` — the
//           `/` RSC owns that redirect.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { assertNotProdUrlInTestEnv } from '@lalista/core';

/**
 * Paths the middleware recognizes explicitly. Everything else inherits the
 * "requires auth, pass through" behavior.
 */
const SIGN_IN_PATH = '/sign-in';

/**
 * Paths unauth visitors can reach without a redirect. Post-chapter-1l, the
 * auth flow is split across four screens (`/sign-in`, `/sign-up`,
 * `/forgot-password`, `/reset-password`) and a server-side magic-link
 * exchange route handler (`/auth/callback`); all of them must let unauth
 * (or partially-authed) traffic through. `/` is the public landing.
 */
const PUBLIC_PATHS = new Set([
  '/',
  SIGN_IN_PATH,
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
]);

/**
 * Paths from which an authed user is redirected away (to /onboarding) when
 * they hit them mid-session. Every public auth-form path EXCEPT
 * `/reset-password` and `/auth/callback`. Recovery flows arrive with a
 * session already (the callback creates it) and the whole point of
 * `/reset-password` is to set a new password — bouncing to /onboarding
 * strands the user with no way to finalize.
 */
const REDIRECT_AUTHED_PATHS = new Set(['/sign-up', '/forgot-password']);

/**
 * Next.js middleware entry point. Refreshes the Supabase session cookie and
 * routes unauthed users to `/sign-in` (preserving `next=`) and authed users
 * away from `/sign-in` into `/onboarding`.
 */
export async function middleware(request: NextRequest) {
  // Start from a mutable response so we can propagate any refreshed cookies.
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // .trim() defends against whitespace-contaminated env vars on Vercel —
  // see lib/supabase/server.ts for the 2026-04-26 SSR-500 incident note.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  assertNotProdUrlInTestEnv(url);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Reset the response so it carries the latest cookies. This is the
        // pattern recommended in @supabase/ssr docs: after any cookie write,
        // rebuild the response from scratch.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: Do NOT add logic between createServerClient() and getUser().
  // getUser() refreshes the token if needed; anything in between risks the
  // session being inconsistent with the cookies on the response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  // household-collaborators: /join/<token> is a public landing for both
  // unauth invitees (we route them to /sign-up?invite=<token>) and authed
  // users mid-flow. Prefix-match because the token segment is dynamic.
  // `/joined` (a typo) and `/join` (no token) DO NOT match — the trailing
  // slash on `/join/` is load-bearing.
  const isJoin = pathname.startsWith('/join/');
  const isPublic = isJoin || PUBLIC_PATHS.has(pathname);
  const shouldRedirectAuthed =
    pathname === SIGN_IN_PATH || REDIRECT_AUTHED_PATHS.has(pathname);

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = SIGN_IN_PATH;
    redirectUrl.searchParams.set('next', pathname + (search || ''));
    return NextResponse.redirect(redirectUrl);
  }

  if (user && shouldRedirectAuthed) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/onboarding';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip Next internals + the public-folder static assets that browsers
    // (and Gmail's image proxy, for the email-template logo) fetch
    // without a session. The trailing extension list covers every file
    // type currently in apps/web/public/ — without it, requests to
    // /lalista-email-logo.png hit the auth wall and Gmail renders the
    // blue-square placeholder in confirmation/recovery emails.
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',
  ],
};
