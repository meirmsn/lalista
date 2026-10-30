// What: Smoke tests for the analytics wrapper — event names + property shape
// Why: METRICS.md is authoritative; the wrapper must keep the event name constants
//      in sync. Type tests would miss renames (string literals), so runtime asserts.
// Does NOT: Verify PostHog network delivery — capture is fire-and-forget by design

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}));

import posthog from 'posthog-js';
import {
  AUTH_EMAIL_CONFIRMATION_RESENT,
  AUTH_PASSWORD_RESET_COMPLETED,
  AUTH_PASSWORD_RESET_REQUESTED,
  AUTH_SIGNED_IN,
  AUTH_SIGNED_OUT,
  AUTH_SIGNED_UP,
  DISAMBIGUATION_SHOWN,
  ERROR_DISPLAYED,
  ITEM_ADDED,
  ITEM_BOUGHT,
  STORE_ROUTED,
  trackDisambiguationShown,
  trackEmailConfirmationResent,
  trackErrorDisplayed,
  trackItemAdded,
  trackItemBought,
  trackPasswordResetCompleted,
  trackPasswordResetRequested,
  trackSignedIn,
  trackSignedOut,
  trackSignedUp,
  trackStoreRouted,
} from './analytics';

describe('analytics', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('AUTH_SIGNED_IN matches the METRICS.md event name', () => {
    expect(AUTH_SIGNED_IN).toBe('auth_signed_in');
  });

  it('AUTH_SIGNED_OUT matches the METRICS.md event name', () => {
    expect(AUTH_SIGNED_OUT).toBe('auth_signed_out');
  });

  it('trackSignedIn captures with method: email by default', () => {
    trackSignedIn();
    expect(posthog.capture).toHaveBeenCalledWith('auth_signed_in', {
      method: 'email',
    });
  });

  it('trackSignedIn captures with an explicit method', () => {
    trackSignedIn('apple');
    expect(posthog.capture).toHaveBeenCalledWith('auth_signed_in', {
      method: 'apple',
    });
  });

  it('trackSignedOut captures with session_duration_seconds', () => {
    trackSignedOut(42);
    expect(posthog.capture).toHaveBeenCalledWith('auth_signed_out', {
      session_duration_seconds: 42,
    });
  });

  it('ITEM_ADDED + STORE_ROUTED + DISAMBIGUATION_SHOWN + ITEM_BOUGHT + ERROR_DISPLAYED match METRICS.md', () => {
    expect(ITEM_ADDED).toBe('item_added');
    expect(STORE_ROUTED).toBe('store_routed');
    expect(DISAMBIGUATION_SHOWN).toBe('disambiguation_shown');
    expect(ITEM_BOUGHT).toBe('item_bought');
    expect(ERROR_DISPLAYED).toBe('error_displayed');
  });

  it('trackItemAdded captures store_id + was_disambiguated + input_language', () => {
    trackItemAdded({
      store_id: 'store-1',
      was_disambiguated: false,
      input_language: 'en',
    });
    expect(posthog.capture).toHaveBeenCalledWith('item_added', {
      store_id: 'store-1',
      was_disambiguated: false,
      input_language: 'en',
    });
  });

  it('trackItemBought captures time_on_list_seconds', () => {
    trackItemBought({ time_on_list_seconds: 900 });
    expect(posthog.capture).toHaveBeenCalledWith('item_bought', {
      time_on_list_seconds: 900,
    });
  });

  it('trackDisambiguationShown captures candidate_count + followup_type', () => {
    trackDisambiguationShown({ candidate_count: 3, followup_type: 'store' });
    expect(posthog.capture).toHaveBeenCalledWith('disambiguation_shown', {
      candidate_count: 3,
      followup_type: 'store',
    });
  });

  it('trackStoreRouted captures store_name + confidence_score (null-safe)', () => {
    trackStoreRouted({ store_name: 'Whole Foods', confidence_score: 0.82 });
    expect(posthog.capture).toHaveBeenCalledWith('store_routed', {
      store_name: 'Whole Foods',
      confidence_score: 0.82,
    });

    trackStoreRouted({ store_name: 'Aldi', confidence_score: null });
    expect(posthog.capture).toHaveBeenCalledWith('store_routed', {
      store_name: 'Aldi',
      confidence_score: null,
    });
  });

  it('trackErrorDisplayed captures error_type + screen', () => {
    trackErrorDisplayed({ error_type: 'realtime', screen: 'list' });
    expect(posthog.capture).toHaveBeenCalledWith('error_displayed', {
      error_type: 'realtime',
      screen: 'list',
    });
  });

  it('AUTH_SIGNED_UP/PASSWORD_RESET_*/EMAIL_CONFIRMATION_RESENT match METRICS.md', () => {
    expect(AUTH_SIGNED_UP).toBe('auth_signed_up');
    expect(AUTH_PASSWORD_RESET_REQUESTED).toBe('auth_password_reset_requested');
    expect(AUTH_PASSWORD_RESET_COMPLETED).toBe('auth_password_reset_completed');
    expect(AUTH_EMAIL_CONFIRMATION_RESENT).toBe(
      'auth_email_confirmation_resent'
    );
  });

  it('trackSignedUp captures method: email by default', () => {
    trackSignedUp();
    expect(posthog.capture).toHaveBeenCalledWith('auth_signed_up', {
      method: 'email',
    });
  });

  it('trackPasswordResetRequested captures with no PII properties', () => {
    trackPasswordResetRequested();
    expect(posthog.capture).toHaveBeenCalledWith(
      'auth_password_reset_requested',
      {}
    );
  });

  it('trackPasswordResetCompleted captures with empty properties', () => {
    trackPasswordResetCompleted();
    expect(posthog.capture).toHaveBeenCalledWith(
      'auth_password_reset_completed',
      {}
    );
  });

  it('trackEmailConfirmationResent captures the source', () => {
    trackEmailConfirmationResent({ source: 'sign-up' });
    expect(posthog.capture).toHaveBeenCalledWith(
      'auth_email_confirmation_resent',
      { source: 'sign-up' }
    );
  });
});
