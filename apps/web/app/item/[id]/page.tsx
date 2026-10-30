// What: Item detail page — read-only attribute grid + destructive Remove action
// Why: Tapping a list row opens the entry's details (brand, qty, added-by,
//      added-at). v0 is read-only per design doc: users re-add-with-correction
//      as the edit model. Remove is the only write here
// Does NOT: Render purchase history — deferred to a later PR (see spec Out of scope)

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchListEntryById, type HydratedListEntry } from '@lalista/core';
import { createClient } from '@/lib/supabase/server';
import { RemoveEntryButton } from './RemoveEntryButton';

export interface ItemDetailPageProps {
  params: Promise<{ id: string }>;
}

/** Relative-time string for the "Added" row. Simple locale-friendly default. */
function formatAdded(addedAt: string): string {
  const date = new Date(addedAt);
  if (Number.isNaN(date.getTime())) return addedAt;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (sameDay) return `Today at ${time}`;
  const dateStr = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${dateStr} at ${time}`;
}

/** Read-only attribute grid for a single list entry. */
export default async function ItemDetailPage({ params }: ItemDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const entry = await fetchListEntryById(supabase, id);
  if (!entry) notFound();

  return <DetailView entry={entry} />;
}

/** Child split so TSX stays readable + tests can render it directly if needed. */
function DetailView({ entry }: { entry: HydratedListEntry }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Store', value: entry.storeName || '—' },
    { label: 'Brand', value: entry.brand ?? '—' },
    {
      label: 'Quantity',
      value:
        entry.unit && entry.quantity !== 1
          ? `${entry.quantity} ${entry.unit}`
          : entry.unit
            ? `1 ${entry.unit}`
            : String(entry.quantity),
    },
    // `addedByName` is the joined profiles.display_name when the author is
    // household-visible (migration 012). Null covers deleted users
    // (migration 009's ON DELETE SET NULL), non-household authors (RLS
    // filtered), and optimistic rows with no hydrated profile yet — all
    // render "someone" per DESIGN/UX.
    { label: 'Added by', value: entry.addedByName ?? 'someone' },
    { label: 'Added', value: formatAdded(entry.addedAt) },
  ];

  return (
    <main className="flex min-h-screen flex-col bg-background px-md py-lg">
      <Link
        href="/list"
        aria-label="Back to list"
        className="mb-md inline-flex h-[44px] w-fit items-center gap-xs rounded-default px-xs text-text-secondary hover:bg-surface-2"
      >
        <span aria-hidden="true" className="font-body text-[18px] leading-none">
          ←
        </span>
        <span className="font-body text-[15px]">back</span>
      </Link>

      <h1 className="font-display text-[28px] font-semibold text-text-primary">
        {entry.itemName}
      </h1>

      <dl className="mt-lg flex flex-col divide-y divide-border border-y border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-md py-sm"
          >
            <dt className="font-body text-[13px] uppercase tracking-[0.08em] text-text-secondary">
              {row.label}
            </dt>
            <dd className="font-body text-[15px] text-text-primary">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-xl flex">
        <RemoveEntryButton entryId={entry.id} />
      </div>
    </main>
  );
}
