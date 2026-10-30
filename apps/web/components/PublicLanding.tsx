// What: Public landing — wordmark + tagline + primary "Create account" CTA + secondary "Sign in"
// Why: Authed users get redirected from `/` to `/list` via RSC. Unauth visitors
//      need a first-impression screen that introduces the product and routes
//      them to either sign-up (primary; first-time visitors are the target)
//      or sign-in (secondary; returning visitors). Two CTAs because the auth
//      surfaces are now split (chapter 1l).
// Does NOT: Contain any interactivity beyond the <Link>s; does not check auth
//           (the parent RSC does that before rendering this).

import Link from 'next/link';

/** Centered single-screen landing — wordmark, canonical byline, paired CTAs.
 *
 * The byline is the brag-register canonical example in
 * `DESIGN.md § Copy & Voice § Canonical voice examples` — doctrine, not
 * placeholder copy. */
export function PublicLanding() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-md bg-background p-xl text-center">
      <h1 className="font-display text-[36px] font-normal leading-[1.1] text-text-primary md:text-[48px]">
        lalista
      </h1>
      <p className="font-body text-[17px] text-text-secondary md:text-[20px]">
        groceries on a word.
      </p>
      <div className="mt-sm flex flex-col items-center gap-xs">
        <Link
          href="/sign-up"
          className="inline-flex min-h-[44px] items-center justify-center rounded-[100px] bg-primary px-lg py-sm font-body text-[15px] font-medium text-white hover:bg-primary-pressed"
        >
          Create account
        </Link>
        <Link
          href="/sign-in"
          className="font-body text-[15px] text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
