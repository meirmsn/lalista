// What: Behavior tests for ConfirmationToast — auto-dismiss, live-region, message
// Why: Toast is the visual signal of a successful add; regressions make the write
//      feel like it silently failed
// Does NOT: Snapshot classes

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfirmationToast } from './ConfirmationToast';

describe('<ConfirmationToast>', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the message inside a polite live region', () => {
    render(<ConfirmationToast message="Added milk" onDismiss={() => {}} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Added milk');
  });

  it('calls onDismiss after the default 3s timer', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConfirmationToast message="Added milk" onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('respects a custom durationMs', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ConfirmationToast message="x" durationMs={1000} onDismiss={onDismiss} />
    );
    vi.advanceTimersByTime(999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears the timer on unmount', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(
      <ConfirmationToast message="x" onDismiss={onDismiss} />
    );
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
