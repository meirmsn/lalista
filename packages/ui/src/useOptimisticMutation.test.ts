// What: Unit tests for useOptimisticMutation — happy path, rollback mode,
//       banner-mode retry sequence with [1s, 3s, 7s] backoff, hard-error
//       bypass-of-retries, retry button replay, undo button rollback.
// Why: This is the most complex new primitive in app-snappiness. The
//      retry budget + the rollback-after-paint ordering are spec
//      invariants — if either drifts, every Tier A surface in the app
//      breaks. Tests pin both behaviors.
// Does NOT: Render any component — caller wires banner state to UI.
//
// Note on async-act + fake timers: vi.useFakeTimers() makes `waitFor`
// time out (it polls on real time). We use act() + Promise.resolve()
// flushing instead, plus vi.advanceTimersByTimeAsync() for retry waits.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOptimisticMutation } from './useOptimisticMutation';

/** Flush a couple of microtask ticks. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useOptimisticMutation', () => {
  describe('happy path', () => {
    it('applies optimistic, awaits mutate, clears isPending', async () => {
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();
      const mutate = vi.fn().mockResolvedValue('ok');

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: { failureMode: 'rollback', rollback },
        })
      );

      await act(async () => {
        await result.current.run({ id: 'a' });
      });

      expect(applyOptimistic).toHaveBeenCalledWith({ id: 'a' });
      expect(mutate).toHaveBeenCalledWith({ id: 'a' });
      expect(rollback).not.toHaveBeenCalled();
      expect(result.current.isPending).toBe(false);
      expect(result.current.banner).toBeNull();
    });
  });

  describe('rollback mode (Tier A1)', () => {
    it('calls rollback once on error and never retries', async () => {
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();
      const mutate = vi.fn().mockRejectedValue(new Error('boom'));

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: { failureMode: 'rollback', rollback },
        })
      );

      await act(async () => {
        await result.current.run({ id: 'a' });
      });
      // queueMicrotask deferral — flush microtasks
      await flush();

      expect(applyOptimistic).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(rollback).toHaveBeenCalledTimes(1);

      expect(result.current.isPending).toBe(false);
      expect(result.current.banner).toBeNull();
    });

    it('rollback fires AFTER applyOptimistic + mutate (paints optimistic frame first)', async () => {
      const order: string[] = [];
      const applyOptimistic = vi.fn(() => order.push('apply'));
      const rollback = vi.fn(() => order.push('rollback'));
      const mutate = vi.fn().mockImplementation(async () => {
        order.push('mutate-start');
        throw new Error('boom');
      });

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: { failureMode: 'rollback', rollback },
        })
      );

      await act(async () => {
        await result.current.run({});
      });
      await flush();

      // applyOptimistic always before mutate; rollback after both — and
      // critically, rollback is queueMicrotask-deferred so the optimistic
      // paint can land before the rollback's setState.
      expect(order[0]).toBe('apply');
      expect(order[1]).toBe('mutate-start');
      expect(order[2]).toBe('rollback');
    });
  });

  describe('banner mode (Tier A2)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('runs the 4-attempt sequence with [1s, 3s, 7s] backoff and escalates banner', async () => {
      const mutate = vi.fn().mockRejectedValue(new Error('network'));
      const rollback = vi.fn();
      const applyOptimistic = vi.fn();

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: {
            failureMode: 'banner',
            rollback,
            bannerLabel: "Couldn't save 'milk'",
          },
        })
      );

      await act(async () => {
        await result.current.run({ id: 'a' });
      });
      // After the initial attempt rejects, the hook scheduled a setTimeout
      // in 1000ms for attempt 2.
      expect(mutate).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mutate).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(mutate).toHaveBeenCalledTimes(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000);
      });
      expect(mutate).toHaveBeenCalledTimes(4);
      // After the final attempt rejects, banner surfaces.
      expect(result.current.banner).not.toBeNull();
      expect(result.current.banner?.label).toBe("Couldn't save 'milk'");
    });

    it('escalates banner immediately on hard error (no retries)', async () => {
      const mutate = vi.fn().mockRejectedValue({ status: 422, message: 'bad' });
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: {
            failureMode: 'banner',
            rollback,
            bannerLabel: "Couldn't save 'eggs'",
          },
        })
      );

      await act(async () => {
        await result.current.run({});
      });

      expect(result.current.banner).not.toBeNull();
      expect(mutate).toHaveBeenCalledTimes(1);

      // No further attempts even after long wait
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('respects custom isHardError classifier', async () => {
      const mutate = vi.fn().mockRejectedValue({ kind: 'validation' });
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          isHardError: (err): boolean =>
            (err as { kind?: string }).kind === 'validation',
          onFailure: {
            failureMode: 'banner',
            rollback,
            bannerLabel: 'oops',
          },
        })
      );

      await act(async () => {
        await result.current.run({});
      });
      expect(result.current.banner).not.toBeNull();
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('retry button re-fires mutation with the same args', async () => {
      let shouldFail = true;
      const mutate = vi.fn().mockImplementation(async () => {
        if (shouldFail) throw { status: 500 };
        return 'ok';
      });
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: {
            failureMode: 'banner',
            rollback,
            bannerLabel: 'oops',
          },
        })
      );

      await act(async () => {
        await result.current.run({ id: 'milk' });
      });
      expect(result.current.banner).not.toBeNull();
      expect(mutate).toHaveBeenCalledWith({ id: 'milk' });
      expect(mutate).toHaveBeenCalledTimes(1);

      // Now arm the mutation to succeed and tap retry.
      shouldFail = false;
      const retry = result.current.banner!.retry;
      await act(async () => {
        retry();
      });
      // Allow retry's pending mutate to settle
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mutate).toHaveBeenCalledTimes(2);
      expect(mutate).toHaveBeenLastCalledWith({ id: 'milk' });
      // Retry replays without a fresh applyOptimistic call
      expect(applyOptimistic).toHaveBeenCalledTimes(1);
      expect(result.current.banner).toBeNull();
    });

    it('undo button calls rollback and clears banner', async () => {
      const mutate = vi.fn().mockRejectedValue({ status: 500 });
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: {
            failureMode: 'banner',
            rollback,
            bannerLabel: 'oops',
          },
        })
      );

      await act(async () => {
        await result.current.run({});
      });
      expect(result.current.banner).not.toBeNull();

      const undo = result.current.banner!.undo;
      act(() => {
        undo();
      });

      expect(rollback).toHaveBeenCalledTimes(1);
      expect(result.current.banner).toBeNull();
    });

    it('dismiss button clears banner without rollback (caller-owned cleanup)', async () => {
      const mutate = vi.fn().mockRejectedValue({ status: 500 });
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();
      const onBannerDismiss = vi.fn();

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: {
            failureMode: 'banner',
            rollback,
            bannerLabel: 'oops',
            onBannerDismiss,
          },
        })
      );

      await act(async () => {
        await result.current.run({});
      });
      expect(result.current.banner).not.toBeNull();

      act(() => {
        result.current.banner!.dismiss();
      });

      expect(rollback).not.toHaveBeenCalled();
      expect(onBannerDismiss).toHaveBeenCalledTimes(1);
      expect(result.current.banner).toBeNull();
    });

    it('starting a new run() clears any existing banner', async () => {
      const mutate = vi
        .fn()
        .mockRejectedValueOnce({ status: 500 })
        .mockResolvedValueOnce('ok');
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();

      const { result } = renderHook(() =>
        useOptimisticMutation({
          mutate,
          applyOptimistic,
          onFailure: {
            failureMode: 'banner',
            rollback,
            bannerLabel: 'oops',
          },
        })
      );

      await act(async () => {
        await result.current.run({ id: 'a' });
      });
      expect(result.current.banner).not.toBeNull();

      await act(async () => {
        await result.current.run({ id: 'b' });
      });

      expect(applyOptimistic).toHaveBeenCalledTimes(2);
      expect(result.current.banner).toBeNull();
    });
  });
});
