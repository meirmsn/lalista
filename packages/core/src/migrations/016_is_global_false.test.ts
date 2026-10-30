// What: Pure-file unit test for migration 016's load-bearing `is_global = false`
//       in the custom-create branch of add_household_store.
// Why: Spec § Tests / D2 + D9. Custom stores MUST be inserted with
//      is_global=false, otherwise (a) the cross-join backfill for FUTURE
//      households picks them up (catalog widening), (b) RLS visibility expands
//      to ALL authed users (Model B violation), (c) future popular-stores
//      ranking gets skewed. The sentinel comment catches editorial drift at
//      PR-review time before the integration test runs. Mirrors 015's FOR
//      UPDATE sentinel test pattern (015_for_update.test.ts).
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
  '../../../../supabase/migrations/016_household_stores.sql'
);

describe('migration 016 — add_household_store custom-create is_global = false', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('contains the literal custom-create insert with is_global=false as the 3rd arg', () => {
    // The exact line is the load-bearing instruction; see the sentinel comment
    // above it in the migration body for the rationale.
    expect(sql).toContain('values (p_name, v_household_id, false)');
  });

  it('contains the sentinel comment explaining is_global = false is load-bearing', () => {
    expect(sql).toContain('LOAD-BEARING(do-not-remove): is_global = false');
  });

  it('places the sentinel + insert inside add_household_store (not elsewhere)', () => {
    const start = sql.indexOf('create or replace function add_household_store');
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf('$$;', start);
    expect(end).toBeGreaterThan(start);

    const body = sql.slice(start, end);
    expect(body).toContain('values (p_name, v_household_id, false)');
    expect(body).toContain('LOAD-BEARING(do-not-remove): is_global = false');
  });

  it('contains the LOAD-BEARING sentinel for the dropped stores_name_key UNIQUE (D3)', () => {
    // D3: dropping the UNIQUE is intentional under Model B; the sentinel
    // documents why re-adding it would break House B's add when House A had
    // already created the same name privately.
    expect(sql).toContain('LOAD-BEARING(do-not-remove)');
    expect(sql).toContain('drop constraint if exists stores_name_key');
  });
});
