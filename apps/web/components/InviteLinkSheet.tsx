// What: Modal sheet displaying a freshly-created invite URL.
// Why: After tapping "invite someone" in MembersSection, the parent calls
//      `createInvite()` (which mints a token + URL) and opens this sheet.
//      It exposes a copy button (Tier B SubmitButton — uses useSubmitFeedback
//      for the "copied ✓" 1.2s success label) plus a Web Share API button
//      (feature-detected; mobile-only enhancement).
// Does NOT: Mint the invite — `inviteUrl` + `expiresAt` are passed in from
//           the parent. This component is presentational + clipboard.

'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SubmitButton, Text } from '@lalista/ui';

export interface InviteLinkSheetProps {
  url: string;
  expiresAt: string;
  onClose: () => void;
}

/** Modal sheet displaying an invite URL with copy + share affordances. */
export function InviteLinkSheet({
  url,
  expiresAt,
  onClose,
}: InviteLinkSheetProps) {
  const [mounted, setMounted] = useState(false);
  const urlRef = useRef<HTMLDivElement>(null);
  const [copying, setCopying] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [supportsShare, setSupportsShare] = useState(false);
  // D16: 1s post-success cooldown before re-enabling, on top of
  // useSubmitFeedback's idempotent submit guard.
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // queueMicrotask defer matches the project pattern (ListClient et al.) —
  // satisfies React 19's react-hooks/set-state-in-effect rule. The mount
  // happens one tick later; same observable behavior.
  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true);
      setSupportsShare(
        typeof navigator !== 'undefined' &&
          typeof navigator.share === 'function'
      );
    });
  }, []);

  // Auto-focus the URL block on mount so it's selectable immediately.
  useEffect(() => {
    if (mounted) urlRef.current?.focus();
  }, [mounted]);

  // Esc closes the sheet (matches AddItemSheet's keyboard contract).
  useEffect(() => {
    /**
     *
     */
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Cleanup cooldown on unmount.
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  if (!mounted) return null;

  /**
   *
   */
  async function handleCopy() {
    if (copying) return; // double-tap guard (D16 idempotent)
    setCopyError(null);
    setCopying(true);
    try {
      await navigator.clipboard.writeText(url);
      setCopySuccess(true);
      // D16: 1s cooldown before allowing another copy click.
      cooldownRef.current = setTimeout(() => {
        setCopySuccess(false);
        setCopying(false);
      }, 1000);
    } catch {
      setCopyError("couldn't copy — long-press the URL to select");
      setCopying(false);
    }
  }

  /**
   *
   */
  async function handleShare() {
    if (!supportsShare) return;
    try {
      await navigator.share({
        title: 'lalista invite',
        text: 'join my lalista household:',
        url,
      });
    } catch {
      // User cancellation / share unavailable — soft fail per Pass 2.
    }
  }

  const copyLabel = copySuccess ? 'copied ✓' : 'copy';
  const expiresLabel = new Date(expiresAt).toLocaleDateString();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-link-heading"
      className="fixed inset-0 z-30 flex items-end justify-center md:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        className="relative flex w-full max-w-[400px] flex-col gap-md rounded-t-lg bg-surface p-lg md:max-w-[480px] md:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <Text
            as="h2"
            id="invite-link-heading"
            variant="caption"
            className="text-text-secondary uppercase tracking-[0.08em]"
          >
            Invite link
          </Text>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-sm -mt-sm flex h-[44px] w-[44px] items-center justify-center text-text-tertiary hover:text-text-secondary"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div
          ref={urlRef}
          tabIndex={0}
          role="textbox"
          aria-readonly="true"
          aria-label={`Invite URL: ${url}`}
          className="select-all rounded-default bg-surface-2 p-md font-body text-[15px] tabular-nums break-all text-text-primary"
          data-testid="invite-link-url"
        >
          {url}
        </div>

        <SubmitButton
          type="button"
          onClick={() => void handleCopy()}
          isPending={copying && !copySuccess}
          pendingLabel="copying…"
          disabled={copying}
        >
          {copyLabel}
        </SubmitButton>

        {copyError && (
          <Text variant="caption" className="text-error">
            {copyError}
          </Text>
        )}

        {supportsShare && (
          <button
            type="button"
            onClick={() => void handleShare()}
            className="min-h-[44px] rounded-[100px] border border-border bg-transparent px-md py-sm font-body text-[15px] font-medium text-text-primary hover:bg-surface-2"
          >
            share
          </button>
        )}

        <Text variant="caption" className="text-text-tertiary text-center">
          expires {expiresLabel}. one use.
        </Text>
      </div>
    </div>,
    document.body
  );
}
