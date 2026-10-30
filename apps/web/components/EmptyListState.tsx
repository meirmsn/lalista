// What: Empty-state block for the list view — Fraunces italic + terracotta CTA
// Why: First-launch moment; the copy sets the bilingual tone of the product
// Does NOT: Render the FAB (parent handles FAB visibility independently)

'use client';

export interface EmptyListStateProps {
  /** Fires when the CTA is tapped — parent opens the add-item sheet. */
  onAddFirst: () => void;
}

/** Centered empty state for a brand-new household's list. */
export function EmptyListState({ onAddFirst }: EmptyListStateProps) {
  return (
    <div
      data-testid="empty-list-state"
      className="flex flex-1 flex-col items-center justify-center gap-md p-xl text-center"
    >
      <p className="font-display text-[36px] font-light italic leading-[1.2] text-text-primary">
        la lista está vacía
      </p>
      <p className="font-body text-[17px] text-text-secondary">
        (the list is empty)
      </p>
      <button
        type="button"
        onClick={onAddFirst}
        className="mt-sm min-h-[44px] rounded-[100px] bg-primary px-md py-sm font-body text-[15px] font-medium text-white hover:bg-primary-pressed"
      >
        Add your first item
      </button>
    </div>
  );
}
