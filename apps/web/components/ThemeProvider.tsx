// What: Reads the user's OS-level color-scheme preference and toggles `.dark` on <html>
// Why: DESIGN.md ships a full dark-mode token set keyed off the `.dark` class; the
//      CSS variables switch automatically when that class is present. Users get
//      system-matched dark mode on first render with zero interaction
// Does NOT: Provide a user-facing toggle; persist a preference; override OS theme.
//           Those live in a future Settings toggle (v+). Also does NOT run SSR —
//           client-only effect keeps the initial render source-of-truth stable.

'use client';

import { useEffect } from 'react';

/**
 * Mounts once; syncs `.dark` on `<html>` with `prefers-color-scheme: dark`.
 * Subscribes to the media query for live changes (user toggling OS theme
 * mid-session). Cleans up on unmount.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark);
    };

    // Initial sync + subscribe.
    apply(mql.matches);
    const listener = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, []);

  return <>{children}</>;
}
