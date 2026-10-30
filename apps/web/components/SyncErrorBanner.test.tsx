// What: Behavior tests for SyncErrorBanner — render, metric fire-once, retry +
//       dismiss, plus the new affordance discriminator (tap-to-retry vs
//       retry-undo). Tier A2 retry/undo affordance is the new path D15 added.
// Why: `error_displayed` is the reliability dashboard; firing it once per error
//      instance is load-bearing for accurate ops signal. Affordance variant
//      drives whether the banner is a retry-the-subscription bar or a
//      retry/undo affordance for an optimistic-mutation failure.
// Does NOT: Exercise the realtime stack — banner is presentational.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { captureMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: { capture: captureMock },
}));

import { SyncErrorBanner } from './SyncErrorBanner';

describe('<SyncErrorBanner>', () => {
  beforeEach(() => {
    captureMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('tap-to-retry affordance (realtime / query)', () => {
    it('renders nothing when error is null', () => {
      const { container } = render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={null}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(container.firstChild).toBeNull();
      expect(captureMock).not.toHaveBeenCalled();
    });

    it('renders the banner for realtime errors', () => {
      render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(screen.getByRole('status')).toHaveTextContent(/sync paused/i);
      expect(
        screen.getByRole('button', { name: /dismiss sync warning/i })
      ).toBeInTheDocument();
    });

    it('fires error_displayed once on mount for realtime', () => {
      render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledTimes(1);
      expect(captureMock).toHaveBeenCalledWith('error_displayed', {
        error_type: 'realtime',
        screen: 'list',
      });
    });

    it('fires error_displayed with the query type', () => {
      render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'query' }}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledWith('error_displayed', {
        error_type: 'query',
        screen: 'list',
      });
    });

    it('does not re-fire on re-render when the error type stays the same', () => {
      const { rerender } = render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledTimes(1);

      rerender(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledTimes(1);
    });

    it('re-fires when the error type transitions from realtime → query', () => {
      const { rerender } = render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledTimes(1);

      rerender(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'query' }}
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledTimes(2);
      expect(captureMock).toHaveBeenLastCalledWith('error_displayed', {
        error_type: 'query',
        screen: 'list',
      });
    });

    it('calls onRetry when the bar area is clicked', async () => {
      const onRetry = vi.fn();
      render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          onDismiss={() => {}}
          onRetry={onRetry}
        />
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /sync paused/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('calls onDismiss when the ✕ is clicked', async () => {
      const onDismiss = vi.fn();
      render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          onDismiss={onDismiss}
          onRetry={() => {}}
        />
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('uses the provided screen label in the event', () => {
      render(
        <SyncErrorBanner
          affordance="tap-to-retry"
          error={{ type: 'realtime' }}
          screen="custom-screen"
          onDismiss={() => {}}
          onRetry={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledWith('error_displayed', {
        error_type: 'realtime',
        screen: 'custom-screen',
      });
    });
  });

  describe('retry-undo affordance (Tier A2 — D15)', () => {
    it('renders the item label and Retry/Undo buttons (no "tap to retry" copy)', () => {
      render(
        <SyncErrorBanner
          affordance="retry-undo"
          error={{ type: 'sync' }}
          label="Couldn't save 'milk'"
          onDismiss={() => {}}
          onRetry={() => {}}
          onUndo={() => {}}
        />
      );
      expect(screen.getByTestId('sync-error-label')).toHaveTextContent(
        "Couldn't save 'milk'"
      );
      expect(
        screen.getByRole('button', { name: /^retry$/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^undo$/i })
      ).toBeInTheDocument();
      expect(screen.queryByText(/tap to retry/i)).toBeNull();
    });

    it('Retry button calls onRetry exactly once', async () => {
      const onRetry = vi.fn();
      render(
        <SyncErrorBanner
          affordance="retry-undo"
          error={{ type: 'sync' }}
          label="Couldn't save 'milk'"
          onDismiss={() => {}}
          onRetry={onRetry}
          onUndo={() => {}}
        />
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /^retry$/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('Undo button calls onUndo exactly once', async () => {
      const onUndo = vi.fn();
      render(
        <SyncErrorBanner
          affordance="retry-undo"
          error={{ type: 'sync' }}
          label="Couldn't save 'milk'"
          onDismiss={() => {}}
          onRetry={() => {}}
          onUndo={onUndo}
        />
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it('dismiss ✕ still works in retry-undo mode', async () => {
      const onDismiss = vi.fn();
      render(
        <SyncErrorBanner
          affordance="retry-undo"
          error={{ type: 'sync' }}
          label="Couldn't save 'milk'"
          onDismiss={onDismiss}
          onRetry={() => {}}
          onUndo={() => {}}
        />
      );
      const user = userEvent.setup();
      await user.click(
        screen.getByRole('button', { name: /dismiss sync warning/i })
      );
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('fires error_displayed with the sync type for the optimistic-mutation failure', () => {
      render(
        <SyncErrorBanner
          affordance="retry-undo"
          error={{ type: 'sync' }}
          label="Couldn't save 'milk'"
          onDismiss={() => {}}
          onRetry={() => {}}
          onUndo={() => {}}
        />
      );
      expect(captureMock).toHaveBeenCalledWith('error_displayed', {
        error_type: 'sync',
        screen: 'list',
      });
    });
  });
});
