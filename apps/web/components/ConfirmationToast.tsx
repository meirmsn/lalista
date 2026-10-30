// What: Bottom-anchored confirmation toast — "Added X to Y" after a successful add
// Why: The add-item sheet closes immediately on success so the user gets a fast
//      signal that the write landed without needing to scan the list
// Does NOT: Queue multiple toasts (v0 ships one-at-a-time); persist across navigations;
//           block interaction (non-modal, aria-live="polite")

'use client';

import { useEffect } from 'react';

export interface ConfirmationToastProps {
  /** Toast body copy — e.g. "Added milk to Whole Foods". */
  message: string;
  /** Called when the auto-dismiss timer fires (or on manual dismiss). */
  onDismiss: () => void;
  /** Auto-dismiss after this many ms. Default 3000. */
  durationMs?: number;
}

/** Temporary toast — mount it under the list view when an add resolves. */
export function ConfirmationToast({
  message,
  onDismiss,
  durationMs = 3000,
}: ConfirmationToastProps) {
  useEffect(() => {
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-xl z-20 flex justify-center"
    >
      <div className="pointer-events-auto max-w-[24rem] rounded-default bg-text-primary px-md py-sm font-body text-[14px] text-background shadow-lg">
        {message}
      </div>
    </div>
  );
}
