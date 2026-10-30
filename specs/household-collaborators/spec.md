<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: household-collaborators -->
<!-- date: 2026-05-10 -->

# Spec: household-collaborators (PR N)

**Sources:**

- `PRODUCT-ROADMAP.md` — chapter 1l/1m precedents (auth UX + snappiness primitives this spec builds on)
- `PLAN.md § Planned § 2` — feature row with full review provenance
- `.gstack/projects/meirmsn-lalista/node-main-design-20260508-233433.md` — design doc (APPROVED: 3 office-hours iterations 8.5/10 + design review 5/10 → 9/10 with 11 decisions + formal eng review CLEAR with 14 resolved findings + 6 outside-voice cross-model tensions resolved)
- `.gstack/projects/meirmsn-lalista/node-feat-household-collaborators-eng-review-test-plan-20260510-032344.md` — eng-review test plan (5 critical tests gating merge + full coverage matrix)
- `DESIGN.md` — token map, motion, voice doctrine
- Prior spec `specs/app-snappiness/spec.md` — style + structure reference (Tier A1/A2/B/C primitives consumed here)

Ship the missing share loop. Owner generates a single-use 7-day link → invitee taps → signs up if needed → confirmation email carries the invite token via `emailRedirectTo` → server callback redirects to `/join/<token>` → `accept_invite` RPC → invitee lands on the shared list. Plus member management (remove, leave), editable household name, audit feed of state changes, RLS-bound revocation, and realtime leak-window mitigation via response-shape thread.

---

## Decisions (resolved at spec time)

20 `/ak-spec`-time decisions resolved across the design + eng + outside-voice review cycles. Recorded below so Phase 1 preserves them verbatim.

### D1: Token format

**Decision:** 32-char URL-safe base64url (`encode(gen_random_bytes(24), 'base64')` + `+/=` → `-_<empty>`), single-use, 7-day expiry, per-household scope.

**Rationale:** Single-use + 7d + per-household makes brute-force economically pointless. Locks at 32 unless review pushes back. (Design doc Open Q1.)

### D2: Ownership model

**Decision:** Use existing `household_members.role` ('owner'/'member') from migration 001. No new column on `households`. RLS owner checks via subqueries against `household_members`. New `is_household_owner(uuid)` SECURITY DEFINER helper.

**Rationale:** Premise 3 (revised). Migration 008 `create_household_with_owner` already establishes the role column at row creation.

### D3: Token transport across email-confirm gap

**Decision:** `emailRedirectTo` query param on Supabase `signUp`. Confirmation email URL carries `?invite=<token>` → existing `/auth/callback/route.ts` reads it from `searchParams` → if present, redirects to `/join/<token>` instead of `/onboarding`.

**Rationale:** Doc § Token transport. Least invasive: no new table, no client state beyond URL param, no cookie scope decisions, no trigger.

### D4: `signUpWithPassword` extension shape

**Decision:** 5th positional arg `inviteToken?` (NOT options-bag). Signature becomes `signUpWithPassword(client, email, password, displayName?, inviteToken?)`. When `inviteToken` is set, attach `options.emailRedirectTo`. When `displayName + inviteToken` both set, both keys merge into the same `options` object (`options.data.display_name` + `options.emailRedirectTo`).

**Rationale:** Preserves zero existing callers — sign-up form, integration tests, and `page.test.tsx` mocks all stay binary-compatible.

### D5: `${siteUrl}` origin pinning

**Decision:** `process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin`. Optional pin: operator may set `NEXT_PUBLIC_SITE_URL=https://lalista.store` on Vercel **Production** to make the canonical URL explicit; leave unset on Preview so previews fall back to `window.location.origin`. (Earlier drafts of this decision specified a Sentry warning sentinel when the env var was unset in production; the sentinel was removed pre-merge because it fired on the wrong condition — production with the env var unset is harmless, while the preview-burn-into-7-day-email scenario the design worried about happens on `VERCEL_ENV === 'preview'`, which the sentinel explicitly skipped. The fallback already produces the correct URL on prod without the env var, so this is now a hygiene pin rather than a load-bearing setting.)

**Rationale:** Originally framed to mitigate a Vercel-preview-URL-burns-into-7-day-email scenario. In practice, `window.location.origin` self-routes correctly in every environment the user actually signs up from. The env var pin is defensive scaffolding for unusual origins (CDN proxy / iframe), not the contrived scenario.

### D6: Realtime leak window mitigation

**Decision:** Eng-review A4 mechanism — `fetchListEntries` returns `{entries, currentHouseholdId}` (selecting `current_household_id()` migration-001 helper). New typed error `RemovedFromHouseholdError` thrown when `currentHouseholdId === null`. `<ListClient>` realtime callback debounce-refetches (1s) on every event; on `RemovedFromHouseholdError`, tear down channel + redirect to `/onboarding?removed=1`. Replaces the design's original "redirect on next nav" mitigation.

**Rationale:** Self-healing on first stale event; bounds leak to ~1 round-trip. A heavier `member_removed` realtime broadcast is v1.

### D7: Single-household v0 invariant — DB layer

**Decision:** `alter table household_members add constraint household_members_one_per_user_v0 unique (user_id);` plus a comment block naming the v0 invariant + how to drop it for v1 multi-household. 23505 from this constraint maps to `'already_in_household'` typed error in API wrappers and is caught in `OnboardingForm` (`if (err.code === '23505' && err.message.includes('household_members_one_per_user_v0')) { router.push('/list'); return; }`).

**Rationale:** Eng review A3 + outside-voice OV6/C2. Loud over silent — the existing `accept_invite` "already in a household" check is application-layer; the constraint backstops the two-tab race where the app-layer check passes but the insert races.

### D8: RPC errcode convention

**Decision:** `42501` for auth/access-denied; `P0001` for domain errors. NEVER `23505` for the application-layer "already in household" check (that's reserved for the literal Postgres unique-violation from D7).

**Rationale:** Verified parity with migrations 008 + 010. `23505` is semantically misleading for application-layer checks.

### D9: `accept_invite` race semantics

**Decision:** `FOR UPDATE` row lock on the invite-lookup `select`; relies on Postgres EvaluatePlanQual (EPQ) under READ COMMITTED — when T2 blocks on T1's lock and T1 commits (setting `used_at = now()`), T2's EPQ re-applies the WHERE clause to the now-updated row, the `used_at IS NULL` predicate fails, T2 returns zero rows, the `not found` branch fires. Sentinel comment in migration source: `-- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee`. Pure-file test asserts both the `for update` line and the sentinel comment exist.

**Rationale:** Eng review T1 critical. Locks Postgres EPQ semantic; integration test verifies at runtime; pure-file test catches accidental removal at PR review time.

### D10: RPC grant pattern parity (migration 008)

**Decision:** Every RPC + helper gets the migration-008 block:

```sql
revoke all on function <fn>(<args>) from public;
revoke execute on function <fn>(<args>) from anon;
grant execute on function <fn>(<args>) to authenticated, service_role;
```

Plus a single `notify pgrst, 'reload schema';` at the bottom of the migration.

**Rationale:** Eng review A1. Closes the anon-EXECUTE gap that the in-RPC `auth.uid()` null-check would otherwise hide.

### D11: Migration-014 hardening parity

**Decision:**

- (a) Every function: `set search_path = public, pg_temp` (NOT just `public`).
- (b) Both new RLS SELECT policies (`household_invitations_select`, `household_audit_events_select`): wrap `auth.uid()` in `(select auth.uid())` for planner caching.
- (c) Add 5 FK indexes: `household_invitations.created_by`, `household_invitations.used_by`, `household_audit_events.actor_user_id`, `household_audit_events.target_user_id`, `household_audit_events.invite_id`.

**Rationale:** Eng review A2. Same conventions migration 014 just established for existing tables — no exception for new ones.

### D12: `households.name` render site

**Decision:** Subtle caption-cap on `/list` header (`font-body text-[13px] font-semibold uppercase tracking-[0.08em] text-text-secondary`), tappable → `/settings#household`. NOT a Fraunces moment. Editable via Settings § Household.

**Rationale:** Design review Pass 1 + DESIGN.md "brand personality lives in empty states… not in breaking the list layout". The list is a workspace; brand lives in empty states + sheets + onboarding.

### D13: Audit feed display-name hydration

**Decision:** Two-query pattern mirroring `addedByName` (CLAUDE.md gotcha): fetch audit rows, union `actor_user_id` + `target_user_id` into a unique-ids set, then `profiles.select('user_id, display_name').in('user_id', uniqueIds)`. NO PostgREST join through `auth.users` (relationship doesn't resolve). Null `display_name` → render 'someone'.

**Rationale:** Eng review C1. Mirrors the load-bearing two-query shape the project already uses for the same `auth.users` cross-schema FK problem.

### D14: `/join/<token>` page voice — English-only, claim-y, Fraunces italic 36

**Decision:** All chrome English. Spanish/Spanglish reserved for user item content. Canonical copy:

- `<InviteUnavailable>`: primary `that link's done` (Fraunces italic 36) / body `this invite has expired or already been used.` / caption `ask the sender for a new one.` / link `→ go to lalista`
- `<AlreadyInHousehold>`: primary `you're already in a list` / body `signed in as {display_name}.` / caption `one account, one household.` / CTAs `go to my list` + `sign out and try again`
- `<OwnInviteLink>`: primary `your link` / body `share it with the person you want to add.` / CTAs `copy link` + `← back to list`

**Rationale:** Design review Pass 4 + user clarification 2026-05-09. Warmth in chrome comes from typography (Fraunces italic at brand moments) + restraint, not language switching.

### D15: Removed-member onboarding branch

**Decision:** Realtime cleanup redirects to `/onboarding?removed=1`. `OnboardingPage` reads the query param and renders a new `<RemovedFromHouseholdNotice>` Card ABOVE the existing `OnboardingForm` (existing form behavior unchanged for first-time signups). Notice copy:

- Caption: `REMOVED FROM HOUSEHOLD` (uppercase tracking)
- Body: `the household owner removed you. you can create your own household below, or sign out.`
- Text-link: `← sign out and use a different account`
- No household name shown (privacy + handles renamed-after-removal).

Forward-compat note: when v1 multi-household lands, removed-from-one redirects to a remaining-household's `/list`, not `/onboarding`.

**Rationale:** Outside-voice OV1.

### D16: Pending-invite double-tap guard

**Decision:** Tier B `useSubmitFeedback` (already idempotent on submit) + 1s post-success cooldown before re-enabling the button. Implementation in the InviteLinkSheet open handler. No server-side dedupe.

**Rationale:** Outside-voice OV5. "No cap on pending invites" (Open Q3) still stands; this is best-effort against accidental double-tap.

### D17: Migration-vs-Vercel deploy split

**Decision:** Single PR (not split). PR test plan adds HARD BLOCKER post-merge checklist: "After merge, monitor `deploy-migrations.yml` AND Vercel deploy. Do NOT announce or share new invite links until both show success. Window is ~2-5 min where invite-tap may show `<InviteUnavailable>` because RPCs aren't yet deployed."

**Rationale:** Outside-voice OV3. Document-the-window over split-the-PR; revisit if a real outage happens.

### D18: Pre-merge empirical — query survives URL allow-list

**Decision:** PR test plan adds HARD BLOCKER pre-merge manual test against prod Supabase: `signUp` with `emailRedirectTo: <site>/auth/callback?test=42`, fetch the resulting confirmation email, confirm the link in the email body still contains `?test=42`. If not, dashboard work required (add a wildcarded entry to Auth → URL Configuration).

**Rationale:** Outside-voice OV4. Empirical verification of the load-bearing assumption that Supabase's redirect-URL allow-list matches by path, not query.

### D19: Local-Supabase confirmations test config

**Decision:** Integration test `015_household_collaborators.integration.test.ts` `beforeAll`/`afterAll` hooks flip the local Supabase `enable_confirmations = true` (via `auth.admin.updateConfig` if available; otherwise edit `supabase/config.toml` + restart auth-config). Run a real signup flow via mailpit + URL-extraction, asserting the redirect URL in the confirmation email contains `?invite=<token>`.

**Rationale:** Outside-voice OV2. Closes the load-bearing-piece coverage gap that `enable_confirmations = false` (typical local dev) would otherwise leave.

### D20: Component placement

**Decision:**

- `<RoleBadge>` lifts to `packages/ui/src/RoleBadge.tsx` (primitive enough for the design system).
- `<MemberRow>`, `<MembersSection>`, `<HouseholdSection>`, `<HouseholdAuditSection>`, `<InviteLinkSheet>`, `<RemovedFromHouseholdNotice>` stay in `apps/web/components/` (page-specific composition).
- `<InviteUnavailable>` / `<AlreadyInHousehold>` / `<OwnInviteLink>` colocate as `apps/web/app/join/[token]/_states.tsx` (private to the route; never reused).

**Rationale:** Design review Pass 5 #10/#11. Primitive vs composed — RoleBadge is reusable; the others are page-specific.

---

## In scope

- **Schema migration `015_household_collaborators.sql`** — two new tables (`household_invitations`, `household_audit_events`), six new SECURITY DEFINER RPCs (`is_household_owner`, `create_invite`, `revoke_invite`, `accept_invite`, `remove_member`, `leave_household`, `rename_household`), 5 FK indexes (D11.c), single-household v0 unique constraint on `household_members.user_id` (D7), full migration-008 grant block + `notify pgrst, 'reload schema'` (D10), `search_path = public, pg_temp` on every function (D11.a), `(select auth.uid())` planner-cache wrap on both new SELECT policies (D11.b), and the load-bearing `for update` row lock + sentinel comment in `accept_invite` (D9).
- **API wrappers** in `packages/core/src/api/`:
  - `households.ts` — extend with `fetchMyHousehold()`, `renameHousehold(name)`, `leaveHousehold()` (existing `fetchUserHouseholds`, `fetchUserMemberships`, `createHousehold` stay as-is).
  - `invitations.ts` (new) — `createInvite() → { token, url, expiresAt }`, `fetchPendingInvites() → Invite[]`, `revokeInvite(id)`, `acceptInvite(token) → householdId`.
  - `members.ts` (new) — `fetchMembers() → Member[]`, `removeMember(userId)`.
  - `audit.ts` (new) — `fetchHouseholdAudit(limit?) → AuditEvent[]` with the two-query display-name hydration pattern (D13/C1).
  - `auth.ts` — extend `signUpWithPassword` to a 5th positional `inviteToken?` arg (D4); attach `options.emailRedirectTo` when set; merge with `options.data.display_name` cleanly when both present.
  - `items.ts` — change `fetchListEntries` return type to `{ entries: HydratedListEntry[]; currentHouseholdId: string | null }` and throw new typed `RemovedFromHouseholdError` when `currentHouseholdId === null` (D6/A4).
  - Friendly-error mapping: catch `P0001` and map to typed `InviteError` union (`'expired_or_invalid' | 'already_in_household' | 'cannot_orphan' | 'owner_cannot_leave' | 'name_invalid' | 'not_found_or_used'`).
- **Settings page** (`apps/web/app/settings/page.tsx`) gains three new sections rendered after the existing Account section (Pass 1 IA): `<HouseholdSection>` (rename, owner-only write), `<MembersSection>` (members + remove + pending invites + invite-someone CTA + leave button), `<HouseholdAuditSection>` (collapsible feed of last 20 events).
- **`/list` header household-name caption** (Pass 1, D12) — subtle caption-cap line above the existing list, tap-target → `/settings#household`. NOT a Fraunces moment.
- **`<InviteLinkSheet>` component** (`apps/web/components/InviteLinkSheet.tsx`) — modal sheet mirroring `AddItemSheet`, opened after `createInvite()`. URL block + `copy` Tier B button + `share` button (Web Share API feature-detected; hidden when absent) + `expires in 7 days. one use.` caption.
- **`/sign-up?invite=<token>` integration** — read `?invite=<token>` from `useSearchParams()`, pass as 5th positional arg to `signUpWithPassword`, render the subtle `joining a lalista household.` caption above the existing form (Pass 3 NEW spec).
- **`/auth/callback?invite=<token>` integration** — extend the existing route handler to read `searchParams.get('invite')` after `exchangeCodeForSession` succeeds; if non-null, redirect to `/join/<invite>` instead of `/onboarding`.
- **`/join/[token]` page** (`apps/web/app/join/[token]/page.tsx`) — server component implementing the 7-step flow: session check → sign-up redirect (if signed-out) → invite lookup → `<InviteUnavailable>`/`<AlreadyInHousehold>`/`<OwnInviteLink>` branches → `accept_invite` → `/list` redirect. Tier C `loading.tsx` for the route.
- **`/onboarding?removed=1` branch** (D15/OV1) — render `<RemovedFromHouseholdNotice>` Card above the existing `OnboardingForm` when `?removed=1` is present.
- **Middleware allow-list extension** (`apps/web/middleware.ts`) — add `pathname.startsWith('/join/')` prefix check before the `PUBLIC_PATHS.has(pathname)` exact-match line; do NOT add `/join` to `REDIRECT_AUTHED_PATHS` (D6 + design § Middleware note).
- **New primitive** in `packages/ui/src/`: `<RoleBadge role="owner" | "member">` (D20 — primitive enough for the design system).
- **Page-level components** in `apps/web/components/`: `<MemberRow>`, `<MembersSection>`, `<HouseholdSection>`, `<HouseholdAuditSection>`, `<InviteLinkSheet>`, `<RemovedFromHouseholdNotice>` (D20).
- **Route-private state components** in `apps/web/app/join/[token]/_states.tsx`: `<InviteUnavailable>`, `<AlreadyInHousehold>`, `<OwnInviteLink>` (D20).
- **CLAUDE.md gotcha additions** for the load-bearing patterns this PR establishes (D5 origin pinning, D6 response-shape contract, D7 23505 mapping, D9 FOR UPDATE sentinel, D13 audit hydration, D17 deploy-race window, D18 query-survives-allow-list, D19 enable_confirmations flip).
- **Test coverage** — 5 E2E specs (per CLAUDE.md E2E-per-surface invariant), 7 integration cases (slow-job CI, opt-in via `VITEST_INTEGRATION=1`), 5 unit-test files (file-text FOR UPDATE assertion + module behavior).

## Out of scope (deferred)

Inherits design § "NOT in scope" + eng-review additions:

- **v1 multi-household membership.** A user belongs to exactly ONE household in v0 (per `OVERVIEW.md:60`). The new `unique (user_id)` constraint on `household_members` (D7) enforces this at the DB layer; dropping it is a v1 chapter, documented inline in the migration's comment block.
- **Ownership transfer.** Owner cannot transfer ownership; owner-attempts-leave is blocked with friendly `P0001 'owner cannot leave (transfer ownership first — v1 feature)'`. v1 chapter (Open Question 2).
- **Pending-invite cap.** No cap in v0 — owner is responsible for revoking stale ones. Reconsider if abuse appears (Open Question 3).
- **Audit retention policy.** Append-only forever in v0. Trim policies are v1+ (Open Question 4).
- **`member_removed` realtime broadcast.** A4's response-shape thread (D6) is the v0 mitigation; a heavier broadcast on a `household_members` channel is a v1 chapter — defer until soak shows the leak matters.
- **Native iOS/Android app design.** Web-first PWA per `OVERVIEW.md`.
- **Realtime audit feed updates.** Page-load only is the architectural contract.
- **Avatar uploads.** Initials only in v0.
- **Custom share-sheet UI for desktop browsers without `navigator.share`.** Copy button covers desktop; `share` is mobile-only enhancement.
- **Animated avatar transitions on member join/leave.** Static rendering; motion is future polish.
- **"Preview as new member" mode in Settings.** Owner verifies by signing up a test account.
- **Internationalization beyond Spanish/English.** v0 product is bilingual Spanglish (item content); chrome is English-only (Pass 4 voice doctrine).
- **Email-design alignment for Supabase confirmation email.** Email body lives in Supabase dashboard templates, not in this PR's web code.
- **Migration-vs-Vercel deploy split into separate PRs.** OV3 chose document-the-window over split-the-PR; revisit if a real outage happens.
- **Server-side dedupe of pending invites.** OV5 chose client-side cooldown (D16); revisit if user reports flag the rare race.
- **Custom-domain transactional emails for invite delivery.** Out-of-band sharing (iMessage, WhatsApp, voice) only.
- **Social auth.** Out of scope.
- **New PostHog/METRICS events.** Audit feed is the v0 state-change observability surface (see § Metrics).

## Screens

Per-screen specs grouped by route. Visual specs cite design Pass 1-6 verbatim; copy cites Pass 4 canonical strings.

### `/list` (existing) — household-name caption header

- **Pass 1 IA + D12 render site.** Above the existing list content, render `households.name` as caption-cap with a soft tap target → `/settings#household`.
- **Tokens** (Pass 1): `font-body text-[13px] font-semibold uppercase tracking-[0.08em] text-text-secondary`. Container `px-md pt-md pb-xs`, single line, `truncate` if overflow. 44px tap area via `min-h-[44px] inline-flex items-center`.
- **Accessibility** (Pass 6): `aria-label="Household: {name} (tap to edit in Settings)"`.
- **Loading** (Pass 2): inherits route-level `<LoadingArea>` skeleton (Tier C). Errors fall back to silent `lalista` wordmark with a Sentry breadcrumb logged.
- **Responsive** (Pass 6): same shape at all breakpoints; `truncate` if name >24 chars on 375.

### `/settings` (existing) — extended with three new sections

- **IA order** (Pass 1): Account (existing) → Household (new) → Members (new) → Activity (new). Most-touched first, audit last. Each section uses the existing pattern verified at `apps/web/app/settings/page.tsx:55-78`: caption-uppercase `tracking-[0.08em]` heading, `<Divider className="my-lg" />` between sections, body in `flex flex-col gap-sm`.
- **`<HouseholdSection>`**:
  - Owner view: editable name field via `<DisplayNameField>` shape (verified at `apps/web/components/DisplayNameField.tsx`). Tier B `SubmitButton` calling `renameHousehold`. Caption helper `created on {date}.` text-tertiary 13px.
  - Non-owner view: read-only `<Text variant="body">{household.name}</Text>` + caption `only owners can rename.` (Pass 4).
  - Save success: brief "saved" caption (250ms fade); new name renders in `/list` header on next route mount (Pass 2).
- **`<MembersSection>`**:
  - Heading: `<Text as="h2" variant="caption">Members</Text>` (Pass 5).
  - Members list — each row is `<MemberRow>`: avatar (32px circle, initial of `display_name`, `bg-primary-soft text-primary`) + name (`body 15px font-medium`; current user gets ` (you)` suffix in `text-tertiary 13px`) + `<RoleBadge>` right-aligned via `ml-auto` + remove button (owner-only, NOT shown on owner's own row) `min-h-[44px] px-sm font-body text-[13px] text-text-tertiary hover:text-error` labeled `remove` (Pass 4).
  - Pending invites subsection (only when non-empty): caption + Divider above; each row `expires Tue, May 14 · copy · revoke` (caption 13px text-secondary; copy/revoke as text-primary text-links).
  - Empty state ("just you so far"): Fraunces italic 36px primary `just you so far` / body 17px `send a link.` / caption `they'll join in seconds.` / terracotta pill `invite someone` (Pass 2 + Pass 4 canonical copy).
  - Active state: terracotta pill `invite someone` button under the members list.
  - Member-only "leave household" destructive Tier B button at the bottom (text-error variant).
- **`<HouseholdAuditSection>`**:
  - `<details className="flex flex-col gap-sm">` collapsed by default (Pass 1 Subtraction default).
  - `<summary>` with caption-uppercase heading + count badge ("4 events").
  - Body: `<ul className="flex flex-col gap-xs mt-md">`, each event `<li className="flex items-baseline justify-between gap-sm">{description}<span className="text-text-tertiary text-[13px] tabular-nums">{relativeTime}</span></li>`.
  - Empty state: caption `no activity yet.` text-tertiary 13px italic.
  - "showing last 20." caption at bottom when full (Pass 2).
- **Tab order** (Pass 6): Account → Household → Members → Activity, top-to-bottom within each section.

### `<InviteLinkSheet>` (modal opened from `/settings`)

- **Sheet shape** (Pass 5) mirrors `AddItemSheet`: `fixed inset-0 z-30 flex items-end justify-center md:items-center`. Backdrop `<button className="absolute inset-0 bg-black/40" aria-label="Close">`. Body `relative bg-surface rounded-t-lg md:rounded-lg max-w-[400px] md:max-w-[480px] w-full p-lg flex flex-col gap-md`.
- **Hierarchy** (Pass 1): caption `INVITE LINK` + close X (44px) → URL block (`bg-surface-2 rounded-default p-md font-body text-[15px] tabular-nums break-all`, selectable, tap selects) → primary `copy` (Tier B SubmitButton, label flips to `copied ✓` for 1.2s) → secondary `share` (only if `navigator.share` exists) → caption `expires in 7 days. one use.` (Pass 4).
- **Motion** (Pass 5): slides up via `transition-transform duration-[short]`; `prefers-reduced-motion: reduce` → instant.
- **Focus trap + ARIA** (Pass 6): `role="dialog" aria-modal="true" aria-labelledby="invite-link-heading"`; URL block `aria-label="Invite URL: {url}"` (full URL); opens with focus on the URL block (auto-selectable). Tab cycles URL → copy → share → close. Esc closes. Reuses existing AddItemSheet focus-trap pattern.
- **Errors** (Pass 2): copy failure → inline below button `couldn't copy — long-press the URL to select`. Share cancellation → soft fail (no toast).
- **Double-tap guard** (D16): `useSubmitFeedback` idempotence + 1s post-success cooldown before re-enabling the button.
- **Responsive** (Pass 6): 375 = bottom sheet, 768+ = centered modal.

### `/sign-up?invite=<token>` (existing, extended)

- **Sign-up context line** (Pass 3 NEW): when `?invite=<token>` is present, render single caption above the form: `joining a lalista household.` — `text-text-secondary 13px font-medium mb-sm`. The line does NOT include the household name (privacy: pre-auth lookup of `households.name` would leak identity to anyone with a token-shaped URL).
- **ARIA** (Pass 6): `<p aria-live="polite">joining a lalista household.</p>` so screen-reader users learn they're in an invite flow.
- **Wrapper integration** (D4): pass invite token as 5th positional arg to `signUpWithPassword(supabase, email, password, displayName, inviteToken)`.
- **Post-confirmation card** (Pass 2): `<AwaitingConfirmationCard>` gets caption `your invite is saved — confirm your email and you'll land in the list.` (only when `?invite=<token>` is present).

### `/auth/callback?invite=<token>` (existing route handler, extended)

- After successful `exchangeCodeForSession`, read `searchParams.get('invite')`. If non-null, `return NextResponse.redirect(new URL(\`/join/${invite}\`, origin))`. Otherwise existing behavior (recovery → `/reset-password`; signup → `/onboarding`).
- One-line conditional addition; no new error branches (existing `?confirm-error=expired` handling stays).

### `/join/[token]` (new route)

Server component implementing the 7-step flow per design § "Expired-during-confirm + already-signed-in-as-different-account":

1. Read session via `supabase.auth.getUser()`.
2. **No session?** Redirect to `/sign-up?invite=<token>` (preserves token for post-confirm callback).
3. **Session exists.** Look up invite: `select household_id, used_at, expires_at, created_by from household_invitations where token = <token>`.
4. **Token not found / used / expired?** Render `<InviteUnavailable>`. (No revealing of household_id.)
5. **Already in a household?** `select household_id from household_members where user_id = auth.uid()` — if non-empty AND not same household → render `<AlreadyInHousehold>`.
6. **User is the inviter?** If invite's `created_by = auth.uid()` AND invite's `household_id` matches caller's household → render `<OwnInviteLink>`. UI-layer cosmetic check ONLY; the RPC's enforcement comes from the "already in a household" branch in `accept_invite`.
7. **All checks pass.** Call `accept_invite(token)` RPC, redirect to `/list`. RPC errors fall through to `<InviteUnavailable>` (deliberate generic — never expose invite-table internals).

**Tier C loading.tsx**: `apps/web/app/join/[token]/loading.tsx` paints `<LoadingArea>` pulse during the join transition.

**State pages** (Pass 5 token mapping; Pass 4 canonical copy):

| State                  | Primary (Fraunces 36 italic) | Body (17px)                                     | Caption (13px)                  | Primary CTA                       | Secondary CTA                           |
| ---------------------- | ---------------------------- | ----------------------------------------------- | ------------------------------- | --------------------------------- | --------------------------------------- |
| `<InviteUnavailable>`  | `that link's done`           | `this invite has expired or already been used.` | `ask the sender for a new one.` | `→ go to lalista` (text link)     | —                                       |
| `<AlreadyInHousehold>` | `you're already in a list`   | `signed in as {display_name}.`                  | `one account, one household.`   | `go to my list` (terracotta pill) | `sign out and try again` (outline pill) |
| `<OwnInviteLink>`      | `your link`                  | `share it with the person you want to add.`     | —                               | `copy link` (terracotta pill)     | `← back to list` (text link)            |

Container: `flex flex-1 flex-col items-center justify-center gap-md p-xl text-center min-h-screen` (full route). Primary line `font-display text-[36px] font-light italic leading-[1.2] text-text-primary`. Pill CTA `mt-sm min-h-[44px] rounded-[100px] bg-primary px-md py-sm font-body text-[15px] font-medium text-white hover:bg-primary-pressed`. Outline pill `border border-border bg-transparent text-text-primary hover:bg-surface-2`. Text link `font-body text-[15px] text-primary hover:text-primary-pressed underline-offset-4 hover:underline`.

**ARIA** (Pass 6): full page `<main role="main" aria-labelledby="state-heading">` with the Fraunces line as `<h1 id="state-heading">`. Primary CTA gets focus on mount via `useEffect(() => primaryCtaRef.current?.focus(), [])`.

**Responsive** (Pass 6): 375 `p-xl` content `max-w-[24rem]`; 768+ `max-w-[28rem]`.

### `/onboarding?removed=1` (existing, extended)

- **`<RemovedFromHouseholdNotice>` card** (D15/OV1) renders ABOVE the existing `OnboardingForm`. Existing form behavior unchanged for first-time signups.
- **Copy** (Pass 4 voice doctrine, English-only):
  - Caption: `REMOVED FROM HOUSEHOLD` (uppercase tracking)
  - Body: `the household owner removed you. you can create your own household below, or sign out.`
  - Text-link: `← sign out and use a different account`
- **Privacy**: no household name shown (handles renamed-after-removal case).
- **Forward-compat note** (D15): when v1 multi-household lands, removed-from-one redirects to a remaining-household's `/list`, not `/onboarding`. The `?removed=1` banner pattern still applies for the N=0 case.

## Data model changes

Single migration `supabase/migrations/015_household_collaborators.sql`. The SQL below is preserved verbatim from the design doc — it encodes A1 (grant block parity) + A2 (search_path + planner-cache wrap + FK indexes) + A3 (single-household constraint) + A4 (current_household_id helper from migration 001 — already exists) + D8 (errcode convention) + D9 (FOR UPDATE + sentinel) + D10 (notify pgrst at bottom).

```sql
-- Migration 015: household-collaborators
--
-- Adds the share/invite loop on top of the existing households + household_members
-- + role columns (migrations 001 + 008). Two new tables, six new SECURITY DEFINER
-- RPCs, and one DB-layer single-household v0 invariant.
--
-- v0 invariant (drop in v1+ multi-household chapter):
--   household_members.household_members_one_per_user_v0 — UNIQUE(user_id)
--   When v1 ships multi-household, drop this constraint AND audit every RLS
--   subquery against household_members for `user_id = auth.uid()` semantics.

-- 1. household_invitations
create table household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  token text not null unique,                         -- 32-char URL-safe random
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,                    -- created_at + 7 days
  used_at timestamptz,                                -- null = pending
  used_by uuid references auth.users(id) on delete set null
);

create index on household_invitations (household_id) where used_at is null;
create index on household_invitations (token) where used_at is null;
-- A2.c FK indexes
create index on household_invitations (created_by);
create index on household_invitations (used_by);

alter table household_invitations enable row level security;

-- Members see only PENDING invitations of their household. Used invites are
-- visible only via household_audit_events (canonical post-hoc store).
-- A2.b: wrap auth.uid() in (select auth.uid()) for planner caching.
create policy "household_invitations_select" on household_invitations
  for select using (
    used_at is null
    and household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    )
  );

-- No client INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER
-- RPCs below. Default-deny for the authenticated role.

-- 2. household_audit_events (no metadata jsonb — every event has dedicated cols)
create table household_audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'invite_created', 'invite_revoked', 'invite_used',
    'member_removed', 'member_left', 'household_renamed'
  )),
  target_user_id uuid references auth.users(id) on delete set null,
  invite_id uuid references household_invitations(id) on delete set null,
  old_name text,                                      -- only for household_renamed
  new_name text,                                      -- only for household_renamed
  created_at timestamptz not null default now()
);

create index on household_audit_events (household_id, created_at desc);
-- A2.c FK indexes
create index on household_audit_events (actor_user_id);
create index on household_audit_events (target_user_id);
create index on household_audit_events (invite_id);

alter table household_audit_events enable row level security;

-- A2.b: wrap auth.uid() in (select auth.uid()) for planner caching.
create policy "household_audit_events_select" on household_audit_events
  for select using (
    household_id in (select household_id from household_members where user_id = (select auth.uid()))
  );
-- Writes: SECURITY DEFINER RPCs only.

-- 3. Single-household v0 invariant (A3 / D7).
-- LOAD-BEARING(do-not-remove without v1 plan): backstops the application-layer
-- "already in household" check in accept_invite against the two-tab race.
-- 23505 from this constraint maps to InviteError 'already_in_household' in
-- API wrappers and is caught by OnboardingForm to bounce the user to /list.
alter table household_members
  add constraint household_members_one_per_user_v0 unique (user_id);

comment on constraint household_members_one_per_user_v0 on household_members is
  'v0 single-household invariant: a user belongs to at most one household. '
  'Drop this constraint when v1 multi-household ships, and audit every RLS '
  'subquery against household_members for user_id = auth.uid() semantics.';

-- 4. RPCs (6 total — every owner action + invitee acceptance + helper)
-- A1: revoke from public + revoke execute from anon + grant to authenticated/service_role
-- A2.a: search_path = public, pg_temp on every function

-- Helper: is the caller the owner of this household?
create or replace function is_household_owner(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from household_members
    where household_id = p_household_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;
revoke all on function is_household_owner(uuid) from public;
revoke execute on function is_household_owner(uuid) from anon;
grant execute on function is_household_owner(uuid) to authenticated, service_role;

-- create_invite: owner-only, returns the token (client builds the URL)
create or replace function create_invite()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
  v_token text;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id into v_household_id
    from household_members where user_id = v_user and role = 'owner';
  if v_household_id is null then
    raise exception 'only owners can create invites' using errcode = '42501';
  end if;

  v_token := encode(gen_random_bytes(24), 'base64');
  v_token := replace(replace(replace(v_token, '+', '-'), '/', '_'), '=', '');

  insert into household_invitations (household_id, token, created_by, expires_at)
    values (v_household_id, v_token, v_user, now() + interval '7 days');

  insert into household_audit_events (household_id, actor_user_id, event_type, invite_id)
    select v_household_id, v_user, 'invite_created', id
      from household_invitations where token = v_token;

  return v_token;
end;
$$;
revoke all on function create_invite() from public;
revoke execute on function create_invite() from anon;
grant execute on function create_invite() to authenticated, service_role;

-- revoke_invite: owner-only, deletes pending invite (RLS DELETE policy not needed —
-- we use SECURITY DEFINER instead of relying on a delete policy, for consistency).
create or replace function revoke_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id into v_household_id
    from household_invitations where id = p_invite_id and used_at is null;
  if v_household_id is null then
    raise exception 'invite not found or already used' using errcode = 'P0001';
  end if;
  if not is_household_owner(v_household_id) then
    raise exception 'only owners can revoke invites' using errcode = '42501';
  end if;

  delete from household_invitations where id = p_invite_id;
  insert into household_audit_events (household_id, actor_user_id, event_type, invite_id)
    values (v_household_id, v_user, 'invite_revoked', p_invite_id);
end;
$$;
revoke all on function revoke_invite(uuid) from public;
revoke execute on function revoke_invite(uuid) from anon;
grant execute on function revoke_invite(uuid) to authenticated, service_role;

-- accept_invite: invitee acceptance. Race-safe via FOR UPDATE row lock.
-- Postgres semantics under READ COMMITTED: when transaction T2 blocks on
-- the row lock T1 holds, then T1 commits (setting used_at = now()), T2's
-- EvaluatePlanQual (EPQ) re-applies the WHERE clause to the now-updated
-- row version. The `used_at IS NULL` predicate fails on the updated row,
-- T2's SELECT returns zero rows, and the `not found` branch fires. So:
-- two concurrent acceptances of the same token → one succeeds, one gets
-- `P0001 'invite invalid or expired'`. Do NOT remove the FOR UPDATE.
create or replace function accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite household_invitations%rowtype;
  v_user uuid := auth.uid();
  v_existing_household uuid;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id into v_existing_household
    from household_members where user_id = v_user limit 1;
  if v_existing_household is not null then
    raise exception 'already in a household' using errcode = 'P0001';
  end if;

  -- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee
  select * into v_invite from household_invitations
    where token = p_token and used_at is null and expires_at > now()
    for update;
  if not found then
    raise exception 'invite invalid or expired' using errcode = 'P0001';
  end if;

  insert into household_members (household_id, user_id, role)
    values (v_invite.household_id, v_user, 'member');
  update household_invitations set used_at = now(), used_by = v_user
    where id = v_invite.id;
  insert into household_audit_events (household_id, actor_user_id, event_type, target_user_id, invite_id)
    values (v_invite.household_id, v_user, 'invite_used', v_user, v_invite.id);

  return v_invite.household_id;
end;
$$;
revoke all on function accept_invite(text) from public;
revoke execute on function accept_invite(text) from anon;
grant execute on function accept_invite(text) to authenticated, service_role;

-- remove_member: owner-only, cannot remove self (use leave_household).
create or replace function remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  if p_user_id = v_user then
    raise exception 'use leave_household to remove yourself' using errcode = 'P0001';
  end if;

  select household_id into v_household_id
    from household_members where user_id = p_user_id;
  if v_household_id is null then
    raise exception 'member not found' using errcode = 'P0001';
  end if;
  if not is_household_owner(v_household_id) then
    raise exception 'only owners can remove members' using errcode = '42501';
  end if;

  delete from household_members where household_id = v_household_id and user_id = p_user_id;
  insert into household_audit_events (household_id, actor_user_id, event_type, target_user_id)
    values (v_household_id, v_user, 'member_removed', p_user_id);
end;
$$;
revoke all on function remove_member(uuid) from public;
revoke execute on function remove_member(uuid) from anon;
grant execute on function remove_member(uuid) to authenticated, service_role;

-- leave_household: any member, blocks last-member orphaning. Owner cannot
-- leave in v0 (would orphan; ownership transfer is v1+).
create or replace function leave_household()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
  v_role text;
  v_count int;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id, role into v_household_id, v_role
    from household_members where user_id = v_user;
  if v_household_id is null then
    raise exception 'not in a household' using errcode = 'P0001';
  end if;
  if v_role = 'owner' then
    raise exception 'owner cannot leave (transfer ownership first — v1 feature)' using errcode = 'P0001';
  end if;

  select count(*) into v_count from household_members where household_id = v_household_id;
  if v_count <= 1 then
    raise exception 'cannot orphan household' using errcode = 'P0001';
  end if;

  delete from household_members where household_id = v_household_id and user_id = v_user;
  insert into household_audit_events (household_id, actor_user_id, event_type, target_user_id)
    values (v_household_id, v_user, 'member_left', v_user);
end;
$$;
revoke all on function leave_household() from public;
revoke execute on function leave_household() from anon;
grant execute on function leave_household() to authenticated, service_role;

-- rename_household: owner-only. Note: there is intentionally NO client UPDATE
-- policy on `households` (verified — migration 001 has only households_select).
-- All writes to households.name go through this RPC, which is SECURITY DEFINER
-- and bypasses RLS. Spec author: do NOT add a redundant UPDATE policy.
create or replace function rename_household(p_new_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
  v_old_name text;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  p_new_name := nullif(trim(p_new_name), '');
  if p_new_name is null or length(p_new_name) > 60 then
    raise exception 'name must be 1-60 chars' using errcode = 'P0001';
  end if;

  select household_id into v_household_id
    from household_members where user_id = v_user and role = 'owner';
  if v_household_id is null then
    raise exception 'only owners can rename' using errcode = '42501';
  end if;

  select name into v_old_name from households where id = v_household_id;
  update households set name = p_new_name where id = v_household_id;
  insert into household_audit_events (household_id, actor_user_id, event_type, old_name, new_name)
    values (v_household_id, v_user, 'household_renamed', v_old_name, p_new_name);
end;
$$;
revoke all on function rename_household(text) from public;
revoke execute on function rename_household(text) from anon;
grant execute on function rename_household(text) to authenticated, service_role;

-- Tell PostgREST to reload its schema cache so the new RPCs are callable
-- via the rest API immediately on deploy. (Migration 008 pattern.)
notify pgrst, 'reload schema';
```

**Reuses existing migration-001 helper** `current_household_id()` — load-bearing for A4's response-shape thread (D6). No new helper needed.

## API contracts

```ts
// packages/core/src/api/auth.ts — extend signUpWithPassword (D4)

export async function signUpWithPassword(
  client: Client,
  email: string,
  password: string,
  displayName?: string,
  inviteToken?: string // NEW: 5th positional arg, NOT options-bag
): Promise<AuthResponse>;

// Behavior:
// - inviteToken absent: existing behavior (preserves zero existing callers).
// - inviteToken present: build options.emailRedirectTo as
//   `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback?invite=${encodeURIComponent(inviteToken)}`.
// - When BOTH displayName + inviteToken set: options merges into a single
//   object — { data: { display_name: trimmed }, emailRedirectTo: '...' }.
```

```ts
// packages/core/src/api/items.ts — fetchListEntries response-shape change (D6/A4)

export class RemovedFromHouseholdError extends Error {
  constructor() {
    super('removed from household');
    this.name = 'RemovedFromHouseholdError';
  }
}

export interface ListEntriesResult {
  entries: HydratedListEntry[];
  currentHouseholdId: string | null;
}

// Selects current_household_id() helper alongside list_entries rows.
// Throws RemovedFromHouseholdError when currentHouseholdId === null AND the
// caller specifically depended on continued household membership (i.e. always —
// the page-level caller is what catches and triggers /onboarding?removed=1
// redirect).
export async function fetchListEntries(
  client: Client,
  householdId: string,
  status: ListEntryStatus = 'pending'
): Promise<ListEntriesResult>;
```

```ts
// packages/core/src/api/households.ts — extend with three new wrappers

export interface MyHousehold {
  id: string;
  name: string;
  createdAt: string;
  myRole: 'owner' | 'member';
}

/** Fetch the caller's current household + their role. Null if not in any household. */
export async function fetchMyHousehold(
  client: Client
): Promise<MyHousehold | null>;

/** Owner-only. Calls rename_household RPC; maps P0001 'name must be 1-60 chars' → InviteError 'name_invalid'. */
export async function renameHousehold(
  client: Client,
  name: string
): Promise<void>;

/** Member-only. Calls leave_household RPC; maps P0001 'owner cannot leave' → InviteError 'owner_cannot_leave'; 'cannot orphan' → 'cannot_orphan'. */
export async function leaveHousehold(client: Client): Promise<void>;
```

```ts
// packages/core/src/api/invitations.ts — NEW

export interface Invite {
  id: string;
  token: string;
  url: string; // computed client-side: `${NEXT_PUBLIC_SITE_URL ?? location.origin}/join/${token}`
  expiresAt: string;
  createdAt: string;
}

export interface CreatedInvite {
  token: string;
  url: string;
  expiresAt: string;
}

/** Owner-only. Calls create_invite RPC, builds the URL, returns the bundle. */
export async function createInvite(client: Client): Promise<CreatedInvite>;

/** Lists pending invites of caller's household via household_invitations RLS SELECT. */
export async function fetchPendingInvites(client: Client): Promise<Invite[]>;

/** Owner-only. Calls revoke_invite RPC; maps P0001 'not found or used' → InviteError 'not_found_or_used'. */
export async function revokeInvite(
  client: Client,
  inviteId: string
): Promise<void>;

/** Calls accept_invite RPC; maps P0001 'already in a household' → 'already_in_household'; 'invite invalid or expired' → 'expired_or_invalid'. */
export async function acceptInvite(
  client: Client,
  token: string
): Promise<string>;
```

```ts
// packages/core/src/api/members.ts — NEW

export interface Member {
  userId: string;
  displayName: string | null; // null when profile row missing or auth.users deleted
  role: 'owner' | 'member';
  joinedAt: string;
}

/** Lists members of caller's household. Two-query hydration of display_name (D13/C1). */
export async function fetchMembers(client: Client): Promise<Member[]>;

/** Owner-only. Calls remove_member RPC. */
export async function removeMember(
  client: Client,
  userId: string
): Promise<void>;
```

```ts
// packages/core/src/api/audit.ts — NEW

export type AuditEventType =
  | 'invite_created'
  | 'invite_revoked'
  | 'invite_used'
  | 'member_removed'
  | 'member_left'
  | 'household_renamed';

export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  actorUserId: string | null;
  actorName: string | null; // 'someone' fallback rendered in UI when null
  targetUserId: string | null;
  targetName: string | null; // same fallback
  inviteId: string | null;
  oldName: string | null;
  newName: string | null;
  createdAt: string;
}

/**
 * Fetch the household audit feed (default last 20). Uses the two-query
 * display-name hydration pattern (D13/C1) — fetches audit rows, unions
 * actor_user_id + target_user_id into a unique-ids set, then
 * profiles.select('user_id, display_name').in('user_id', uniqueIds).
 * Do NOT attempt PostgREST join through auth.users — it doesn't resolve.
 */
export async function fetchHouseholdAudit(
  client: Client,
  limit?: number
): Promise<AuditEvent[]>;
```

**Friendly-error mapping** (design § API wrappers, line 372): every wrapper that calls an RPC catches `P0001` errors and maps the message string to a typed `InviteError` union member:

```ts
export type InviteError =
  | 'expired_or_invalid'
  | 'already_in_household'
  | 'cannot_orphan'
  | 'owner_cannot_leave'
  | 'name_invalid'
  | 'not_found_or_used';

// `23505` from household_members_one_per_user_v0 → 'already_in_household' (D7).
// 23505 is reserved EXCLUSIVELY for the literal Postgres unique-violation;
// application-layer "already in household" checks use P0001 (D8).
```

## Offline behavior / latency feedback tiers

Per CLAUDE.md framework. Each new interactive surface maps to exactly one tier; primitives consumed are noted.

| Surface                                   | Tier | Primitive consumed                                   | Notes                                                                                                                                                      |
| ----------------------------------------- | ---- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings → "invite someone" button        | B    | `SubmitButton` (`@lalista/ui`)                       | RPC round-trip then sheet open; spinner-after-250ms                                                                                                        |
| `<InviteLinkSheet>` `copy` button         | B    | `SubmitButton`                                       | Sync clipboard write but uses `useSubmitFeedback` for the "copied ✓" 1.2s success label                                                                    |
| `<InviteLinkSheet>` `share` button        | D    | CSS `:active` only                                   | Native iOS/Android sheet takes over instantly                                                                                                              |
| `<HouseholdSection>` rename submit        | B    | `SubmitButton`                                       | Owner-only; spinner-after-250ms; brief "saved" 250ms fade post-success                                                                                     |
| `<MembersSection>` remove member          | A1   | `useOptimisticMutation({ failureMode: 'rollback' })` | Row dims optimistically `opacity-50 pointer-events-none`; on error row restores + `<SyncErrorBanner>` cross-screen "couldn't remove {name} — retry / undo" |
| `<MembersSection>` "leave household"      | B    | `SubmitButton` (destructive variant — text-error)    | Redirects to `/onboarding` on success; inline error on failure                                                                                             |
| `<MembersSection>` revoke pending invite  | A1   | `useOptimisticMutation({ failureMode: 'rollback' })` | Row dims; slides out 150ms ease-out on success; restores on error                                                                                          |
| `/join/[token]` whole route               | C    | `loading.tsx` + `<LoadingArea>`                      | Full-route Tier C; all errors render `<InviteUnavailable>` deliberately (never expose internals)                                                           |
| `/sign-up?invite=` submit                 | B    | `SubmitButton`                                       | Existing Tier B; only the wrapper receives a 5th arg                                                                                                       |
| `<AwaitingConfirmationCard>` resend       | B    | `SubmitButton`                                       | Existing                                                                                                                                                   |
| Settings → Activity `<details>` expand    | D    | Native `<summary>`/`<details>`                       | First-expand pulse on body before audit query resolves                                                                                                     |
| Tap `/list` header household-name caption | C    | `loading.tsx` + `<LoadingArea>`                      | Inherited from `/settings` route Tier C                                                                                                                    |

No new tier primitives created; this PR consumes the chapter-1m primitives unchanged.

## Metrics

**No new PostHog events. `METRICS.md` is unchanged.** Verified against design doc — there is no PostHog event taxonomy proposed for this feature. State-change observability lives in the new `household_audit_events` table (server-side, RLS-bound, viewable in Settings → Activity per Pass 1 IA).

**Existing events fire as-is.** `error_displayed` (already fired by `<SyncErrorBanner>`) covers Tier A2-style failures even though this PR is mostly Tier A1 / Tier B. `auth_signup_succeeded` (existing) fires on the post-invite signup flow without modification.

## Files to create / modify / delete

### Create (new files)

**Migration:**

- `supabase/migrations/015_household_collaborators.sql` — full DDL above.
- `supabase/migrations/015_household_collaborators.test.ts` — pure-file unit test (T8 CRITICAL): assert migration body contains `for update` line inside `accept_invite` AND sentinel comment `-- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee`. Catches accidental removal at PR review time.
- `supabase/migrations/015_household_collaborators.integration.test.ts` — slow-job integration suite (opt-in via `VITEST_INTEGRATION=1`). 7 cases covering T1-T2 critical races + boundaries + audit hydration + revoke-vs-accept race + 23505 mapping + name-length boundaries.

**API wrappers (`packages/core/src/api/`):**

- `invitations.ts` + `invitations.test.ts` (unit tests for the 4 wrappers + InviteError mapping).
- `members.ts` + `members.test.ts` (unit tests for the 2 wrappers + two-query display-name hydration).
- `audit.ts` + `audit.test.ts` (unit tests for two-query hydration + 'someone' fallback + sort order).

**UI primitive (`packages/ui/src/`):**

- `RoleBadge.tsx` + `RoleBadge.test.tsx` (D20 — primitive lifts to design system).

**Page-level components (`apps/web/components/`):**

- `MemberRow.tsx`
- `MembersSection.tsx`
- `HouseholdSection.tsx`
- `HouseholdAuditSection.tsx`
- `InviteLinkSheet.tsx`
- `RemovedFromHouseholdNotice.tsx`

**Routes (`apps/web/app/`):**

- `join/[token]/page.tsx` — server component, 7-step flow.
- `join/[token]/loading.tsx` — Tier C `<LoadingArea>` placeholder.
- `join/[token]/_states.tsx` — colocated `<InviteUnavailable>`, `<AlreadyInHousehold>`, `<OwnInviteLink>` (D20 — never reused outside the route).

**Tests (existing test surfaces extended; new suites also created):**

- `apps/web/middleware.test.ts` — extend if exists, else create. T11: `/join/<token>` allow-list assertions.
- `packages/core/src/api/auth.test.ts` (existing) — extend with T10: 5th-positional `inviteToken` cases.
- `apps/web/components/auth/friendlyAuthError.test.ts` — extend with T12: 6 InviteError mapping cases (or new `apps/web/lib/inviteErrors.test.ts` if `friendlyAuthError` module shape doesn't fit).

**E2E specs (`apps/web/e2e/`):**

- `household-invite-happy-path.spec.ts` — owner generates link, second context signs up via link (covers email-confirm gap with mailpit per D19), both see same list realtime.
- `household-invite-edge-cases.spec.ts` — expired token, used token, invitee already in household, non-owner tries to invite, owner removes member + T13 CRITICAL realtime teardown extension.
- `household-invite-self-cases.spec.ts` — owner clicks own link (`<OwnInviteLink>`), invitee signed in as different account (`<AlreadyInHousehold>`).
- `household-rename.spec.ts` — owner renames; name appears on second member's `/list` header on next page load. T14: owner-vs-member view of `<HouseholdSection>` (editable input vs. read-only + caption).
- `household-leave.spec.ts` — member leaves, owner blocked, last-member blocked.

### Modify (existing files)

**API wrappers:**

- `packages/core/src/api/auth.ts` — extend `signUpWithPassword` to 5-arg shape (D4); `resolveAuthSiteOrigin` reads `NEXT_PUBLIC_SITE_URL` with `window.location.origin` fallback (D5).
- `packages/core/src/api/items.ts` — change `fetchListEntries` return type to `{ entries, currentHouseholdId }`; export `RemovedFromHouseholdError` (D6/A4).
- `packages/core/src/api/items.test.ts` — update existing assertions to the new shape; add T9: `currentHouseholdId === null` throws `RemovedFromHouseholdError`.
- `packages/core/src/api/households.ts` — add `fetchMyHousehold`, `renameHousehold`, `leaveHousehold` (existing functions stay).
- `packages/core/src/api/households.test.ts` — extend with new wrapper unit tests.
- `packages/core/src/index.ts` — export new wrappers + `InviteError` + `RemovedFromHouseholdError`.
- `packages/core/src/supabase.types.ts` — regenerate after migration 015 (`pnpm db:gen-types`); will include the two new tables + 6 new RPCs.

**UI:**

- `packages/ui/src/index.ts` — export `RoleBadge`.

**Pages:**

- `apps/web/app/list/page.tsx` — render the household-name caption header above the existing list (calls `fetchMyHousehold`).
- `apps/web/app/list/ListClient.tsx` (or wherever the realtime channel + list state lives) — adopt the new `fetchListEntries` response shape; on `RemovedFromHouseholdError`, tear down the channel via the existing `unsubscribe` and `router.push('/onboarding?removed=1')`. Debounce-refetch (1s) on every realtime event.
- `apps/web/app/settings/page.tsx` — render `<HouseholdSection>`, `<MembersSection>`, `<HouseholdAuditSection>` after the existing Account section, in that order (Pass 1 IA).
- `apps/web/app/(auth)/sign-up/page.tsx` — read `?invite=<token>` from `useSearchParams()`, pass as 5th positional to `signUpWithPassword`, render the subtle `joining a lalista household.` caption (Pass 3) above the form when invite is present.
- `apps/web/components/AwaitingConfirmationCard.tsx` — when invite-context flag set, append the caption `your invite is saved — confirm your email and you'll land in the list.` (Pass 2).
- `apps/web/app/(auth)/onboarding/page.tsx` — read `?removed=1` searchParam; render `<RemovedFromHouseholdNotice>` above existing `<OnboardingForm>`.
- `apps/web/app/(auth)/onboarding/OnboardingForm.tsx` (existing) — add 23505 catch (D7/C2): `if (err.code === '23505' && err.message.includes('household_members_one_per_user_v0')) { router.push('/list'); return; }`.
- `apps/web/app/auth/callback/route.ts` — extend the success branch to `if (invite) return NextResponse.redirect(new URL(\`/join/${invite}\`, origin))` before existing recovery/onboarding redirect logic.
- `apps/web/middleware.ts` — add `pathname.startsWith('/join/')` prefix check; combine with `PUBLIC_PATHS.has(pathname)` (`isPublic = isJoin || PUBLIC_PATHS.has(pathname)`).

**Docs:**

- `CLAUDE.md` — append the 8 new gotcha entries described in § Gotchas.
- `BUILD-LOG.md` — append the chapter-N entry post-merge (auto-handled by `/ak-go-live`).
- `PLAN.md` — flip the household-collaborators row from "Planned" to "Shipped" post-merge.

### Delete

None. The placeholder `apps/web/components/HouseholdInfo.tsx` (referenced in design § Pass 5 #4 as being "replaced by `<MembersSection>`") is replaced via modify rather than rename — verify during implementation whether the placeholder exists; if it does, delete it; if it doesn't, the create step lands `MembersSection.tsx` directly.

## Tests

Full catalog from `.gstack/projects/meirmsn-lalista/node-feat-household-collaborators-eng-review-test-plan-...md`. **CRITICAL (must land before merge): T1, T2, T3, T8, T13.** Five tests gate the merge.

### Integration tests — `supabase/migrations/015_household_collaborators.integration.test.ts`

Opt-in via `VITEST_INTEGRATION=1` per CLAUDE.md gotcha; runs on slow-job CI; requires local Supabase via `supabase-runner` sibling container. **Per-test config flip (D19/OV2): `beforeAll` enables `auth.email.enable_confirmations = true`; `afterAll` restores.** Use `auth.admin.updateConfig` if available; otherwise edit `supabase/config.toml` + restart auth-config via the cmd-relay.

1. **T1 CRITICAL — Concurrent `accept_invite` race.** Spawn 2 admin-impersonated sessions. `Promise.all([rpc('accept_invite', token), rpc('accept_invite', token)])`. Assert: exactly one resolves with `household_id`; the other rejects with code `P0001` and message `'invite invalid or expired'`.
2. **T2a CRITICAL — Token expiry boundary (just-inside).** `create_invite()` → `update household_invitations set expires_at = now() + interval '1 second' where token = ?` → wait 100ms → `accept_invite()` → assert success.
3. **T2b CRITICAL — Token expiry boundary (just-outside).** `create_invite()` → `update household_invitations set expires_at = now() - interval '1 second' where token = ?` → `accept_invite()` → assert `P0001 'invite invalid or expired'`.
4. **23505 from `unique (user_id)` constraint race.** Simulate the race where the application-layer "already in household" check passes but the membership insert fails at Postgres level. Assert the API wrapper maps `23505` (with constraint name match `household_members_one_per_user_v0`) → `InviteError 'already_in_household'`.
5. **`rename_household` name-length boundaries.** 0 chars (whitespace) → `P0001 'name must be 1-60 chars'`; 60 chars → success; 61 chars → `P0001 'name must be 1-60 chars'`.
6. **Audit feed display-name hydration (C1).** Setup: owner Alice creates invite, member Bob accepts, Alice removes Bob, Alice renames household. Fetch audit. Assert: every row's `actor_user_id` and `target_user_id` resolve to the right `display_name`. Then delete Bob from `auth.users`; re-fetch audit; assert events where Bob was actor or target render `'someone'` (null fallback).
7. **`revoke_invite` + `accept_invite` race.** Owner revokes invite while invitee is mid-acceptance. The `for update` lock in `accept_invite` should serialize. Assert no torn state: either invitee succeeds + revoke is a no-op, OR invitee gets `P0001` + revoke succeeds.
8. **Email-confirm-gap with mailpit (OV2/D19).** `signUp` with invite-bearing `emailRedirectTo`; fetch the resulting confirmation email from mailpit's HTTP API; assert the link in the email body contains `?invite=<token>`. Closes the load-bearing-piece coverage gap.

### Unit tests — pure-file + module behavior

8. **T8 CRITICAL — `accept_invite` source-level `FOR UPDATE` assertion** (`supabase/migrations/015_household_collaborators.test.ts`). Pure file read. Assert migration text contains: (a) a line matching `/for update/i` inside the `accept_invite` function body; (b) the sentinel comment `-- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee` near it. **This test ships in the SAME commit as the migration** so the sentinel is enforced from day 1.
9. **`fetchListEntries` returns `{entries, currentHouseholdId}`** (`packages/core/src/api/items.test.ts` extension). (a) Mock supabase response with the new shape → wrapper returns the new shape. (b) Mock with `currentHouseholdId === null` → wrapper throws `RemovedFromHouseholdError`.
10. **`signUpWithPassword` 5th-positional `inviteToken`** (`packages/core/src/api/auth.test.ts` extension). (a) No token → `options.emailRedirectTo` is NOT set (preserves existing callers). (b) With token → `options.emailRedirectTo === \`${siteUrl}/auth/callback?invite=<encoded-token>\``. (c) `displayName + inviteToken`both set → both`options.data.display_name`AND`options.emailRedirectTo`present, no key collision. (d)`NEXT_PUBLIC_SITE_URL`unset → falls back to`window.location.origin`.
11. **Middleware `/join/` allow-list** (`apps/web/middleware.test.ts`). (a) `/join/abc` unauth → passes through (no redirect to `/sign-in`). (b) `/join/anything-with-hyphens` unauth → passes through. (c) `/joined` (typo, single segment) unauth → gets `/sign-in?next=...` (no startsWith match). (d) `/join` (no trailing slash + no token segment) unauth → gets `/sign-in?next=...` (no token = no flow).
12. **Friendly `InviteError` mapping** (`packages/core/src/api/invitations.test.ts` + `members.test.ts` + `households.test.ts`). For each of the 6 typed `InviteError` values, assert the wrapper catches the matching `P0001` message and returns the typed error: `'expired_or_invalid'`, `'already_in_household'`, `'cannot_orphan'`, `'owner_cannot_leave'`, `'name_invalid'`, `'not_found_or_used'`. Plus the 23505 case (constraint-name match).

### E2E specs (`apps/web/e2e/`)

Per CLAUDE.md E2E-per-surface invariant — every new page gets a spec; every new wrapper is either covered transitively (cite in JSDoc) or has a dedicated spec.

- **`household-invite-happy-path.spec.ts`** — owner generates link in `/settings` → second context taps link signed-out → `/sign-up?invite=…` → fills form → mailpit URL extraction (D19's `enable_confirmations = true` flag set per-test) → confirmation link → `/auth/callback?invite=…` → `/join/<token>` → `accept_invite` → `/list` lands with shared items. Assert both contexts see the same list state via existing `subscribeToList`.
- **`household-invite-edge-cases.spec.ts`** — expired token (manual `update household_invitations set expires_at = now() - interval '1 day'`); used token; invitee already in household (different one); non-owner tries to invite (UI hides button + RPC rejects); owner removes member.
  - **T13 CRITICAL extension**: extends "owner removes member" — (1) Owner removes member. (2) Owner adds an item (fires realtime event into removed-user channel). (3) Within ~2s, removed user's UI is on `/onboarding?removed=1`. (4) Owner adds another item. (5) Removed user's session does NOT receive it (use `routeWebSocket` per `realtime.spec.ts` pattern, or DOM-poll for the new item not appearing).
- **`household-invite-self-cases.spec.ts`** — owner clicks own link → `<OwnInviteLink>`. Invitee signed in as different account → `<AlreadyInHousehold>`.
- **`household-rename.spec.ts`** — owner renames, name appears on second member's `/list` header on next page load (Realtime on `households` is intentionally NOT subscribed). **T14 extension**: owner-vs-member view of `<HouseholdSection>` — owner sees editable input + save button; member sees read-only `households.name` + caption `only owners can rename.`.
- **`household-leave.spec.ts`** — member leaves (redirects to `/onboarding`). Owner attempts to leave → `<LeaveHousehold>` blocked with `owner cannot leave (transfer ownership first — v1 feature)`. Last-member-leaves blocked with `cannot orphan household`.

**Patterns**: follow `apps/web/e2e/auth-edge-cases.spec.ts` for admin-client + signup-per-test boilerplate; `apps/web/e2e/force-create-race.spec.ts` for two-context provisioning + DB-level assertions; `apps/web/e2e/realtime.spec.ts` for cross-session WebSocket coverage.

### Visual / design coverage (post-merge)

15. **Empty MembersSection visual + InviteLinkSheet animation + iOS Safari mobile-share** — deferred to post-implementation `/design-review` against preview deploy. Not in pre-merge gate; included in operator post-merge checklist.

## Dependencies

**Zero new external deps.** Verified against `apps/web/package.json` (Next.js 16, React 19, `@supabase/ssr`, `@supabase/supabase-js`, `@sentry/nextjs`, `posthog-js` — all already present), `packages/core/package.json` (already imports `@supabase/supabase-js`), `packages/ui/package.json` (existing primitives). No new npm packages.

**Server-side primitives** all use Postgres core: `gen_random_bytes(24)` and `encode(_, 'base64')` are core PG (`pgcrypto` or built-in depending on version — Supabase ships with both). `crypto.randomUUID()` is not used (the SQL uses `gen_random_uuid()` core PG default).

**Workspace packages touched (no new packages):**

- `packages/core` — modified (auth.ts, items.ts, households.ts) + new files (invitations.ts, members.ts, audit.ts).
- `packages/ui` — modified (index.ts export) + new file (RoleBadge.tsx).
- `apps/web` — modified (middleware, settings, sign-up, onboarding, callback, list/ListClient, AwaitingConfirmationCard) + new files (Settings sections + InviteLinkSheet + /join/[token] route).
- `supabase/migrations` — new file (015 + paired test files).

## Task order

Strict dependency-ordered list, one task per atomic commit. `/ak-implement` walks this list top-down. Each task: subject (imperative), files touched, tests added, acceptance criterion.

1. **Add migration 015 SQL + paired pure-file FOR UPDATE test (in the SAME commit).**
   - Files: `supabase/migrations/015_household_collaborators.sql`, `supabase/migrations/015_household_collaborators.test.ts`.
   - Tests added: T8 (pure-file).
   - Acceptance: `pnpm db:reset` applies cleanly; `pnpm turbo run test:unit -- 015_household_collaborators` green; manual sanity `select create_invite()` after impersonating an owner returns a 32-char base64url token.
   - **Why same commit**: D9 sentinel must be enforced from day 1, not added as a follow-up.

2. **Regenerate `supabase.types.ts` + write integration test scaffold (D19 enable_confirmations flip).**
   - Files: `packages/core/src/supabase.types.ts` (regen), `supabase/migrations/015_household_collaborators.integration.test.ts` (skeleton with `beforeAll`/`afterAll` flipping `enable_confirmations`).
   - Tests added: scaffold only (cases land in tasks 3 + 11).
   - Acceptance: type drift test green; integration scaffold runs (no cases yet) under `VITEST_INTEGRATION=1`.

3. **Add integration suite cases T1, T2a, T2b (CRITICAL race + boundaries) + cases 4, 5, 7.**
   - Files: `supabase/migrations/015_household_collaborators.integration.test.ts`.
   - Tests added: T1, T2a, T2b, 23505-mapping case 4, name-length boundaries case 5, revoke-vs-accept case 7.
   - Acceptance: all 6 cases pass against local Supabase. T6 (audit hydration) deferred to task 8 once `audit.ts` exists.

4. **Create `packages/core/src/api/invitations.ts` + `members.ts` + extend `households.ts` + `audit.ts`** with friendly-error mapping (T12).
   - Files: as listed; `packages/core/src/index.ts` export updates.
   - Tests added: unit tests for each wrapper + InviteError mapping cases.
   - Acceptance: `pnpm turbo run test:unit -- packages/core` green; types compile.

5. **Extend `signUpWithPassword` to 5th positional `inviteToken` arg (D4/D5).**
   - Files: `packages/core/src/api/auth.ts`, `packages/core/src/api/auth.test.ts`.
   - Tests added: T10 (4 cases).
   - Acceptance: existing `signUpWithPassword` callers (sign-up form, integration tests, page.test.tsx mocks) compile + pass; new tests green.

6. **Change `fetchListEntries` to return `{entries, currentHouseholdId}` + add `RemovedFromHouseholdError` (D6/A4).**
   - Files: `packages/core/src/api/items.ts`, `packages/core/src/api/items.test.ts`.
   - Tests added: T9 (2 cases).
   - Acceptance: existing wrapper callers updated to destructure `entries`; type compile + unit green.

7. **Build `<RoleBadge>` in `packages/ui/src/RoleBadge.tsx` + unit tests (D20).**
   - Files: `packages/ui/src/RoleBadge.tsx`, `packages/ui/src/RoleBadge.test.tsx`, `packages/ui/src/index.ts`.
   - Tests added: variants OWNER + MEMBER + a11y `role="status"` + `aria-label`.
   - Acceptance: `pnpm turbo run test:unit -- packages/ui` green.

8. **Build `<MemberRow>` + `<MembersSection>` + `<HouseholdSection>` + `<HouseholdAuditSection>`** (page-level composed components consuming wrappers from task 4 + primitive from task 7).
   - Files: under `apps/web/components/`.
   - Tests added: case 6 (audit display-name hydration) lands in `015_..integration.test.ts` now that `audit.ts` exists.
   - Acceptance: components render with mocked data in Storybook-equivalent unit tests; type compile.

9. **Build `<InviteLinkSheet>` + `<RemovedFromHouseholdNotice>`.**
   - Files: `apps/web/components/InviteLinkSheet.tsx`, `apps/web/components/RemovedFromHouseholdNotice.tsx`.
   - Tests added: focus trap + Web Share API feature-detect cases (snapshot of rendered DOM with `navigator.share` undefined vs. defined).
   - Acceptance: components render; double-tap guard (D16) verified in unit test (rapid-fire click → only one `createInvite` call within 1s cooldown).

10. **Wire `/settings` page** with three new sections (`<HouseholdSection>`, `<MembersSection>`, `<HouseholdAuditSection>`) + Settings-launched `<InviteLinkSheet>` integration.
    - Files: `apps/web/app/settings/page.tsx`.
    - Tests added: none (E2E covers in task 17).
    - Acceptance: manual smoke `pnpm dev` confirms IA order + sections render with seed data.

11. **Wire `/list` header household-name caption + adopt new `fetchListEntries` shape in `<ListClient>` (response-shape thread, D6/A4).**
    - Files: `apps/web/app/list/page.tsx`, `apps/web/app/list/ListClient.tsx`.
    - Tests added: none directly (T13 E2E in task 17).
    - Acceptance: tap-target nav to `/settings#household` works; on synthetic `currentHouseholdId === null` the realtime channel tears down and the route navigates to `/onboarding?removed=1`.

12. **Wire `/sign-up?invite=` integration** (5-arg signUp + sign-up context line + AwaitingConfirmationCard caption variant).
    - Files: `apps/web/app/(auth)/sign-up/page.tsx`, `apps/web/components/AwaitingConfirmationCard.tsx`.
    - Tests added: page-test for the context line rendering when `?invite=<token>` present + ARIA `aria-live="polite"`.
    - Acceptance: type compile; manual smoke confirms the caption appears only with invite param.

13. **Extend `/auth/callback/route.ts`** to redirect to `/join/<invite>` when `?invite=` present.
    - Files: `apps/web/app/auth/callback/route.ts`.
    - Tests added: unit/integration test with mocked supabase exchange asserting the redirect target.
    - Acceptance: existing recovery + signup branches unchanged; new invite branch covered.

14. **Extend `apps/web/middleware.ts`** with `/join/` prefix allow-list + create middleware test if absent.
    - Files: `apps/web/middleware.ts`, `apps/web/middleware.test.ts`.
    - Tests added: T11 (4 cases).
    - Acceptance: unauth `/join/<token>` passes through; `/joined` typo redirects to `/sign-in`.

15. **Build `/join/[token]` route — `page.tsx` + `loading.tsx` + `_states.tsx`** implementing the 7-step server-component flow.
    - Files: `apps/web/app/join/[token]/page.tsx`, `apps/web/app/join/[token]/loading.tsx`, `apps/web/app/join/[token]/_states.tsx`.
    - Tests added: render-snapshot tests for each state component.
    - Acceptance: manual smoke walks all 4 paths (unavailable / already-in-household / own-link / accept-success).

16. **Wire `/onboarding?removed=1` branch + 23505 catch in `OnboardingForm`** (D7/C2/D15/OV1).
    - Files: `apps/web/app/(auth)/onboarding/page.tsx`, `apps/web/app/(auth)/onboarding/OnboardingForm.tsx`.
    - Tests added: page-test asserting `<RemovedFromHouseholdNotice>` renders when `?removed=1`; OnboardingForm.test.tsx case for the 23505 → `/list` redirect.
    - Acceptance: existing first-time onboarding flow unchanged.

17. **Add 5 E2E specs.**
    - Files: `apps/web/e2e/household-invite-happy-path.spec.ts`, `…edge-cases.spec.ts`, `…self-cases.spec.ts`, `household-rename.spec.ts`, `household-leave.spec.ts`.
    - Tests added: happy-path + edge-cases (with T13 CRITICAL extension) + self-cases + rename (with T14 extension) + leave.
    - Acceptance: all 5 specs green on slow-job CI in both Chromium viewports (375 + 1280).

18. **Append CLAUDE.md gotchas** (8 new entries).
    - Files: `CLAUDE.md`.
    - Tests added: none.
    - Acceptance: gotchas section follows the established imperative-present + Why + How-to-apply shape; no new project conventions invented.

19. **Pre-merge operator-blocker checklist landed in PR description** (D17/D18 — these are PR description items, not code, but must exist before merge).
    - Files: PR body itself (no repo file).
    - Tests added: none.
    - Acceptance: checklist contains both HARD BLOCKERs from D17 (deploy-race monitor) and D18 (allow-list query-survives empirical).

## Gotchas

Each entry below is a new CLAUDE.md gotcha that lands as part of this PR. Phrased as the existing CLAUDE.md gotchas — imperative present, "Why" + "How to apply" where load-bearing.

- **`emailRedirectTo` origin resolution prefers `NEXT_PUBLIC_SITE_URL`, falls back to `window.location.origin`** (D5). `signUpWithPassword` (invite-flow) and `createInvite` (owner URL builder) both resolve via `process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin`. **Operator action is optional**: setting `NEXT_PUBLIC_SITE_URL=https://lalista.store` on Vercel **Production** pins the canonical URL even if the call ever runs from an unusual origin (CDN proxy, iframe). Leave it unset on **Preview** so previews self-route via `window.location.origin` (preview-to-preview testing works; preview links are short-lived by definition). The fallback already produces the correct URL on the prod `lalista.store` host without the env var, so this is a hygiene pin rather than a load-bearing setting.

- **`fetchListEntries` returns `{entries, currentHouseholdId}`, not a bare array** (D6/A4). The wrapper selects `current_household_id()` (migration-001 helper) alongside `list_entries` rows. Why: when an owner removes a member, RLS on `list_entries` enforces "must be a household member" instantly on REST; but the removed user's Supabase Realtime channel keeps emitting until the JWT refreshes. Threading `currentHouseholdId` back to the caller lets `<ListClient>` self-heal: on every realtime event it debounce-refetches (1s); when the response shows `currentHouseholdId === null` the wrapper throws `RemovedFromHouseholdError`, the channel tears down via the existing `unsubscribe`, and the user is redirected to `/onboarding?removed=1`. Bounds the leak to ~1 round-trip. **How to apply**: every `fetchListEntries` caller must destructure `entries` from the result and catch `RemovedFromHouseholdError`. Do NOT "simplify" the wrapper back to a bare array — that would resurrect the leak.

- **Single-household v0 invariant lives in BOTH the application layer AND the DB layer; map 23505 in `OnboardingForm`** (D7/C2). `accept_invite` checks "already in a household" at the application layer (`P0001`), but the two-tab race surfaces at the Postgres `unique (user_id) constraint household_members_one_per_user_v0` constraint (`23505`). The DB constraint is loud-over-silent — it's the structural backstop. **How to apply**: every API wrapper that calls a household-mutation RPC catches both `P0001 'already in a household'` AND `23505` with constraint-name match `household_members_one_per_user_v0`, mapping both to `InviteError 'already_in_household'`. `OnboardingForm`'s submit handler additionally bounces on the 23505: `if (err.code === '23505' && err.message.includes('household_members_one_per_user_v0')) { router.push('/list'); return; }` — the user auto-recovers to the household they just joined. **Do NOT use `23505` for application-layer "already in household" checks** — that errcode is reserved exclusively for the literal Postgres unique-violation from this constraint (D8).

- **`accept_invite`'s `for update` row lock is load-bearing — sentinel comment is enforced by a unit test** (D9). The single-use guarantee for invite tokens relies on Postgres EvaluatePlanQual (EPQ) semantics under READ COMMITTED: when T2 blocks on T1's row lock and T1 commits (setting `used_at = now()`), T2's EPQ re-applies the WHERE clause (including `used_at IS NULL`) to the now-updated row, the predicate fails, T2 returns zero rows, and the `not found` branch fires. Removing the `for update` would silently break this — both T1 and T2 would see `used_at IS NULL` at SELECT time, both would commit, and the token would grant access twice. **How to apply**: keep both the `for update` line AND the sentinel comment `-- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee` near it. The pure-file test `015_household_collaborators.test.ts` greps for both at PR review time; the integration test `T1` validates the runtime semantic via a concurrent-accept race.

- **Audit-feed display-name hydration is a two-query read, not a PostgREST join** (D13/C1). Mirrors the existing `addedByName` gotcha. `household_audit_events.actor_user_id` and `target_user_id` both FK to `auth.users` (different schema); PostgREST relationship inference does NOT chain through `auth.*`. **How to apply**: `audit.ts` first selects audit rows, unions `actor_user_id` + `target_user_id` into a unique-ids set, then issues a second `profiles.select('user_id, display_name').in('user_id', uniqueIds)` call, then maps. When a user is deleted (`auth.users` deletion) or the profiles row is unreadable, both `actorName` and `targetName` are null and the UI renders `'someone'` (mirrors `addedByName`'s `'someone'` fallback in `ListRow.tsx`).

- **Migration-vs-Vercel deploy race window is documented, not split** (D17/OV3). Single PR ships both the migration and the Vercel-deployed code. After merge, there's a ~2-5 minute window where Vercel may have shipped the new front-end (which calls `create_invite()`/`accept_invite(token)`) while `deploy-migrations.yml` hasn't finished applying migration 015 yet — invite-tap during this window may show `<InviteUnavailable>` because the RPCs aren't yet deployed. **How to apply**: PR test plan includes a HARD BLOCKER post-merge checklist item — "Monitor `deploy-migrations.yml` AND Vercel deploy. Do NOT announce or share new invite links until both show success." Splitting the PR into migration-first-then-Vercel was considered and rejected as over-engineering for a 5-minute window in normal operations; revisit if a real outage happens.

- **`emailRedirectTo` query string survives Supabase's redirect-URL allow-list — verify empirically pre-merge** (D18/OV4). Supabase's Auth → URL Configuration matches by path, not query. The existing entry for `https://lalista.store/auth/callback` covers `?invite=<token>` automatically; this is load-bearing for the entire token-transport mechanism (D3). **How to apply**: PR test plan includes a HARD BLOCKER pre-merge manual test — `signUp` with `emailRedirectTo: <site>/auth/callback?test=42` against the prod Supabase project, fetch the resulting confirmation email, confirm the link in the email body still contains `?test=42`. If not, dashboard work required (add a wildcarded entry to Auth → URL Configuration).

- **Local-Supabase integration tests for the email-confirm gap require flipping `enable_confirmations = true` per-test** (D19/OV2). Local dev typically runs with `enable_confirmations = false` (sign-ups auto-confirm) so the `emailRedirectTo` path never exercises end-to-end. **How to apply**: `015_household_collaborators.integration.test.ts` `beforeAll` flips `auth.email.enable_confirmations = true` (via `auth.admin.updateConfig` if available; otherwise edit `supabase/config.toml` + restart auth-config via the cmd-relay); `afterAll` restores. The mailpit-based URL-extraction case asserts the link in the confirmation email body contains `?invite=<token>` — closes the load-bearing-piece coverage gap that `enable_confirmations = false` would otherwise leave.

## Acceptance / rollout / rollback

### Success criteria (from design § Success Criteria)

- A second user can join an existing household via a link in <30 seconds end-to-end (tap link → sign up if needed → land on shared list with the existing items).
- Both users see the same list update in real time (existing `subscribeToList` plumbing handles this — no new realtime work).
- Owner can revoke a pending invite and the link stops working immediately.
- Owner can remove a member; on the removed member's next REST request (RLS-bound, immediate) the session detects access loss; on the next realtime event (within ~1 round-trip via D6's response-shape thread) the channel tears down and the UI redirects to `/onboarding?removed=1`. **Realtime leak window**: bounded to ~1 round-trip (1s debounce + RTT) under the new mitigation; v1 chapter for tighter (broadcast-based) bounds.
- Owner can rename household; new name appears on `/list` header for all members on next page load.
- Audit log contains a row for every state change (invite created/used/revoked; member removed/left; household renamed).
- All 5 E2E specs pass on CI slow-job in both Chromium viewports (375 + 1280).
- 5 critical tests (T1, T2a, T2b, T8, T13) green before merge.
- Sentry shows zero errors during a 7-day soak after merge.

### Rollout

Single PR. Auto-deploys via existing pipelines:

- `.github/workflows/deploy-migrations.yml` ships migration 015 to prod Supabase on push to `main` (path-filtered to `supabase/migrations/**`).
- Vercel auto-deploys the front-end on merge to `main`.

**One out-of-band operator dependency** that gates functional rollout (cannot be automated by CI):

1. **D18 — Verify the prod Supabase Auth → URL Configuration allow-list uses glob (`?**`or`/**`) so `?invite=<token>` survives the redirect-URL match.** A literal entry of `https://lalista.store/auth/callback` would NOT match a URL with a query string and would silently fall back to `site_url`, breaking the invite flow. Verified pre-merge against prod: the entry `https://lalista.store/auth/callback?**` is in place — the empirical glob-matching probe (run locally with the same gotrue version + same glob shape) confirmed the `?invite=<token>` redirect_to survives unchanged.

**Optional operator setup** (not blocking, hygiene pin):

- **D5 — Set `NEXT_PUBLIC_SITE_URL=https://lalista.store` on Vercel Production.** The fallback `window.location.origin` already produces the correct URL when users sign up on `lalista.store`; the env var is a defensive pin against unusual origins (CDN proxy / iframe). Leave unset on Preview so preview-to-preview testing works.

**Operator post-merge checklist** (from test-plan artifact):

- [x] Confirm prod Supabase project's Auth → URL Configuration uses glob — verified 2026-05-11: `https://lalista.store/auth/callback?**` entry in place.
- [ ] D17 deploy-race window — monitor both `deploy-migrations.yml` AND Vercel deploy after merge. Do NOT announce or share new invite links until both succeed.
- [ ] Run `/design-review` on preview deploy before merging to main (per design Pass 7).
- [ ] After 7-day soak, confirm Sentry shows zero errors related to invite/join/audit code paths.

### Rollback

Migration 015 is **additive — fully reversible**. New tables, new RPCs, one new constraint, one alter on `household_members`. No destructive changes to existing tables.

```sql
-- Rollback (run in this order):
drop function if exists rename_household(text);
drop function if exists leave_household();
drop function if exists remove_member(uuid);
drop function if exists accept_invite(text);
drop function if exists revoke_invite(uuid);
drop function if exists create_invite();
drop function if exists is_household_owner(uuid);
alter table household_members drop constraint if exists household_members_one_per_user_v0;
drop table if exists household_audit_events;
drop table if exists household_invitations;
notify pgrst, 'reload schema';
```

**Code-side rollback** is `git revert` on the merge commit. The CLAUDE.md gotcha additions, schema migration, API wrapper changes, page additions, and middleware extension all revert cleanly because they're in the same PR. Out-of-band operator state (Vercel `NEXT_PUBLIC_SITE_URL`, Supabase URL configuration) can stay set after rollback — they don't break the prior behavior.

**Risk profile**: medium. The race semantics in `accept_invite` (D9) and the realtime leak mitigation (D6) are the two highest-risk surfaces; both are covered by CRITICAL tests (T1 + T13). The single-household DB constraint (D7) is the third — its addition is no-op on existing data because the v0 invariant already held at the application layer; the constraint just enforces it loudly going forward.
