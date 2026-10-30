// What: Unit tests for SubmitButton — instant disable, 250ms threshold,
//       cancellation when isPending flips back fast, success label swap,
//       aria-busy, fallback labels.
// Why: Behavior-preserving lift from apps/web/components/AuthSubmitButton.test.tsx —
//      the threshold timing is the load-bearing UX behavior of this button
//      and every Tier B caller (5 auth screens + Settings sign-out)
//      depends on it. Tests verify the lift is a no-op on observable behavior.
// Does NOT: Visual snapshot — class names are an implementation detail.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SubmitButton } from './SubmitButton';

describe('<SubmitButton>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the children label and is enabled when idle', () => {
    render(
      <SubmitButton isPending={false} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    );
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId('submit-button-spinner')).toBeNull();
  });

  it('isPending=true instantly disables the button', () => {
    render(
      <SubmitButton isPending={true} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does NOT show the spinner before 250ms (snappy fast-resolve)', () => {
    render(
      <SubmitButton isPending={true} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    );
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(screen.queryByTestId('submit-button-spinner')).toBeNull();
    // Idle label still showing — pendingLabel only swaps once the spinner
    // crosses its threshold.
    expect(screen.getByRole('button')).toHaveTextContent(/sign in/i);
    expect(screen.getByRole('button')).not.toHaveTextContent(/signing in/i);
  });

  it('shows the spinner + pendingLabel after 250ms', () => {
    render(
      <SubmitButton isPending={true} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId('submit-button-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent(/signing in/i);
  });

  it('cancels the pending spinner when isPending flips back fast', () => {
    const { rerender } = render(
      <SubmitButton isPending={true} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(
      <SubmitButton isPending={false} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    );
    // Even past the original 250ms threshold, no spinner — the cancel
    // landed before the timer fired.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('submit-button-spinner')).toBeNull();
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('isSuccess=true keeps button disabled and swaps in successLabel', () => {
    render(
      <SubmitButton
        isPending={false}
        pendingLabel="Signing in…"
        isSuccess={true}
        successLabel="Signed in"
      >
        Sign in
      </SubmitButton>
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/signed in/i);
  });

  it('success label persists when both isSuccess and isPending are momentarily true', () => {
    render(
      <SubmitButton
        isPending={true}
        pendingLabel="Signing in…"
        isSuccess={true}
        successLabel="Signed in"
      >
        Sign in
      </SubmitButton>
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    // success wins over pending in label resolution
    expect(button).toHaveTextContent(/signed in/i);
    // No spinner when success state is set
    expect(screen.queryByTestId('submit-button-spinner')).toBeNull();
  });

  it('falls back to children when pendingLabel / successLabel are omitted', () => {
    const { rerender } = render(
      <SubmitButton isPending={true}>Sign in</SubmitButton>
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole('button')).toHaveTextContent(/sign in/i);

    rerender(
      <SubmitButton isPending={false} isSuccess={true}>
        Sign in
      </SubmitButton>
    );
    expect(screen.getByRole('button')).toHaveTextContent(/sign in/i);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('aria-busy reflects isPending for assistive tech', () => {
    const { rerender } = render(
      <SubmitButton isPending={false}>Sign in</SubmitButton>
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'false');
    rerender(<SubmitButton isPending={true}>Sign in</SubmitButton>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});
