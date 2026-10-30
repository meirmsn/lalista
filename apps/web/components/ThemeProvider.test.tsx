// What: Unit test for ThemeProvider — adds `.dark` class based on prefers-color-scheme
// Why: ThemeProvider is a one-effect side-effect component; all its value is in
//      the `.dark` toggle actually firing at mount
// Does NOT: Verify CSS rendering — that's a Playwright visual concern

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from './ThemeProvider';

/** Replace window.matchMedia with a controllable stub (jsdom doesn't implement it). */
function installMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (
      _event: string,
      cb: (e: MediaQueryListEvent) => void
    ) => listeners.delete(cb),
    dispatchEvent: () => false,
    addListener: () => {}, // deprecated but some polyfills check
    removeListener: () => {},
  } as unknown as MediaQueryList;

  window.matchMedia = vi.fn().mockReturnValue(mql);
  return { mql, listeners };
}

describe('<ThemeProvider>', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
    vi.restoreAllMocks();
  });

  it('does NOT add `.dark` when prefers-color-scheme is light', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('adds `.dark` when prefers-color-scheme is dark', () => {
    installMatchMedia(true);
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('reacts to live media-query changes', () => {
    const { listeners } = installMatchMedia(false);
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Simulate OS theme flipping to dark mid-session.
    for (const cb of listeners) {
      cb({ matches: true } as MediaQueryListEvent);
    }
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('renders children', () => {
    installMatchMedia(false);
    const { getByText } = render(
      <ThemeProvider>
        <span>hello</span>
      </ThemeProvider>
    );
    expect(getByText('hello')).toBeInTheDocument();
  });
});
