// What: Client-side providers — PostHog analytics init + auth event forwarding
// Why: PostHog must be initialized client-side only; the auth subscription lives
//      here so the wiring happens exactly once per browser session regardless of
//      which page is mounted
// Does NOT: Initialize Sentry — that's handled by sentry.client.config.ts

'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';
import { onAuthStateChange } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { trackSignedIn, trackSignedOut, trackSignedUp } from '@/lib/analytics';

// First-ever SIGNED_IN window — accounts whose created_at is within this
// many seconds of the SIGNED_IN event are counted as sign-ups, not sign-ins.
// Generous to absorb confirmation-email round-trip latency (the user might
// take a few minutes to click the link); tighter than 1 hour so a user who
// signs out + back in 30 minutes after creating doesn't get a double-fire.
const SIGN_UP_DETECTION_WINDOW_SECONDS = 600; // 10 minutes

/** Initializes PostHog, subscribes to auth state, and wraps children. */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (key) {
      posthog.init(key, {
        api_host: 'https://us.i.posthog.com',
        capture_pageview: true,
        capture_pageleave: true,
      });
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    // Supabase fires SIGNED_IN on both fresh sign-ins and the autologin that
    // follows a signup, so one event covers both funnels.
    // Track the session issue time across SIGNED_IN → SIGNED_OUT so we can
    // compute duration. We can't rely on the `session` argument to SIGNED_OUT
    // (it can be null once Supabase clears local state), and Session doesn't
    // expose `created_at` — so derive issuedAt = expires_at - expires_in.
    let sessionStartMs: number | null = null;
    const subscription = onAuthStateChange(supabase, (event, session) => {
      if (event === 'SIGNED_IN') {
        if (session?.expires_at != null && session.expires_in != null) {
          sessionStartMs = (session.expires_at - session.expires_in) * 1000;
        } else {
          sessionStartMs = Date.now();
        }
        // Distinguish first-ever sign-in (sign-up funnel exit) from
        // subsequent sign-ins (returning user). Supabase's `user.created_at`
        // is the account-creation timestamp; a SIGNED_IN within the
        // detection window of created_at is the post-confirmation moment
        // for a brand-new user.
        const createdAt = session?.user?.created_at
          ? new Date(session.user.created_at).getTime()
          : null;
        const isFreshAccount =
          createdAt != null &&
          Date.now() - createdAt <= SIGN_UP_DETECTION_WINDOW_SECONDS * 1000;
        if (isFreshAccount) {
          trackSignedUp('email');
        } else {
          trackSignedIn('email');
        }
      } else if (event === 'SIGNED_OUT') {
        const elapsed = sessionStartMs
          ? Math.max(0, Math.round((Date.now() - sessionStartMs) / 1000))
          : 0;
        trackSignedOut(elapsed);
        sessionStartMs = null;
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return <>{children}</>;
}
