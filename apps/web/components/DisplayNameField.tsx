// What: Inline editable "Your name" field for Settings, debounced-save +
//       optimistic UI via useOptimisticMutation (Tier A1).
// Why: Settings is the authoritative home for display_name edits. A debounced
//      save (300ms on blur OR after typing-pause) matches spec D17 and avoids
//      a spray of writes on every keystroke. Tier A1 (D1, D10) — visual
//      change instant; on RPC error the field reverts to the prior value
//      and the parent's onError callback surfaces a toast/inline message.
// Does NOT: Render the toast itself — the parent surfaces errors via its own
//           toast primitive. This component stays presentational-plus-save.

'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Input, Text, useOptimisticMutation } from '@lalista/ui';

export interface DisplayNameFieldProps {
  /** Initial display_name from `profiles.display_name`. Empty string also accepted
   *  for defensive use, but the DB column is NOT NULL so this should always be
   *  a non-empty string in practice. */
  initialValue: string;
  /** Called with the trimmed value when the debounced save fires. Must return
   *  a promise that resolves with the persisted value (for a round-trip
   *  optimistic rollback). */
  onSave: (value: string) => Promise<string>;
  /** Called when `onSave` rejects. Parent surfaces a toast + whatever recovery
   *  it deems right (today: revert to the previous value). */
  onError?: (err: unknown) => void;
  /** Override for the debounce window. Defaults to 300ms per spec D17. */
  debounceMs?: number;
  /** Override for the input's DOM `id`. Required when two `DisplayNameField`s
   *  render in the same page (Settings: Account display-name + Household
   *  household-name) so `<label htmlFor>` association resolves to the right
   *  input. Default `display-name` preserves single-instance call sites. */
  inputId?: string;
  /** Override for the visible field label. Required when two `DisplayNameField`s
   *  render in the same page so screen readers + test accessible-name selectors
   *  can disambiguate (spec D14: HouseholdSection uses "Household name").
   *  Default `Your name` preserves single-instance call sites. */
  label?: string;
}

/**
 * Debounced editable display-name field. Uses inline setTimeout + ref cleanup
 * (no external debounce dependency — matches `ConfirmationToast`'s pattern).
 * Trims whitespace before saving; no-ops when the trimmed value equals the
 * last-saved one so rapid edits that end at the same place don't write.
 *
 * Persistence runs through useOptimisticMutation with failureMode: 'rollback'
 * (Tier A1) — the field shows the user's typed value optimistically, and on
 * error the rollback restores the previous value (queueMicrotask-deferred so
 * the optimistic frame paints before the rollback's setState; gotcha 1).
 */
export function DisplayNameField({
  initialValue,
  onSave,
  onError,
  debounceMs = 300,
  inputId = 'display-name',
  label = 'Your name',
}: DisplayNameFieldProps) {
  const [value, setValue] = useState(initialValue);
  // Holds the last successfully-persisted value so we can detect no-op saves
  // and roll back on error.
  const lastSavedRef = useRef(initialValue);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The rollback callback in useOptimisticMutation takes no args (it's the
  // generic rollback contract — no error surface). We stash the error
  // inside mutate's try/catch and surface it to the parent's onError
  // from the rollback handler.
  const lastErrorRef = useRef<unknown>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Tier A1 mutation: applyOptimistic is a no-op (the field already shows
  // the user's typed value via local state); mutate persists; rollback
  // restores to the last-saved value + invokes onError with the captured
  // error (queueMicrotask-deferred inside the hook so the optimistic
  // frame paints first).
  const save = useOptimisticMutation<{ trimmed: string }, string>({
    applyOptimistic: () => {
      // The Input's value === local `value` state already shows the user's
      // typed text — no additional optimistic state to commit here.
      lastErrorRef.current = null;
    },
    mutate: async ({ trimmed }) => {
      try {
        const saved = await onSave(trimmed);
        lastSavedRef.current = saved;
        if (saved !== trimmed) setValue(saved);
        return saved;
      } catch (err) {
        lastErrorRef.current = err;
        throw err;
      }
    },
    onFailure: {
      failureMode: 'rollback',
      rollback: () => {
        setValue(lastSavedRef.current);
        const err = lastErrorRef.current;
        lastErrorRef.current = null;
        if (err !== null && onErrorRef.current) {
          onErrorRef.current(err);
        }
      },
    },
  });

  /** Clear any in-flight debounce. Used on unmount + before re-scheduling. */
  function clearPending() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  /** Persist `next`; no-op when it equals the last-saved value. */
  async function commit(next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    await save.run({ trimmed });
  }

  /** Reset the debounce on every keystroke; fire after `debounceMs` of quiet. */
  function scheduleCommit(next: string) {
    clearPending();
    timeoutRef.current = setTimeout(() => {
      void commit(next);
    }, debounceMs);
  }

  /** On blur: flush any pending debounce + save immediately. */
  function handleBlur() {
    clearPending();
    void commit(value);
  }

  /**
   *
   */
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setValue(next);
    scheduleCommit(next);
  }

  // Clean up the timer on unmount to avoid firing a save after the tree is
  // gone (would try to touch state on an unmounted component).
  useEffect(() => {
    return () => clearPending();
  }, []);

  return (
    <label className="flex flex-col gap-xs" htmlFor={inputId}>
      <Text as="span" variant="caption" className="text-text-secondary">
        {label}
      </Text>
      <Input
        id={inputId}
        type="text"
        autoComplete="name"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-busy={save.isPending}
        // Mirrors the CHECK(char_length <= 80) constraint in migration 012.
        // Server-side bound is authoritative; this is the UX polish so the
        // field can't silently accept an over-long string that will error
        // on save. Matches the sign-up form's display-name bound.
        maxLength={80}
      />
    </label>
  );
}
