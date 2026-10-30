// What: Render + interaction tests for InviteLinkSheet.
// Why: Pin the keyboard close affordance (Esc), the URL display, the
//      Web Share API feature-detection branch, and the copy success path.
// Does NOT: Test focus-trap mechanics — that's E2E territory.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteLinkSheet } from './InviteLinkSheet';

describe('InviteLinkSheet', () => {
  const originalShare = (navigator as unknown as { share?: unknown }).share;
  const originalClipboard = (navigator as unknown as { clipboard?: unknown })
    .clipboard;

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: originalShare,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('renders the URL + expires caption', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render(
      <InviteLinkSheet
        url="https://lalista.store/join/abc"
        expiresAt="2026-05-17T00:00:00Z"
        onClose={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-link-url').textContent).toBe(
        'https://lalista.store/join/abc'
      )
    );
    expect(screen.getByText(/expires/)).toBeTruthy();
    expect(screen.getByText(/one use\./)).toBeTruthy();
  });

  it('shows the share button when navigator.share is available', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    render(
      <InviteLinkSheet
        url="https://lalista.store/join/abc"
        expiresAt="2026-05-17T00:00:00Z"
        onClose={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'share' })).toBeTruthy()
    );
  });

  it('hides the share button when navigator.share is unavailable', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render(
      <InviteLinkSheet
        url="https://lalista.store/join/abc"
        expiresAt="2026-05-17T00:00:00Z"
        onClose={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-link-url')).toBeTruthy()
    );
    expect(screen.queryByRole('button', { name: 'share' })).toBeNull();
  });

  it('Escape key calls onClose', async () => {
    const onClose = vi.fn();
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render(
      <InviteLinkSheet
        url="https://lalista.store/join/abc"
        expiresAt="2026-05-17T00:00:00Z"
        onClose={onClose}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('invite-link-url')).toBeTruthy()
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('copy button writes the URL to the clipboard', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <InviteLinkSheet
        url="https://lalista.store/join/abc"
        expiresAt="2026-05-17T00:00:00Z"
        onClose={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'copy' })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://lalista.store/join/abc')
    );
  });
});
