# Devshop lift proposal — DB hardening conventions

Source: lalista PR 58 (`feature/db-hardening`, migration `014_advisor_findings.sql`).
Status: draft for the operator to apply in a separate `/devshop` branch + PR.
Target repo: `/devshop` (the abra-kadabra devshop, not lalista).

## Why this exists

PR 58 surfaced 4 reusable patterns that future Supabase-backed devshop projects will hit identically:

1. **Original advisor audit (2026-05-04) missed 2 RLS policies** that both call bare `auth.uid()` per row (`household_members_select`, `list_entries_insert`). Caught only by a re-probe at PR-58 dogfood time. The advisor is the source of truth, not a snapshot of an old advisor run.
2. **Pre-ship `/cso` caught a privilege regression** where migration 005's `with check (auth.uid() is not null)` would have been reverted to `with check (true)` when 014 re-created the policy from migration 001's body. Tracing forward through migration history is load-bearing for any drop+recreate-policy migration.
3. **Stale local-DB state misled the advisor** — a `with check = "true"` "always true" finding the operator pasted was actually the pre-CSO-fix state of the DB (db:reset hadn't run since the fix). `pnpm db:reset` must be run before trusting Studio's advisor output any time the migration file changes.
4. **Studio + Mailpit + dev-server URL discoverability** is bad — first-run devs don't know where to look.

Lifting the conventions + tooling once spares every future Supabase project these gotchas.

## Diff 1 — `/devshop/template/CLAUDE.md` § Migration Workflow

Append three day-1 conventions under the existing § Migration Workflow section.

````markdown
### Day-1 SQL conventions (Supabase-backed projects)

These conventions exist so the local Supabase Advisor (Studio → Database → Advisor)
stays at zero findings as your schema grows. Each codifies a finding that will
otherwise accumulate quietly.

1. **Every `SECURITY DEFINER` function ships with `set search_path = public, pg_temp`
   in its `CREATE`.** SECURITY DEFINER runs as the function owner; without an explicit
   `search_path`, an attacker who can create a same-named function in a schema they
   control (`pg_temp`, etc.) hijacks the lookup. Always:
   ```sql
   create or replace function public.my_helper()
   returns ...
   language sql
   security definer
   set search_path = public, pg_temp  -- ← required
   stable
   as $$ ... $$;
   ```
````

The advisor finding name is `function_search_path_mutable`.

2. **Every RLS policy uses `(select auth.uid())`, never bare `auth.uid()`.**
   Bare `auth.uid()` is re-evaluated per row; the wrapped form caches per
   statement. At small scale invisible; at thousands of rows it dominates
   query cost. Always:

   ```sql
   create policy my_table_select on public.my_table
     for select using (user_id = (select auth.uid()));
   ```

   The advisor finding name is `auth_rls_initplan`.

3. **Every FK constraint has a backing index OR an inline comment justifying its
   absence.** Joins and cascading deletes scan instead of seek without one. The
   ergonomic shape:
   ```sql
   create table list_entries (
     ...
     added_by uuid references auth.users(id) on delete set null,
     ...
   );
   create index idx_list_entries_added_by on list_entries (added_by);
   ```
   The advisor finding name is `unindexed_foreign_keys`.

When a finding sneaks in despite these, the per-quarter advisor-sweep PR (lalista
PR 58 is the canonical example) bundles them into a single migration.

````

## Diff 2 — `/devshop/template/scripts/advisor-probe.mjs` (new file)

Reusable Node + `pg` script that replicates 9 advisor queries against `pg_catalog`. Same shape as `/tmp/pgprobe/probe.js` from PR 58 but committed to the template + executable from a `pnpm db:advisor` script.

```javascript
#!/usr/bin/env node
// Local Supabase Advisor probe — runs the most useful pg_catalog queries
// the hosted Advisor would surface in Studio, plus a few the hosted one
// doesn't (e.g., extension-owned functions are filtered out automatically
// by hosted but not by your local advisor — so this probe matches local
// Studio's output rather than hosted's).
//
// Usage: node scripts/advisor-probe.mjs
// Prereq: `pnpm db:start` running.

import pg from "pg";
const { Client } = pg;

const URL =
  process.env.LOCAL_DB_URL ??
  "postgresql://postgres:postgres@host.docker.internal:54322/postgres";

const QUERIES = {
  "function_search_path_mutable":
    `select n.nspname, p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c
                            where c like 'search_path=%'))
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')`,
  "auth_rls_initplan":
    `select schemaname, tablename, policyname, cmd from pg_policies
     where schemaname = 'public'
       and ((qual is not null and qual ~* 'auth\\.uid\\(\\)' and qual !~* '\\(\\s*select\\s+auth\\.uid')
            or (with_check is not null and with_check ~* 'auth\\.uid\\(\\)' and with_check !~* '\\(\\s*select\\s+auth\\.uid'))`,
  "unindexed_foreign_keys":
    `with fks as (
       select c.conrelid::regclass::text as table_name, c.conname,
              c.conkey as fk_cols, c.conrelid as oid
       from pg_constraint c where c.contype = 'f'
         and c.connamespace = 'public'::regnamespace
     )
     select fks.table_name, fks.conname from fks
     where not exists (
       select 1 from pg_index i
       where i.indrelid = fks.oid
         and (i.indkey::int[])[0:array_length(fks.fk_cols, 1)-1]
             = fks.fk_cols::int[]
     )`,
  "multiple_permissive_policies":
    `select tablename, cmd, count(*) from pg_policies
     where schemaname = 'public' and permissive = 'PERMISSIVE'
     group by tablename, cmd, roles having count(*) > 1`,
  "rls_disabled_in_public":
    `select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
  "rls_enabled_no_policy":
    `select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`,
  "extension_in_public":
    `select e.extname from pg_extension e
     join pg_namespace n on n.oid = e.extnamespace
     where n.nspname = 'public'`,
  "policy_with_check_always_true":
    `select tablename, policyname, cmd from pg_policies
     where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE')
       and trim(coalesce(with_check, '')) = 'true'`,
  "duplicate_index":
    `select t.relname, array_agg(i.relname) from pg_index ix
     join pg_class i on i.oid = ix.indexrelid
     join pg_class t on t.oid = ix.indrelid
     join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
     group by t.relname, ix.indkey, ix.indclass
     having count(*) > 1`,
};

const c = new Client({ connectionString: URL });
let exitCode = 0;
await c.connect();
for (const [lint, sql] of Object.entries(QUERIES)) {
  const { rows } = await c.query(sql);
  if (rows.length === 0) {
    console.log(`PASS ${lint}`);
  } else {
    exitCode = 1;
    console.log(`FAIL ${lint} (${rows.length} finding${rows.length > 1 ? "s" : ""})`);
    for (const r of rows) console.log(`  ${JSON.stringify(r)}`);
  }
}
await c.end();
process.exit(exitCode);
````

Add to `template/package.json`:

```json
"scripts": {
  "db:advisor": "node scripts/advisor-probe.mjs"
}
```

Operator usage:

```bash
pnpm db:reset      # apply all migrations
pnpm db:advisor    # exits 0 if clean, 1 if any finding (with details)
```

## Diff 3 — `/devshop/template/README.md` § Local URLs

Already proposed verbatim — applied to lalista's README in PR 58 commit (5862ca1 or similar). Lift the same block to `template/README.md` for new projects.

```markdown
### Local URLs (devcontainer)

After `pnpm db:start` + `pnpm dev`, these are reachable from your macOS browser:

- Dev server: http://localhost:3000
- Supabase API gateway: http://127.0.0.1:54321
- Supabase Studio: http://127.0.0.1:54323/project/default
- Mailpit (local email inbox): http://127.0.0.1:54324

> Before shipping a DB migration, open Studio's **Advisor** (Database → Advisor).
> It surfaces RLS / `search_path` / missing-FK-index findings against your local
> stack — run `pnpm db:reset` first so Studio sees the latest migration's effect
> (Studio caches advisor state across runs). The hosted Advisor against prod
> runs separately after deploy.
```

## Diff 4 — `/devshop/.claude/skills/ak-pre-ship/SKILL.md` — new gate

Add an `advisor-clean` gate that runs `pnpm db:advisor` post-`db:reset`. Fail-fast finding-pending if the script exits non-zero. Same shape as the existing `rls-coverage` gate — see `/workspace/specs/db-hardening/review.md § Gate "rls-coverage"` for the pattern. The gate is `n/a` for projects that don't have `supabase/migrations/` in their root.

Skeleton (operator drafts the full gate prose to match `/ak-pre-ship`'s house style):

```markdown
### Gate: advisor-clean (Supabase-backed projects only)

**When it applies.** Repo has a `supabase/migrations/` directory at root.

**What it checks.** Runs `pnpm db:reset && pnpm db:advisor`. The probe script
queries pg_catalog for the 9 most common Supabase Advisor lints (search_path,
auth_rls_initplan, unindexed FKs, etc.). If any new finding is present
relative to a baseline tracked at `specs/<feature>/advisor-baseline.json`,
the gate emits findings_pending = N.

**How to fix.** The findings table prints `lint_name` + offending object. Apply
either (a) a migration extending the active feature, or (b) a focused
follow-up migration in the same PR. The operator may also bypass via a
specific `git config devshop.advisorBypassReason "<reason>"` (e.g., "extension
in public is intentional per project D4") — adversarially reviewed.

**Why it exists.** lalista PR 58 shipped 19 advisor findings cleared by
migration 014; the original 2026-05-04 audit missed 2 of them, caught only by
a re-probe at PR dogfood. Without this gate, a future Supabase project ships
the same incomplete sweep.
```

## Diff 5 — `/devshop/kit/ROADMAP.md` § v0 — new entry

Append at the bottom of the v0 section (or wherever new entries go):

```markdown
### DB hardening conventions for Supabase projects

**Problem.** lalista PR 58 shipped migration `014_advisor_findings.sql`
resolving 19 advisor findings — but during the original audit, 2 RLS policies
were missed (caught only by a re-probe at PR-58 dogfood). The CSO review
separately caught a privilege regression where migration 005's tightening
would have been reverted by 014's drop+recreate. Future Supabase-backed
projects will hit identical gaps unless we factor up.

**What to lift:**

1. **Day-1 SQL conventions** in `template/CLAUDE.md § Migration Workflow §
Day-1 SQL conventions`: SECURITY DEFINER `search_path`, RLS `(select
auth.uid())`, FK indexes. (Diff 1 in `lalista/specs/db-hardening/devshop-lift-proposal.md`.)
2. **`scripts/advisor-probe.mjs`** in `template/` — Node + pg replicates 9
   advisor queries against `pg_catalog`. (Diff 2.)
3. **New `/ak-pre-ship` gate** — `advisor-clean` — runs the probe
   post-`db:reset`, fails on any finding. (Diff 4.)
4. **Local URLs section** in `template/README.md` — Studio + Mailpit + API
   - dev server URLs with a "run Advisor before shipping a DB change" note.
     (Diff 3.)
5. **Convention**: every Supabase-backed project commits to a per-quarter
   advisor-sweep PR like lalista's PR 58 to keep findings near zero as
   schema evolves. Captured under `template/CLAUDE.md § Cadence`.

**Source:** Drafted alongside lalista PR 58 (2026-05-08). Full proposal
text + reusable script at `<lalista>/specs/db-hardening/devshop-lift-proposal.md`.
```

## Apply order (operator)

1. Open a `feature/db-hardening-lift` branch in `/devshop`.
2. Apply Diffs 1-5 (or pick the subset you want first).
3. Update `/devshop/lalista-launch.md` (or equivalent linkback file) so PR 58 references the lift entry.
4. Open the devshop PR; the lift PR doesn't block lalista PR 58 — they ship independently.
5. After devshop merges + lalista's next migration touches the schema, the new `advisor-clean` gate kicks in for the first project.
