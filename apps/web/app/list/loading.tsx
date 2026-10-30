// What: Tier C route placeholder for /list — paints page chrome (header +
//       FAB area) immediately while ListClient resolves. Replaces the
//       blank-frame the user used to see between tap and content.
// Why: Roadmap chapter 1m / spec D1 — tap a link, get a placeholder
//      within 100ms. Page chrome paints alongside LoadingArea so the
//      user sees the page identity instantly.
// Does NOT: Render real data — that's ListClient. No spinner, no skeleton
//           rows (D3 — LoadingArea uses a quiet pulse, not content
//           silhouettes).

import { LoadingArea } from '@lalista/ui';

/**
 *
 */
export default function ListLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-md py-md">
        <span className="font-display text-[28px] font-semibold text-text-primary">
          lalista
        </span>
        <span
          aria-hidden="true"
          className="flex h-[44px] w-[44px] items-center justify-center rounded-default text-text-secondary"
        >
          <span className="font-body text-[20px]">⚙</span>
        </span>
      </header>

      <main className="flex flex-1 flex-col pb-[96px]">
        <div className="flex flex-col gap-md p-md">
          <LoadingArea label="Loading your list" className="h-[72px]" />
          <LoadingArea label="Loading your list" className="h-[72px]" />
          <LoadingArea label="Loading your list" className="h-[72px]" />
        </div>
      </main>
    </div>
  );
}
