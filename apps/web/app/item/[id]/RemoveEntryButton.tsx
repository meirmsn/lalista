// What: Destructive "Remove from list" action — client component
// Why: Calls `deleteListEntry` then navigates back to `/list`. Isolated from
//      the page so the page stays a clean server component (no 'use client').
// Does NOT: Confirm before deleting — design-doc matches Swift (tap-to-delete,
//           realtime DELETE reconciles on other devices immediately).

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteListEntry } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';

export interface RemoveEntryButtonProps {
  entryId: string;
}

/** Button that deletes the entry and pushes back to `/list`. */
export function RemoveEntryButton({ entryId }: RemoveEntryButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   *
   */
  async function handleRemove() {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      await deleteListEntry(supabase, entryId);
      router.push('/list');
    } catch {
      setError("Couldn't remove — try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-xs">
      <button
        type="button"
        onClick={handleRemove}
        disabled={submitting}
        className="min-h-[44px] rounded-default border border-error bg-transparent px-md py-sm font-body text-[15px] font-medium text-error hover:bg-error-bg disabled:opacity-50"
      >
        {submitting ? 'Removing…' : 'Remove from list'}
      </button>
      {error && (
        <span role="alert" className="font-body text-[13px] text-error">
          {error}
        </span>
      )}
    </div>
  );
}
