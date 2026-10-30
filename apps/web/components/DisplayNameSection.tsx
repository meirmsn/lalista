// What: Thin client wrapper around DisplayNameField that owns the Supabase
//       client + toast on failure
// Why: Settings is an RSC, but DisplayNameField needs a browser Supabase
//      client to call updateMyProfile. This component bridges the boundary
//      without teaching DisplayNameField about Supabase
// Does NOT: Re-fetch the current profile — Settings is the authoritative
//           read; this component only writes

'use client';

import { useState } from 'react';
import { updateMyProfile } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { ConfirmationToast } from './ConfirmationToast';
import { DisplayNameField } from './DisplayNameField';

export interface DisplayNameSectionProps {
  /** Current `profiles.display_name` loaded server-side. */
  initialValue: string;
}

/** Inline Settings section: wraps DisplayNameField with save + error toast. */
export function DisplayNameSection({ initialValue }: DisplayNameSectionProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** Invoke `updateMyProfile`; return the trimmed server value. */
  async function handleSave(value: string): Promise<string> {
    const supabase = createClient();
    const updated = await updateMyProfile(supabase, value);
    return updated.display_name;
  }

  /** Bubbled from DisplayNameField when save rejects. */
  function handleError() {
    setErrorMessage("Couldn't save your name. Check your connection.");
  }

  return (
    <>
      <DisplayNameField
        initialValue={initialValue}
        onSave={handleSave}
        onError={handleError}
      />
      {errorMessage && (
        <ConfirmationToast
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />
      )}
    </>
  );
}
