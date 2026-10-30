// What: Shared shell for auth pages — page-corner home-link wordmark above
//       a top-anchored centered card column. Wraps in the email-context
//       provider so /sign-in /sign-up /forgot-password keep typed email
//       across navigation.
// Why: The card's vertical position must stay stable across screens (sign-up
//      shorter than reset-password than forgot-password's success state) so
//      the masthead doesn't "dance" up and down. Anchoring the column top at
//      mt-3xl lets content grow downward without re-centering. The wordmark
//      sits at the page's top-left following the standard "click the brand
//      mark to go home" navigation pattern — small (15px Fraunces in
//      text-secondary) so it reads as nav chrome, not a heading competing
//      with the screen's heading-lg.
// Does NOT: Render per-screen headings — pages own their own copy.

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AuthEmailProvider } from './_email-context';

/** Page-corner home-link header above a top-anchored centered auth column. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthEmailProvider>
      {/* min-h-screen anchors layout to viewport height. p-md gives 16px
          gutters; the wordmark lives at the top-left of that gutter. */}
      <main className="flex min-h-screen flex-col bg-background p-md">
        <Link
          href="/"
          aria-label="Back to lalista landing"
          className="inline-block self-start font-display text-[15px] lowercase leading-none text-text-secondary transition-colors hover:text-text-primary"
        >
          lalista
        </Link>
        <div className="mx-auto mt-3xl w-full max-w-[400px]">{children}</div>
      </main>
    </AuthEmailProvider>
  );
}
