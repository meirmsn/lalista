// What: Tier C latency-feedback primitive — pulsing empty container that
//       paints inside a route's loading.tsx while the page resolves.
// Why: Route transitions to /list, /item/[id], /settings, /(auth)/onboarding
//      need a "page chrome paints, content area soft-pulses" affordance.
//      Vanilla Tailwind animate-pulse on bg-muted/40 (D3) — quieter than
//      content-shaped placeholder bars or a shimmer; matches lalista's
//      voice and avoids designing a placeholder per page.
// Does NOT: Render a spinner, skeleton bars, or content silhouettes.

import type { ReactNode } from 'react';

export interface LoadingAreaProps {
  /** ARIA label for the busy region. Defaults to "Loading". */
  label?: string;
  /** Tailwind class overrides for the pulse block. */
  className?: string;
  /** Optional layout-shape children rendered inside the pulse. */
  children?: ReactNode;
}

/**
 * Tier C empty-container primitive — `animate-pulse` on `bg-muted/40`.
 *
 * Use inside a route's `loading.tsx` for the content area; the route's
 * page chrome (header / FAB / etc.) renders alongside this so the user
 * sees the page frame instantly while content resolves.
 */
export function LoadingArea({
  label = 'Loading',
  className = '',
  children,
}: LoadingAreaProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="loading-area"
      className={`w-full animate-pulse rounded-default bg-surface-2/60 ${className}`}
    >
      {children}
      <span className="sr-only">{label}</span>
    </div>
  );
}
