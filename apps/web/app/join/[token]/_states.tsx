// What: Colocated state-page components for /join/[token]: <InviteUnavailable>,
//       <AlreadyInHousehold>, <OwnInviteLink>. Pass 4 voice-doctrine copy +
//       Pass 5 token mapping.
// Why: D20 — these three states are page-specific, never reused outside the
//      route. Colocating them keeps the route self-contained without
//      polluting the page-level component tree in apps/web/components/.
// Does NOT: Run the accept_invite RPC — that's the page.tsx server flow.

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const containerClass =
  'flex flex-1 flex-col items-center justify-center gap-md p-xl text-center min-h-screen';
const primaryClass =
  'font-display text-[36px] font-light italic leading-[1.2] text-text-primary';
const bodyClass = 'font-body text-[17px] text-text-primary';
const captionClass = 'font-body text-[13px] text-text-tertiary';
const pillPrimaryClass =
  'mt-sm min-h-[44px] rounded-[100px] bg-primary px-md py-sm font-body text-[15px] font-medium text-white hover:bg-primary-pressed';
const pillOutlineClass =
  'min-h-[44px] rounded-[100px] border border-border bg-transparent px-md py-sm font-body text-[15px] font-medium text-text-primary hover:bg-surface-2';
const textLinkClass =
  'font-body text-[15px] text-primary hover:text-primary-pressed underline-offset-4 hover:underline';

/**
 * `<InviteUnavailable>` — token not found / used / expired. Deliberately
 * generic so we never expose invite-table internals.
 */
export function InviteUnavailable() {
  return (
    <main
      role="main"
      aria-labelledby="invite-unavailable-heading"
      className={containerClass}
    >
      <h1 id="invite-unavailable-heading" className={primaryClass}>
        that link&apos;s done
      </h1>
      <p className={bodyClass}>this invite has expired or already been used.</p>
      <p className={captionClass}>ask the sender for a new one.</p>
      <Link href="/" className={textLinkClass}>
        → go to lalista
      </Link>
    </main>
  );
}

/**
 * `<AlreadyInHousehold>` — invitee is signed in as a different user who's
 * already in another household. Offers go-to-list + sign-out-and-try-again.
 */
export function AlreadyInHousehold({
  displayName,
  onSignOut,
}: {
  displayName: string;
  onSignOut: () => void;
}) {
  const primaryRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);
  return (
    <main
      role="main"
      aria-labelledby="already-in-household-heading"
      className={containerClass}
    >
      <h1 id="already-in-household-heading" className={primaryClass}>
        you&apos;re already in a list
      </h1>
      <p className={bodyClass}>signed in as {displayName}.</p>
      <p className={captionClass}>one account, one household.</p>
      <Link href="/list" ref={primaryRef} className={pillPrimaryClass}>
        go to my list
      </Link>
      <button type="button" onClick={onSignOut} className={pillOutlineClass}>
        sign out and try again
      </button>
    </main>
  );
}

/**
 * `<OwnInviteLink>` — the inviter clicked their own link. Shows the URL +
 * copy button so they can re-share it from there.
 */
export function OwnInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  /**
   *
   */
  async function handleCopy() {
    if (copied) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Best-effort; long-press selection works as fallback.
    }
  }
  return (
    <main
      role="main"
      aria-labelledby="own-invite-link-heading"
      className={containerClass}
    >
      <h1 id="own-invite-link-heading" className={primaryClass}>
        your link
      </h1>
      <p className={bodyClass}>share it with the person you want to add.</p>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={pillPrimaryClass}
      >
        {copied ? 'copied ✓' : 'copy link'}
      </button>
      <Link href="/list" className={textLinkClass}>
        ← back to list
      </Link>
    </main>
  );
}
