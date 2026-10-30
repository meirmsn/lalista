// What: Unit tests for the list_entries realtime subscription helper
// Why: Confirm channel filter and unsubscribe contract
// Does NOT: Test actual WebSocket delivery — integration tests in PR 4

import { describe, it, expect, vi } from 'vitest';
import { subscribeToList } from './realtime';

/**
 *
 */
function buildClient() {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);

  const client = {
    channel: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn(),
  };

  return { client, channel };
}

describe('subscribeToList', () => {
  it('opens a channel keyed by household and filters by household_id', () => {
    const { client, channel } = buildClient();

    subscribeToList(client as never, 'house-1', vi.fn());

    expect(client.channel).toHaveBeenCalledWith('list_entries:house-1');
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'list_entries',
        filter: 'household_id=eq.house-1',
      }),
      expect.any(Function)
    );
    expect(channel.subscribe).toHaveBeenCalled();
  });

  it('forwards payloads to the caller callback', () => {
    const { client, channel } = buildClient();
    const cb = vi.fn();

    subscribeToList(client as never, 'house-1', cb);

    const firstCall = channel.on.mock.calls[0];
    if (!firstCall) throw new Error('channel.on not called');
    const payloadHandler = firstCall[2] as (payload: unknown) => void;
    const payload = { eventType: 'INSERT', new: { id: 'entry-1' } };
    payloadHandler(payload);

    expect(cb).toHaveBeenCalledWith(payload);
  });

  it('removes the channel when the returned unsubscribe is called', () => {
    const { client, channel } = buildClient();

    const unsubscribe = subscribeToList(client as never, 'house-1', vi.fn());
    unsubscribe();

    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('calls onError when subscribe status is CHANNEL_ERROR or TIMED_OUT', () => {
    const { client, channel } = buildClient();
    const onError = vi.fn();

    subscribeToList(client as never, 'house-1', vi.fn(), onError);

    // Capture the status callback supabase-js receives via .subscribe(cb)
    const subscribeCalls = channel.subscribe.mock.calls;
    const firstSubscribeCall = subscribeCalls[0];
    if (!firstSubscribeCall) throw new Error('channel.subscribe not called');
    const statusHandler = firstSubscribeCall[0] as (status: string) => void;
    expect(statusHandler).toBeTypeOf('function');

    // CHANNEL_ERROR fires onError
    statusHandler('CHANNEL_ERROR');
    expect(onError).toHaveBeenCalledTimes(1);

    // TIMED_OUT also fires onError
    statusHandler('TIMED_OUT');
    expect(onError).toHaveBeenCalledTimes(2);

    // SUBSCRIBED (success) does NOT fire onError
    statusHandler('SUBSCRIBED');
    expect(onError).toHaveBeenCalledTimes(2);

    // CLOSED (normal teardown) does NOT fire onError
    statusHandler('CLOSED');
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('calls onSubscribed when subscribe status is SUBSCRIBED (every time)', () => {
    const { client, channel } = buildClient();
    const onSubscribed = vi.fn();
    const onError = vi.fn();

    subscribeToList(client as never, 'house-1', vi.fn(), onError, onSubscribed);

    const subscribeCalls = channel.subscribe.mock.calls;
    const firstSubscribeCall = subscribeCalls[0];
    if (!firstSubscribeCall) throw new Error('channel.subscribe not called');
    const statusHandler = firstSubscribeCall[0] as (status: string) => void;

    // SUBSCRIBED fires onSubscribed (first connect)
    statusHandler('SUBSCRIBED');
    expect(onSubscribed).toHaveBeenCalledTimes(1);

    // SUBSCRIBED again (reconnect) fires it again — supports the
    // early-clear-of-suppress-window semantic in ListClient's wake recovery.
    statusHandler('SUBSCRIBED');
    expect(onSubscribed).toHaveBeenCalledTimes(2);

    // CHANNEL_ERROR / TIMED_OUT / CLOSED do NOT fire onSubscribed
    statusHandler('CHANNEL_ERROR');
    statusHandler('TIMED_OUT');
    statusHandler('CLOSED');
    expect(onSubscribed).toHaveBeenCalledTimes(2);
    // and onError fired only for the two error statuses
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
