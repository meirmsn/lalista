// What: Tier C route placeholder for /item/[id] — paints back-link chrome
//       + LoadingArea where the attribute grid will render.
// Why: Spec D1 — tap a list row, get a placeholder within 100ms. The
//      back-link is the page chrome that paints alongside.
// Does NOT: Render the entry's data — that's the page itself.

import Link from 'next/link';
import { LoadingArea } from '@lalista/ui';

/**
 *
 */
export default function ItemDetailLoading() {
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
      <LoadingArea label="Loading item details" className="h-[40px] w-2/3" />
      <LoadingArea label="Loading item details" className="mt-lg h-[280px]" />
    </main>
  );
}
