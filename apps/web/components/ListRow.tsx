// What: Single list-entry row — buy button, clickable body, menu affordance
// Why: Three-line hierarchy from the Swift design; buy + delete + detail-nav are
//      the three interactions a user can take on a row
// Does NOT: Talk to Supabase directly — parents own the mutation callbacks so
//           realtime reconciliation stays in one place

'use client';

import Link from 'next/link';
import type { HydratedListEntry } from '@lalista/core';

export interface ListRowProps {
  entry: HydratedListEntry;
  /** Fires when the user taps the buy button. Parent optimistically updates + fades. */
  onBuy: (entry: HydratedListEntry) => void;
  /** Fires when the user taps the overflow Remove action. */
  onRemove: (entry: HydratedListEntry) => void;
  /**
   * Optimistic "being-bought" marker — while the row is fading out, render
   * at reduced opacity and disable interactions. Parent owns the state so
   * the fade survives a re-render triggered by realtime DELETE.
   */
  isBuying?: boolean;
}

/** Build the secondary detail line (brand + quantity + unit). Omits empty pieces. */
function secondaryLine(entry: HydratedListEntry): string {
  const parts: string[] = [];
  if (entry.brand) parts.push(entry.brand);
  const qtyPart =
    entry.unit && entry.quantity !== 1
      ? `${entry.quantity} ${entry.unit}`
      : entry.unit
        ? `1 ${entry.unit}`
        : entry.quantity !== 1
          ? `${entry.quantity}`
          : '1 unit';
  parts.push(qtyPart);
  return parts.join(' · ');
}

// PR 4 (posted-by-someone): `entry.addedByName` is populated via the profiles
// join in `fetchListEntries` when the author is a household-member visible to
// the reader. Null is the fallback case — covers (a) pre-migration-009 null
// `added_by` (ON DELETE SET NULL), (b) non-household authors that RLS filters
// out, and (c) optimistic/realtime-only rows that haven't been re-hydrated.
// Rendering stays "added by someone" in all three.
/**
 *
 */
function addedByLabel(name: string | null): string {
  return `added by ${name ?? 'someone'}`;
}

/** Row — semantic link on the body, action buttons alongside. */
export function ListRow({ entry, onBuy, onRemove, isBuying }: ListRowProps) {
  const attribution = addedByLabel(entry.addedByName);
  const aria = `${entry.itemName}${entry.brand ? `, ${entry.brand}` : ''}, ${entry.storeName}, ${attribution}`;
  return (
    <div
      className={`flex items-start gap-sm border-b border-border px-md py-sm transition-opacity duration-[var(--duration-short)] ${
        isBuying ? 'pointer-events-none opacity-50' : 'opacity-100'
      }`}
      data-testid={`list-row-${entry.id}`}
    >
      <button
        type="button"
        onClick={() => onBuy(entry)}
        aria-label={`Mark ${entry.itemName} as bought`}
        disabled={isBuying}
        className="mt-[2px] flex h-[44px] w-[44px] flex-none items-center justify-center rounded-[100px] border border-border text-text-secondary hover:bg-surface-2"
      >
        <span
          aria-hidden="true"
          className="h-[20px] w-[20px] rounded-[100px] border border-text-secondary"
        />
      </button>

      <Link
        href={`/item/${entry.id}`}
        aria-label={aria}
        className="flex flex-1 flex-col gap-[2px] py-xs"
      >
        <span className="font-body text-[15px] font-medium text-text-primary">
          {entry.itemName}
        </span>
        <span className="font-body text-[13px] text-text-secondary">
          {secondaryLine(entry)}
        </span>
        <span className="font-body text-[13px] italic text-text-secondary">
          {attribution}
        </span>
      </Link>

      <button
        type="button"
        onClick={() => onRemove(entry)}
        aria-label={`Remove ${entry.itemName} from list`}
        className="mt-[2px] flex h-[44px] w-[44px] flex-none items-center justify-center rounded-default text-text-secondary hover:bg-surface-2"
      >
        <span aria-hidden="true" className="font-body text-[20px] leading-none">
          ⋯
        </span>
      </button>
    </div>
  );
}
