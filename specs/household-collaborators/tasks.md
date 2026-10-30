# Tasks: household-collaborators

Source: `specs/household-collaborators/spec.md` § Task order (19 tasks).

Each task = one atomic commit. Test-presence pairing per CLAUDE.md.

---

## Task 1: Migration 015 SQL + paired pure-file FOR UPDATE test

**Hat**: Backend/Data
**Depends on**: none
**Blocks**: all subsequent tasks
**Done when**: `pnpm db:reset` applies cleanly; T8 pure-file test passes
**Risk**: high
**Status**: done
**Commit**: 4a068db

## Task 2: Regen supabase.types.ts + integration test scaffold

**Hat**: Data
**Depends on**: 1
**Blocks**: 3+
**Done when**: types regenerated; integration scaffold runs (no cases) under `VITEST_INTEGRATION=1`
**Risk**: low
**Status**: done (folded into commit 8326318 with task 3)
**Commit**: 8326318

## Task 3: Integration suite cases T1, T2a, T2b + 4 + 5 + 7

**Hat**: Backend/Data
**Depends on**: 2
**Blocks**: 4
**Done when**: 6 integration cases pass against local Supabase
**Risk**: high
**Status**: done
**Commit**: 8326318

## Task 4: API wrappers — invitations.ts + members.ts + audit.ts + extend households.ts

**Hat**: Backend
**Depends on**: 2
**Blocks**: 5+
**Done when**: unit tests green; types compile
**Risk**: medium
**Status**: done
**Commit**: 8915ef9

## Task 5: signUpWithPassword 5th positional inviteToken + module-load Sentry warning

**Hat**: Backend
**Depends on**: 4
**Blocks**: 12
**Done when**: existing callers compile + pass; T10 cases green
**Risk**: medium
**Status**: done
**Commit**: 3a520a3

## Task 6: fetchListEntries returns {entries, currentHouseholdId} + RemovedFromHouseholdError

**Hat**: Backend
**Depends on**: 4
**Blocks**: 11
**Done when**: existing callers updated; T9 cases green
**Risk**: medium
**Status**: done
**Commit**: b630182

## Task 7: <RoleBadge> primitive in @lalista/ui

**Hat**: Frontend
**Depends on**: none (parallel with 4-6)
**Blocks**: 8
**Done when**: unit tests green
**Risk**: low
**Status**: done
**Commit**: 58067de

## Task 8: Page-level components — MemberRow, MembersSection, HouseholdSection, HouseholdAuditSection

**Hat**: Frontend
**Depends on**: 4, 7
**Blocks**: 10
**Done when**: components render with mocked data; type compile
**Risk**: medium
**Status**: done
**Commit**: c4c5602

## Task 9: InviteLinkSheet + RemovedFromHouseholdNotice

**Hat**: Frontend
**Depends on**: 4
**Blocks**: 10, 16
**Done when**: components render; double-tap guard test green
**Risk**: medium
**Status**: done
**Commit**: 3cb2ef8

## Task 10: Wire /settings page with three new sections + InviteLinkSheet integration

**Hat**: Frontend
**Depends on**: 8, 9
**Blocks**: 17
**Done when**: page renders all sections in IA order
**Risk**: low
**Status**: done
**Commit**: 4525d33

## Task 11: /list header household-name caption + adopt new fetchListEntries shape

**Hat**: Frontend
**Depends on**: 6
**Blocks**: 17
**Done when**: tap-target nav works; RemovedFromHouseholdError triggers /onboarding?removed=1
**Risk**: medium
**Status**: done
**Commit**: 8dbb5a6

## Task 12: /sign-up?invite= integration + AwaitingConfirmationCard caption variant

**Hat**: Frontend
**Depends on**: 5
**Blocks**: 17
**Done when**: type compile; caption appears only with invite param
**Risk**: low
**Status**: done
**Commit**: 05bfa48

## Task 13: Extend /auth/callback/route.ts to redirect to /join/<invite>

**Hat**: Backend
**Depends on**: none
**Blocks**: 17
**Done when**: existing branches unchanged; new invite branch covered
**Risk**: low
**Status**: done (folded into 07e1e7b with task 14)
**Commit**: 07e1e7b

## Task 14: Middleware /join/ prefix allow-list + tests (T11)

**Hat**: Backend
**Depends on**: none
**Blocks**: 15, 17
**Done when**: T11 4 cases green
**Risk**: low
**Status**: done
**Commit**: 07e1e7b

## Task 15: /join/[token] route — page.tsx + loading.tsx + \_states.tsx

**Hat**: Frontend
**Depends on**: 4, 14
**Blocks**: 17
**Done when**: all 4 paths render correctly
**Risk**: medium
**Status**: done
**Commit**: b45e908

## Task 16: /onboarding?removed=1 branch + 23505 catch in OnboardingForm

**Hat**: Frontend
**Depends on**: 9
**Blocks**: 17
**Done when**: existing first-time flow unchanged; new branch covered
**Risk**: low
**Status**: done
**Commit**: e480305

## Task 17: 5 E2E specs

**Hat**: Frontend
**Depends on**: 1-16
**Blocks**: 18
**Done when**: all 5 specs deferred to slow-job CI (E2E specs added; runtime green deferred to CI)
**Risk**: medium
**Status**: done
**Commit**: 47-prefix (see git log — household-invite specs commit + lint-fix follow-up)

## Task 18: Append CLAUDE.md gotchas (8 new entries)

**Hat**: PM
**Depends on**: 17
**Blocks**: none
**Done when**: gotchas section follows established shape
**Risk**: low
**Status**: done
**Commit**: 100f407

## Task 19: Pre-merge operator-blocker checklist (PR description; out of code scope)

**Hat**: PM
**Depends on**: 18
**Blocks**: none
**Done when**: skipped — Phase 4 PR creation will land it
**Risk**: low
**Status**: deferred-to-Phase-4
**Commit**: — (PR body itself — no repo file)

---

## Decisions

- **Task 1 — `gen_random_bytes` schema qualification.** Spec § Data model has
  `v_token := encode(gen_random_bytes(24), 'base64')`. With the spec's
  `set search_path = public, pg_temp` (D11.a), pgcrypto's `gen_random_bytes`
  isn't on the function-level path (Supabase installs pgcrypto into the
  `extensions` schema). Qualified the call as
  `extensions.gen_random_bytes(24)` to keep the search_path tight rather than
  widening it to include `extensions` (which would risk extension functions
  shadowing public ones). Same correctness outcome; documentation stays in
  the function body.

- **Task 1 — `revoke_invite` audit-row insert order.** Spec SQL has
  `delete from household_invitations where id = p_invite_id;` BEFORE
  `insert into household_audit_events (..., invite_id) values (...)`. That
  order FK-violates (errcode 23503) at insert time because the referenced
  invitation row is already gone — `on delete set null` fires only on rows
  that already point at the deleted target, not on inserts of new rows
  pointing at a deleted target. Swapped the order: insert audit first, then
  delete. The audit row's `invite_id` ends up null after the delete cascades
  set-null, preserving the "we revoked invite X" record via event_type.
  Caught by integration case 7 (revoke vs accept race) which exercises the
  success path of revoke.

- **Task 2 — Integration test placement.** Spec listed the integration test
  at `supabase/migrations/015_household_collaborators.integration.test.ts`.
  Moved to `packages/core/src/migrations/015_household_collaborators.integration.test.ts`
  because (a) `supabase/` has no package.json + vitest config, and
  (b) vitest's include globs are rooted at the config dir — `../..` glob
  patterns silently no-op. Same for the pure-file unit test (now at
  `packages/core/src/migrations/015_for_update.test.ts`). The tests still
  reference the canonical SQL file at `supabase/migrations/015_*.sql` by
  repo-relative path, so they remain paired with the migration they cover.

- **Task 2 — Email-confirm-gap mailpit case (D19/OV2) deferred.** The
  cmd-relay does not yet support flipping `auth.email.enable_confirmations`
  on the local stack. The remaining 6 cases (T1, T2a, T2b, 4, 5, 7) don't
  need confirmations on. Slow-job CI runs with confirmations on per its
  own config; case 8 is documented as a TODO marker inside the test file.
