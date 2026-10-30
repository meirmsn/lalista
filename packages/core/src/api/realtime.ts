// What: Realtime subscription helper for the active grocery list
// Why: Shared households need live updates; polling would add latency and lag
// Does NOT: Cache state or replay events — caller reconciles its own view

import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import type { ListEntry } from '../models';

type Client = SupabaseClient<Database>;

export type ListEntryChange = RealtimePostgresChangesPayload<ListEntry>;

/**
 * Subscribe to list_entries changes for a household. The callback fires for
 * every INSERT/UPDATE/DELETE. Returns an unsubscribe function — call it on
 * component unmount or when the household context changes.
 *
 * `onError`, when supplied, is invoked when supabase-js reports a
 * `'CHANNEL_ERROR'` or `'TIMED_OUT'` status via its subscribe-status
 * callback. `'SUBSCRIBED'` (success) and `'CLOSED'` (normal teardown, e.g.
 * unmount via `removeChannel`) do NOT trigger it. This is the async-failure
 * path — the WebSocket constructor synchronous-throw case is handled by the
 * caller's try/catch around `subscribeToList` itself.
 *
 * `onSubscribed`, when supplied, is invoked whenever supabase-js reports
 * `'SUBSCRIBED'` via its subscribe-status callback — including after a
 * reconnect (the callback fires on every successful (re)subscription, not
 * just the first one). Callers use this to clear a wake-recovery
 * suppress-window once the rebuilt channel is live.
 *
 * E2E coverage (CLAUDE.md § Testing — E2E-per-surface invariant): exercised
 * end-to-end through the UI by `apps/web/e2e/realtime.spec.ts`'s cross-session
 * test (happy-path delivery), banner test (onError → sync-error banner via
 * `routeWebSocket(..., ws => ws.close())`), and the wake-recovery tests
 * (`healthy-wake` + `broken-wake`).
 */
export function subscribeToList(
  client: Client,
  householdId: string,
  callback: (change: ListEntryChange) => void,
  onError?: () => void,
  onSubscribed?: () => void
): () => void {
  const channel = client
    .channel(`list_entries:${householdId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'list_entries',
        filter: `household_id=eq.${householdId}`,
      },
      (payload) => {
        callback(payload as ListEntryChange);
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.();
      } else if (status === 'SUBSCRIBED') {
        onSubscribed?.();
      }
    });

  return () => {
    client.removeChannel(channel);
  };
}
