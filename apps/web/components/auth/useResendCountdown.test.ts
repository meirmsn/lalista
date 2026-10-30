// What: Unit tests for useResendCountdown — the shared 60s timer pulled out of
//       AwaitingConfirmationCard + /forgot-password (Gate 5 /simplify).
// Why: The hook is load-bearing: a broken cleanup leaks intervals across
//      mount/unmount; a broken `active` gate would turn the forgot-password
//      success state into a self-tickling timer that never settles.
// Does NOT: Render a component (renderHook only); test the surrounding UI
//           (AwaitingConfirmationCard.test.tsx + forgot-password specs handle
//           the wiring assertions).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  formatCountdown,
  RESEND_COUNTDOWN_SECONDS,
  useResendCountdown,
} from './useResendCountdown';

describe('formatCountdown', () => {
  it('formats < 1 minute as 0:SS with leading-zero seconds', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(45)).toBe('0:45');
    expect(formatCountdown(7)).toBe('0:07');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('useResendCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at the full duration and counts down to 0 once active', () => {
    const { result } = renderHook(() => useResendCountdown(true));
    expect(result.current.secondsRemaining).toBe(RESEND_COUNTDOWN_SECONDS);
    expect(result.current.canResend).toBe(false);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.secondsRemaining).toBe(0);
    expect(result.current.canResend).toBe(true);
  });

  it('does not tick when active=false (gates the forgot-password "sent" state)', () => {
    const { result } = renderHook(() => useResendCountdown(false));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.secondsRemaining).toBe(RESEND_COUNTDOWN_SECONDS);
  });

  it('resumes counting when active flips false → true', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useResendCountdown(active),
      { initialProps: { active: false } }
    );
    expect(result.current.secondsRemaining).toBe(RESEND_COUNTDOWN_SECONDS);

    rerender({ active: true });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.secondsRemaining).toBe(RESEND_COUNTDOWN_SECONDS - 3);
  });

  it('reset() restores the full duration and re-arms canResend=false', () => {
    const { result } = renderHook(() => useResendCountdown(true));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.canResend).toBe(true);

    act(() => {
      result.current.reset();
    });
    expect(result.current.secondsRemaining).toBe(RESEND_COUNTDOWN_SECONDS);
    expect(result.current.canResend).toBe(false);
  });

  it('honors a custom durationSeconds argument', () => {
    const { result } = renderHook(() => useResendCountdown(true, 10));
    expect(result.current.secondsRemaining).toBe(10);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.canResend).toBe(true);
  });
});
