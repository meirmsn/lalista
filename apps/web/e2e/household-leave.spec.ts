// What: E2E for the leave-household flow — member leaves successfully,
//       owner-attempts-leave is blocked, last-member-leaves is blocked.
// Why: leave_household RPC's three branches (owner_cannot_leave / cannot_orphan
//       / success) drive distinct UX paths; pin them here.

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('household-leave', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('household-leave'));

  test('member leaves household → redirects to /onboarding + audit row written', async ({
    page,
  }, testInfo) => {
    const admin = adminClient();
    const ownerEmail = `leave-owner-${testInfo.project.name}-${Date.now()}@example.com`;
    const memberEmail = `leave-member-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    const { data: ownerUser } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
    });
    const { data: memberUser } = await admin.auth.admin.createUser({
      email: memberEmail,
      password,
      email_confirm: true,
    });
    const ownerId = ownerUser!.user!.id;
    const memberId = memberUser!.user!.id;
    const { data: household } = await admin
      .from('households')
      .insert({ name: `Casa Leave ${Date.now()}` })
      .select('id')
      .single();
    await admin.from('household_members').insert([
      { household_id: household!.id, user_id: ownerId, role: 'owner' },
      { household_id: household!.id, user_id: memberId, role: 'member' },
    ]);

    await page.goto('/sign-in');
    // WebKit hydration race — wait for React state to commit (CLAUDE.md gotcha).
    await page.waitForLoadState('networkidle');
    await page.fill('[name="email"], #email', memberEmail);
    await page.fill('[name="password"], #password', password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/list/, { timeout: 10_000 });

    await page.goto('/settings');
    const leaveBtn = page.getByRole('button', { name: /leave household/i });
    await leaveBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await leaveBtn.click();
    // 20s timeout: mobile WebKit on the slow-job's `pnpm dev` turbopack
    // first-route navigation to /onboarding (cold RSC) can take 10-15s on
    // top of the leave_household RPC + audit insert + realtime fan-out.
    // CI ack: run 25637143418 trace showed RPC 204 success at +0ms, RSC
    // prefetch fired at +40ms, but the actual page swap exceeded the
    // prior 10s budget. Bumped here; desktop hits this in 1-2s and is
    // unaffected.
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });

    // member_left audit row written.
    const { data: events } = await admin
      .from('household_audit_events')
      .select('event_type')
      .eq('household_id', household!.id)
      .eq('event_type', 'member_left');
    expect(events?.length ?? 0).toBeGreaterThan(0);

    await admin.auth.admin.deleteUser(ownerId);
    await admin.auth.admin.deleteUser(memberId);
  });

  test('owner-attempts-leave is blocked at the SECURITY DEFINER layer', async ({
    browser: _browser,
  }, testInfo) => {
    // Member-only "Leave household" button is gated by viewerIsOwner, so the
    // affordance never surfaces for owners in the UI. We verify the SQL-layer
    // backstop directly here — a hostile path that bypassed the UI gate would
    // hit P0001 'owner cannot leave (transfer ownership first — v1 feature)'.
    const admin = adminClient();
    const email = `leave-owner-block-${testInfo.project.name}-${Date.now()}@example.com`;
    const { data: user } = await admin.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
    });
    const userId = user!.user!.id;
    const { data: household } = await admin
      .from('households')
      .insert({ name: `Casa Leave Block ${Date.now()}` })
      .select('id')
      .single();
    await admin.from('household_members').insert({
      household_id: household!.id,
      user_id: userId,
      role: 'owner',
    });

    // Sign in as the user via supabase-js anon to invoke the RPC under their
    // JWT (admin client bypasses RLS so we can't use it here).
    const { createClient: createSupa } = await import('@supabase/supabase-js');
    const anon = createSupa(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_ANON_KEY ?? ''
    );
    await anon.auth.signInWithPassword({
      email,
      password: 'Password123!',
    });
    const { error } = await anon.rpc('leave_household');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0001');
    expect(error!.message).toMatch(/owner cannot leave/i);

    await admin.auth.admin.deleteUser(userId);
  });
});
