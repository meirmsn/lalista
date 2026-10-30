// What: Unit tests for useSubmitFeedback — 250ms threshold + cleanup +
//       multi-cycle reuse.
// Why: Threshold timing is the load-bearing UX behavior — every Tier B
//      affordance depends on the spinner not flashing for fast submits
//      and on the spinner arriving when the network genuinely takes
//      >250ms. Cleanup correctness prevents timer leaks across renders.
// Does NOT: Render any component — that's SubmitButton.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSubmitFeedback } from './useSubmitFeedback';

describe('useSubmitFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns showSpinner=false initially when not pending', () => {
    const { result } = renderHook(({ p }) => useSubmitFeedback(p), {
      initialProps: { p: false },
    });
    expect(result.current.showSpinner).toBe(false);
  });

  it('keeps showSpinner=false at 249ms (just under threshold)', () => {
    const { result } = renderHook(({ p }) => useSubmitFeedback(p), {
      initialProps: { p: true },
    });
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current.showSpinner).toBe(false);
  });

  it('flips showSpinner=true at exactly 250ms', () => {
    const { result } = renderHook(({ p }) => useSubmitFeedback(p), {
      initialProps: { p: true },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.showSpinner).toBe(true);
  });

  it('cancels the threshold timer when isPending flips back fast', () => {
    const { result, rerender } = renderHook(({ p }) => useSubmitFeedback(p), {
      initialProps: { p: true },
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ p: false });
    // Even past the original 250ms threshold, no spinner — cancel landed first.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.showSpinner).toBe(false);
  });

  it('resets showSpinner via cleanup when isPending: true → false (post-threshold)', () => {
    const { result, rerender } = renderHook(({ p }) => useSubmitFeedback(p), {
      initialProps: { p: true },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.showSpinner).toBe(true);
    rerender({ p: false });
    // Cleanup ran the functional setShowSpinner(false).
    expect(result.current.showSpinner).toBe(false);
  });

  it('multi-cycle: each new pending cycle starts a fresh threshold (load-bearing functional setState behavior)', () => {
    const { result, rerender } = renderHook(({ p }) => useSubmitFeedback(p), {
      initialProps: { p: false },
    });
    // Cycle 1
    rerender({ p: true });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.showSpinner).toBe(true);
    rerender({ p: false });
    expect(result.current.showSpinner).toBe(false);

    // Cycle 2 — threshold restarts
    rerender({ p: true });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.showSpinner).toBe(false);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.showSpinner).toBe(true);
  });

  it('respects custom thresholdMs option', () => {
    const { result } = renderHook(
      ({ p }) => useSubmitFeedback(p, { thresholdMs: 500 }),
      {
        initialProps: { p: true },
      }
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.showSpinner).toBe(false);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.showSpinner).toBe(true);
  });

  it('does not leak timer when component unmounts mid-pending', () => {
    const { result, unmount } = renderHook(({ p }) => useSubmitFeedback(p), {
      initialProps: { p: true },
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    unmount();
    // No errors when remaining timers fire (or get cleared).
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.showSpinner).toBe(false);
  });
});
