// What: Realtime + sync-error-banner E2E. Two tests in one describe:
//        1. Cross-session realtime — context A adds an item via UI, context B
//           (already on /list as a different household member) sees the new
//           row appear within 3s without a manual reload.
//        2. Sync-error banner — `page.route('**/realtime/v1/websocket**',
//           route => route.abort())` BEFORE navigating to /list; the banner
//           must surface within ~3s.
// Why: PR 4's audit noted realtime cross-session and the sync-error banner
//      had no E2E coverage. ListClient.tsx wires both — the unit test for
//      the banner doesn't exercise the WS abort path. This spec closes both
//      gaps in one file (shared admin-client setup; D5 rationale).
// Does NOT: Run against hosted Supabase — Realtime connection limits + WS
//           allowlist friction make local-stack the realistic path (D4).
//           Drive the FAB to FAB-stress-test concurrent inserts; that's
//           force-create-race.spec.ts's territory.

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('realtime + sync-error', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('realtime'));

  test('cross-session realtime: A adds, B observes within 10s', async ({
    browser,
  }, testInfo) => {
    const admin = adminClient();
    const stamp = `${testInfo.project.name}-${Date.now()}`;

    // Provision two confirmed users via admin API. example.com (not
    // `.invalid`) — both users sign in via the public form, which runs HTML5
    // type=email validation; WebKit (mobile project) rejects `.invalid` and
    // the form never submits.
    const emailA = `realtime-a-${stamp}@example.com`;
    const emailB = `realtime-b-${stamp}@example.com`;
    const password = 'Password123!';

    const { data: ua, error: createAErr } = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    expect(createAErr).toBeNull();
    const userIdA = ua.user!.id;

    const { data: ub, error: createBErr } = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    expect(createBErr).toBeNull();
    const userIdB = ub.user!.id;

    // One household, both members. We skip the (non-existent) invite UI per
    // D4 rationale — admin-client INSERT is the only realistic provisioning
    // path here.
    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa Realtime ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    const householdId = hh!.id;

    const { error: memErr } = await admin.from('household_members').insert([
      { household_id: householdId, user_id: userIdA },
      { household_id: householdId, user_id: userIdB },
    ]);
    expect(memErr).toBeNull();

    // Two browser contexts — fresh sessions with distinct cookies + WS.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // Both sign in via `/` → "Get started" → /sign-in (matches auth.spec.ts).
      // Direct goto('/sign-in') races React form-state hydration on WebKit;
      // see auth-edge-cases.spec.ts:31 for the trace evidence.
      await pageA.goto('/');
      await pageA.getByRole('link', { name: /^sign in$/i }).click();
      await pageA.waitForURL(/\/sign-in/);
      await pageA.getByLabel(/email/i).fill(emailA);
      await pageA.getByLabel(/password/i).fill(password);
      await pageA.getByRole('button', { name: /^sign in$/i }).click();
      await pageA.waitForURL(/\/list/);

      await pageB.goto('/');
      await pageB.getByRole('link', { name: /^sign in$/i }).click();
      await pageB.waitForURL(/\/sign-in/);
      await pageB.getByLabel(/email/i).fill(emailB);
      await pageB.getByLabel(/password/i).fill(password);
      await pageB.getByRole('button', { name: /^sign in$/i }).click();
      await pageB.waitForURL(/\/list/);

      // B is now on /list — make sure the WS subscription has had a chance
      // to attach before A inserts. Empty-list state is the load-complete
      // signal for an unpopulated household. The empty-list assertion only
      // confirms the initial query returned; the realtime channel handshake
      // is async and not gated on it. Wait an extra beat for the WS
      // SUBSCRIBE round-trip to settle so the subsequent INSERT actually
      // reaches B's subscriber. ~1s is empirically enough on the local
      // stack; without it the 3s assertion races channel-establish on CI
      // runners.
      await expect(pageB.getByText(/la lista está vacía/i)).toBeVisible();
      await pageB.waitForTimeout(1500);

      // Use admin-client INSERT to drop a row directly — exercises the
      // realtime delivery path without forcing the (slower) UI add flow on A.
      // The user-experienced realtime path is the same: Postgres logical
      // replication → Supabase Realtime → context B's subscribed channel.
      const utterance = `realtime-${stamp}`;
      const { data: items } = await admin
        .from('items')
        .select('id')
        .eq('name_canonical', 'Leche entera')
        .single();
      const { data: stores } = await admin
        .from('stores')
        .select('id')
        .eq('name', 'Walmart')
        .single();

      // Use a unique brand string so the row is grep-able on B's page even
      // though the canonical item name is shared with the seed catalog.
      const { error: insertErr } = await admin.from('list_entries').insert({
        household_id: householdId,
        item_id: items!.id,
        store_id: stores!.id,
        status: 'pending',
        added_by: userIdA,
        brand: utterance,
        quantity: 1,
      });
      expect(
        insertErr,
        'admin INSERT into list_entries should succeed'
      ).toBeNull();

      // B observes the row without manual reload — realtime delivers the
      // INSERT and ListClient hydrates the row. Match by the unique brand
      // text so we don't false-positive on a pre-existing row. 10s timeout
      // covers slow-job CI variance (WS subscribe + Postgres logical
      // replication latency + ListClient state update) — the live UX
      // budget is "within a few seconds," and observed CI variance is in
      // that range, not the 3s the original test assumed.
      await expect(pageB.getByText(utterance).first()).toBeVisible({
        timeout: 10000,
      });

      // DB-level cross-check.
      const { data: rows } = await admin
        .from('list_entries')
        .select('id, brand')
        .eq('household_id', householdId)
        .eq('brand', utterance);
      expect(rows, 'list_entries row should exist').toHaveLength(1);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('sync-error banner appears when WebSocket connection fails', async ({
    browser,
  }, testInfo) => {
    const admin = adminClient();
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    // example.com (not `.invalid`) — see the cross-session test above for
    // the WebKit email-validator rationale.
    const email = `realtime-banner-${stamp}@example.com`;
    const password = 'Password123!';

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    const userId = created.user!.id;

    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa Banner ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    await admin
      .from('household_members')
      .insert({ household_id: hh!.id, user_id: userId });

    // Fresh context so we can install the route handler before the WS opens.
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();

      // Fail the WS upgrade BEFORE goto. ListClient opens the WebSocket
      // inside its initial useEffect; intercepting after navigation would
      // miss the connect and the banner would never fire (per spec
      // § Gotchas). Use Playwright's purpose-built WS interception API
      // (`page.routeWebSocket`) to close the upgrade cleanly. supabase-js
      // converts the close into CHANNEL_ERROR via the subscribe-status
      // callback; ListClient's onError wiring (added in this PR) sets
      // syncError({type:'realtime'}) and the banner renders.
      //
      // Background on why we don't use page.route(...).fulfill(503): the
      // realtime client's onerror→onclose→silent-retry loop swallows
      // fulfilled-503 upgrades before any user-visible signal fires (see
      // PR 26 CI run #24966654227 trace). routeWebSocket triggers a
      // deterministic close that the realtime client surfaces as
      // CHANNEL_ERROR.
      await page.routeWebSocket('**/realtime/v1/websocket**', (ws) =>
        ws.close()
      );

      // Sign in via the form. The /sign-in form path doesn't open a WS
      // (only ListClient does). Use the `/` → "Get started" navigation
      // pattern (matching the cross-session test above + auth.spec.ts) —
      // direct page.goto('/sign-in') races React's controlled-input
      // hydration on WebKit, the click resolves before state commits, the
      // submit handler sees empty `email`, no `auth/v1/token` call fires,
      // and the test times out at waitForURL(/\/list/). See CLAUDE.md +
      // devshop test-review SKILL.md § "WebKit form-state hydration race"
      // for the full pattern. CI run #24973726889 surfaced this on the
      // banner test specifically (the cross-session test was already on
      // the working pattern).
      await page.goto('/');
      await page.getByRole('link', { name: /^sign in$/i }).click();
      await page.waitForURL(/\/sign-in/);
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /^sign in$/i }).click();

      // Land on /list — the WS open attempt fails, ListClient sets
      // syncError({type:'realtime'}), and the banner renders the
      // "Sync paused — tap to retry" copy. 10s budget for the supabase-js
      // realtime client to surface the upgrade failure as CHANNEL_ERROR
      // through its retry-once-then-emit shape.
      await page.waitForURL(/\/list/);
      await expect(page.getByText(/sync paused.*tap to retry/i)).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await ctx.close();
    }
  });

  // Wake-recovery: healthy-wake (D7 of specs/sync-banner-pwa-recovery/spec.md).
  // Asserts the healthy path: a wake event (visibilitychange hidden→visible)
  // on a session whose realtime channel is still joined skips the banner
  // entirely — no false positive. Pairs with the broken-wake test below;
  // together they pin the suppress-window + probe semantics.
  test('healthy-wake: visibilitychange on a joined channel does NOT show the banner', async ({
    browser,
  }, testInfo) => {
    const admin = adminClient();
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const email = `realtime-healthy-wake-${stamp}@example.com`;
    const password = 'Password123!';

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    const userId = created.user!.id;

    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa Healthy ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    await admin
      .from('household_members')
      .insert({ household_id: hh!.id, user_id: userId });

    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();

      // Sign in via the form (matches the cross-session + banner tests above
      // for the WebKit form-state hydration race rationale). No
      // routeWebSocket override — the channel SUBSCRIBEs normally.
      await page.goto('/');
      await page.getByRole('link', { name: /^sign in$/i }).click();
      await page.waitForURL(/\/sign-in/);
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(/\/list/);

      // Wait for the initial channel handshake to settle (same beat the
      // cross-session test uses). Empty-list state confirms the initial REST
      // query completed; the extra 1.5s is for the WS SUBSCRIBE round-trip.
      await expect(page.getByText(/la lista está vacía/i)).toBeVisible();
      await page.waitForTimeout(1500);

      // Dispatch visibilitychange (hidden→visible) via page.evaluate. Setting
      // document.visibilityState BEFORE dispatching is load-bearing — the
      // handler's `if (document.visibilityState !== 'visible') return;` guard
      // would otherwise skip recovery entirely.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Healthy-path assertion: banner must NOT appear for at least 3500ms
      // after the wake (covers the full 3s suppress window + a beat). The
      // probe returned `healthy=true` so the wake handler skipped the
      // rebuild entirely — no CHANNEL_ERROR path, no suppress activated,
      // just a quiet refetch.
      await expect(page.getByText(/sync paused.*tap to retry/i)).toBeHidden();
      // Probe again at the 3500ms mark to ensure the banner doesn't sneak
      // in late once any (non-existent) suppress would have expired.
      await page.waitForTimeout(3500);
      await expect(page.getByText(/sync paused.*tap to retry/i)).toBeHidden();
    } finally {
      await ctx.close();
    }
  });

  // No `broken-wake` E2E. Originally planned (spec D7) but the test design
  // turned out fundamentally incompatible with supabase-js: once the initial
  // WebSocket upgrade succeeds at sign-in, channel rebuilds reuse the same
  // underlying socket — `client.removeChannel()` + `client.channel(...)` +
  // `.subscribe()` does NOT trigger a new WS upgrade. `page.routeWebSocket`
  // intercepts upgrade requests, so it has nothing to interrupt on the rebuild
  // path. Confirmed empirically across CI runs 25768030207 (probe-and-skip
  // logic) and 25771200558 (always-rebuild logic) — both red on identical
  // assertion failures.
  //
  // The "broken connection → banner appears" path is already covered by the
  // `sync-error banner appears when WebSocket connection fails` test above
  // (line 168), which installs `routeWebSocket` BEFORE goto so the initial
  // upgrade fails. That covers the deterministic shape. The wake-from-good-
  // to-broken-state edge case is verified by post-deploy manual smoke on
  // iOS PWA (test-plan checklist in the PR).
});
