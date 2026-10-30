// What: Server-side magic-link exchange route handler — turns Supabase
//       recovery / signup-confirmation tokens into a session cookie and
//       redirects to the right next screen.
// Why: Supabase's email links carry a `code` query param that must be
//      exchanged server-side via exchangeCodeForSession. Doing this in a
//      route handler (vs. a client component) avoids the flash where the
//      browser briefly sees the URL with the token before the exchange
//      completes; the redirect is the page response.
// Does NOT: Validate the token shape (Supabase does); render anything (no
//           HTML body — pure 302 redirects); cache (NextResponse.redirect
//           is uncacheable per Next conventions).

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /auth/callback?code=…&type=…
 *
 * - `?type=recovery` → exchange code, then ALWAYS redirect to /reset-password
 *   (per spec D10 — even if a session already existed before the link click,
 *   the recovery flow assumes the user wants to set a new password).
 * - any other type (signup confirmation included) → exchange code, redirect
 *   to /onboarding (the onboarding RSC further routes to /list if a household
 *   already exists).
 *
 * On exchange failure, redirect back to /sign-in with an `?reset-error=expired`
 * or `?confirm-error=expired` flag so the sign-in screen can surface friendly
 * copy.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type');
  const isRecovery = type === 'recovery';

  if (!code) {
    const target = new URL(
      isRecovery
        ? '/sign-in?reset-error=expired'
        : '/sign-in?confirm-error=expired',
      origin
    );
    return NextResponse.redirect(target);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const target = new URL(
      isRecovery
        ? '/sign-in?reset-error=expired'
        : '/sign-in?confirm-error=expired',
      origin
    );
    return NextResponse.redirect(target);
  }

  // Success path — D10: recovery ALWAYS routes to /reset-password.
  if (isRecovery) {
    return NextResponse.redirect(new URL('/reset-password', origin));
  }
  // household-collaborators (D3): when the confirmation email's link
  // carries `?invite=<token>` (set via signUpWithPassword's
  // emailRedirectTo), redirect to /join/<token> so the page can run
  // accept_invite and land the new user inside the inviter's household.
  // Otherwise existing behavior — straight to /onboarding.
  const invite = searchParams.get('invite');
  if (invite) {
    return NextResponse.redirect(
      new URL(`/join/${encodeURIComponent(invite)}`, origin)
    );
  }
  return NextResponse.redirect(new URL('/onboarding', origin));
}
