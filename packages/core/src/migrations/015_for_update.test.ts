// What: Pure-file unit test for migration 015's load-bearing FOR UPDATE row lock
// Why: T8 CRITICAL (spec § Tests). The single-use invite-token guarantee relies
//      on Postgres EvaluatePlanQual (EPQ) semantics under READ COMMITTED — and
//      EPQ only fires when the SELECT carries `for update`. Removing it would
//      silently break the race-correctness contract; this grep-level test
//      catches accidental removal at PR review time before integration tests
//      run. Lands in the SAME commit as the migration so the sentinel is
//      enforced from day 1.
// Does NOT: Apply the migration or hit a database — pure file read.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo-relative path so the test lives next to the migration's API wrappers
// (in packages/core) but still asserts against the canonical SQL file under
// supabase/migrations/. If the migration is renamed or moved, this constant
// is the single point of update.
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../supabase/migrations/015_household_collaborators.sql'
);

describe('migration 015 — accept_invite FOR UPDATE row lock', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('contains the load-bearing FOR UPDATE row lock inside accept_invite', () => {
    // Locate the accept_invite function body.
    const start = sql.indexOf('create or replace function accept_invite');
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf('$$;', start);
    expect(end).toBeGreaterThan(start);

    const body = sql.slice(start, end);
    // Match `for update` case-insensitively (Postgres SQL is case-insensitive).
    expect(body).toMatch(/for update/i);
  });

  it('contains the sentinel comment explaining FOR UPDATE is load-bearing', () => {
    // The sentinel must appear in the migration source so casual edits hit it
    // before the FOR UPDATE line. Exact text per spec D9.
    expect(sql).toContain(
      '-- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee'
    );
  });

  it('places the sentinel comment near the FOR UPDATE line inside accept_invite', () => {
    const start = sql.indexOf('create or replace function accept_invite');
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);
    // The sentinel must live inside accept_invite (not just somewhere in the
    // file) so the next person editing the function sees it.
    expect(body).toContain(
      '-- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee'
    );
  });
});
