// What: Store section header + children wrapper for the grouped list view
// Why: Two entries at the same store should read as one "stop"; the eye groups
//      them via the muted section header + the 1px separator
// Does NOT: Render list rows — parents compose <ListRow> children inside

import type { ReactNode } from 'react';

export interface StoreSectionProps {
  storeName: string;
  itemCount: number;
  children: ReactNode;
}

/** Section header (uppercase) + right-aligned count. */
export function StoreSection({
  storeName,
  itemCount,
  children,
}: StoreSectionProps) {
  return (
    <section aria-label={`${storeName} section`} className="flex flex-col">
      <header
        role="heading"
        aria-level={2}
        className="flex items-center justify-between border-t border-border bg-background px-md pt-lg pb-sm"
      >
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          {storeName}
        </span>
        <span className="font-body text-[13px] text-text-tertiary">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
      </header>
      <div>{children}</div>
    </section>
  );
}
