// What: Thin wrapper around posthog.capture that centralizes the event name constants
// Why: Event names live in METRICS.md — putting them behind a tiny API means typos
//      become type errors and a grep of this file tells you every event the web app emits
// Does NOT: Initialize PostHog (providers.tsx does that) or handle fallback when
//           PostHog is disabled (posthog-js no-ops when uninitialized)

import posthog from 'posthog-js';
import type { InputLanguage } from './inputLanguage';

/** Events emitted by the web app. Mirror rows in METRICS.md. */
export const AUTH_SIGNED_IN = 'auth_signed_in';
export const AUTH_SIGNED_OUT = 'auth_signed_out';
export const AUTH_SIGNED_UP = 'auth_signed_up';
export const AUTH_PASSWORD_RESET_REQUESTED = 'auth_password_reset_requested';
export const AUTH_PASSWORD_RESET_COMPLETED = 'auth_password_reset_completed';
export const AUTH_EMAIL_CONFIRMATION_RESENT = 'auth_email_confirmation_resent';
export const ITEM_ADDED = 'item_added';
export const ITEM_BOUGHT = 'item_bought';
export const DISAMBIGUATION_SHOWN = 'disambiguation_shown';
export const STORE_ROUTED = 'store_routed';
export const ERROR_DISPLAYED = 'error_displayed';
export const MY_STORE_ADDED = 'my_store_added';
export const MY_STORE_REMOVED = 'my_store_removed';
export const CUSTOM_STORE_CREATED = 'custom_store_created';
export const STORE_ROUTING_FALLBACK_FIRED = 'store_routing_fallback_fired';

export type AuthMethod = 'email' | 'apple';
export type ResendSource = 'sign-up' | 'sign-in-fallback';
export type FollowupType = 'store' | 'item' | 'brand' | 'quantity';
export type ErrorType = 'realtime' | 'query' | 'sync';

/** Fire once on a successful session create (either sign-in or signup-then-autologin). */
export function trackSignedIn(method: AuthMethod = 'email') {
  posthog.capture(AUTH_SIGNED_IN, { method });
}

/** Fire once on a successful sign-out, with the elapsed session duration in seconds. */
export function trackSignedOut(sessionDurationSeconds: number) {
  posthog.capture(AUTH_SIGNED_OUT, {
    session_duration_seconds: sessionDurationSeconds,
  });
}

/** Fire on the eventual SIGNED_IN auth-state event for a brand-new account. */
export function trackSignedUp(method: AuthMethod = 'email') {
  posthog.capture(AUTH_SIGNED_UP, { method });
}

/**
 * Fire when the /forgot-password submit resolves successfully. Always fires
 * regardless of whether the email belongs to a registered user — we don't
 * inspect Supabase's response shape (no-enumeration). No PII properties.
 */
export function trackPasswordResetRequested() {
  posthog.capture(AUTH_PASSWORD_RESET_REQUESTED, {});
}

/** Fire when /reset-password's updateUser({ password }) resolves successfully. */
export function trackPasswordResetCompleted() {
  posthog.capture(AUTH_PASSWORD_RESET_COMPLETED, {});
}

/**
 * Fire on the resend click in AwaitingConfirmationCard (or any future
 * legacy path). `source` distinguishes the sign-up surface from any
 * sign-in-fallback path that hangs around post-split.
 */
export function trackEmailConfirmationResent(properties: {
  source: ResendSource;
}) {
  posthog.capture(AUTH_EMAIL_CONFIRMATION_RESENT, properties);
}

/**
 * Fire when `invokeAddItem` resolves with `needs_followup === false`. Captures
 * which store the item landed in, whether the user went through disambiguation
 * first, and the rough input language (for routing-quality analysis).
 *
 * `was_force_created` is set true only when the add resolved via the
 * "Add as new" force-create branch in the disambig sheet (response carries
 * `added_new: true`). Default-omitted on every other path so PostHog event
 * payloads stay minimal for the common case.
 */
export function trackItemAdded(properties: {
  store_id: string;
  was_disambiguated: boolean;
  input_language: InputLanguage;
  was_force_created?: boolean;
}) {
  posthog.capture(ITEM_ADDED, properties);
}

/** Fire when `markItemBought` resolves — time-on-list derived from `added_at`. */
export function trackItemBought(properties: { time_on_list_seconds: number }) {
  posthog.capture(ITEM_BOUGHT, properties);
}

/** Fire when `invokeAddItem` resolves with `needs_followup === true`. */
export function trackDisambiguationShown(properties: {
  candidate_count: number;
  followup_type: FollowupType;
}) {
  posthog.capture(DISAMBIGUATION_SHOWN, properties);
}

/**
 * Fire after a successful add that resolved a store via history routing.
 * `confidence_score` is the server-side weighted-share number surfaced by
 * `AddItemResponse.store_confidence`; pass `null` when the server omitted it.
 */
export function trackStoreRouted(properties: {
  store_name: string;
  confidence_score: number | null;
}) {
  posthog.capture(STORE_ROUTED, properties);
}

/** Fire once per sync-error instance (null → non-null transition — deduped upstream). */
export function trackErrorDisplayed(properties: {
  error_type: ErrorType;
  screen: string;
}) {
  posthog.capture(ERROR_DISPLAYED, properties);
}

/**
 * Source surface for my_store_added / my_store_removed / custom_store_created.
 *
 * NOTE: as of /ak-pre-ship Phase 3 of my-stores, only `'settings'` (from
 * MyStoresSection) and `'disambig'` (from DisambiguationSheet) are reached at
 * runtime. The `'add_item'` value is the typed-future placeholder for a
 * potential inline-picker surface directly inside AddItemSheet's bare-input
 * flow (no disambiguation needed) — kept in the union so that surface ships
 * without an analytics schema change.
 */
export type MyStoreSource = 'settings' | 'add_item' | 'disambig';

/**
 * Fire when add_household_store succeeds. `was_created=true` indicates a new
 * catalog row was minted (custom-create branch) — callers ALSO fire
 * `trackCustomStoreCreated` in that case for the rarer-event PostHog view
 * (D11; CLAUDE.md gotcha § addHouseholdStore return shape).
 */
export function trackMyStoreAdded(properties: {
  store_id: string;
  was_created: boolean;
  source: MyStoreSource;
  household_id: string;
}) {
  posthog.capture(MY_STORE_ADDED, properties);
}

/**
 * Fire when remove_household_store succeeds. Idempotent removal still counts
 * as a user-intent signal — fire even when the row was already absent.
 */
export function trackMyStoreRemoved(properties: {
  store_id: string;
  source: 'settings';
  household_id: string;
}) {
  posthog.capture(MY_STORE_REMOVED, properties);
}

/**
 * Fire only when add_household_store returned `was_created=true`. Strict
 * subset of my_store_added; emitted separately so the rarer-event PostHog
 * query is cheaper than a filter on `was_created=true` (D11).
 */
export function trackCustomStoreCreated(properties: {
  store_id: string;
  name: string;
  source: MyStoreSource;
  household_id: string;
}) {
  posthog.capture(CUSTOM_STORE_CREATED, properties);
}

/**
 * Fire when the add-item edge function's response carries
 * `store_routing_fallback_fired: true` — the silent_match routing decision
 * was downgraded to asked_store because the predicted store isn't in the
 * caller's My Stores (D5). Server-side firing would require a separate
 * PostHog ingest key that's not currently provisioned; meanwhile the
 * client echoes from the response flag.
 */
export function trackStoreRoutingFallbackFired(properties: {
  removed_store_id: string;
  item_canonical: string;
  household_id: string;
}) {
  posthog.capture(STORE_ROUTING_FALLBACK_FIRED, properties);
}
