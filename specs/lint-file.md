# Lint each file as Claude edits it, and leave the other optional contract items out

**Go:** pending

## Intent

Session start lists five optional contract items lalista doesn't have: `scripts/lint-file.sh`,
`scripts/ui/tokens-check.mjs`, `scripts/ui/design-md-check.mjs`, `scripts/count-check.py` and
`docs/README.md`. The owner asked, 2026-11-11, in chat: "should we add those? why? the do advesrarial
review of your proposal, and buiild whats left". This change adds the one that pays today,
`scripts/lint-file.sh`: the devshop's per-edit hook runs it on every file Claude edits and hands
findings back in the same turn, so ESLint and Prettier problems surface at the edit instead of at
`scripts/check-fast.sh` before a push or in CI's `fast` job. The other four are left out, each for
the reason in Decisions.

## Decisions

- `scripts/lint-file.sh <path>` lints what `scripts/lint.sh` lints, one file at a time, so the edit
  and CI agree: ESLint on a JS/TS file under `apps/web/`, run inside `apps/web/` with its config as
  `lint.sh` runs it through turbo, and Prettier `--check --ignore-unknown` on any file, so
  `.prettierignore` (which lists the devshop copies) and unknown types pass. ESLint warnings and
  ESLint-ignored files don't fail it, as in `lint.sh`. A file Prettier can't parse (a syntax error
  mid-edit) is a finding, exit 1; an ESLint crash or a Prettier error of any other kind is "couldn't
  run", exit 2. Rejected: the TypeScript typecheck, which is whole-project; `lint.sh` and CI keep it.
  Cost: ESLint takes about 2 to 5 seconds a TS file under `apps/web/`, Prettier about 1 second
  (Claude, 2026-11-11).
- The root `eslint.config.mjs` (typescript-eslint and jsdoc) isn't run by anything today, since
  `packages/core` and `packages/ui` have no `lint` script; `lint-file.sh` doesn't start running it
  either, which would make the edit stricter than CI. Recorded in `FINDINGS.md` for the owner.
  Rejected: linting `packages/*` here (Claude, 2026-11-11).
- `scripts/ui/tokens-check.mjs` and `scripts/ui/design-md-check.mjs` are not added. tokens-check
  reads a theme whose dark tokens sit under `:root[data-theme="dark"]`; lalista's
  `apps/web/app/globals.css` uses `.dark`, so it would exit 2. design-md-check needs `DESIGN.md`'s
  front matter, which lalista doesn't have. Both arrive with `ROADMAP.md` R-7, which already names
  this step. Rejected: adding them here, which is R-7's work under another title (Claude,
  2026-11-11).
- `scripts/count-check.py` is not added: it runs only over the collections a project lists in
  `COLLECTIONS`, and lalista has none at risk; its likeliest candidate, `supabase/migrations/`, has
  no test that counts it. It comes back when a test first counts a collection parallel branches add
  to (the devshop's parallel-work guideline). Rejected: declaring a collection just to have the
  check run (Claude, 2026-11-11).
- `docs/README.md` is not added: `CLAUDE.md`'s Orientation block is lalista's doc map and every
  session loads it. It lacked `README.md`, `DESIGN.md`, `DEPS-WATCH.md` and `design/`, so this
  change adds them. Rejected: a second map in `docs/README.md`, which would drift from the first
  (Claude, 2026-11-11).
- `scripts/lint-file.test.sh` checks it, run by `scripts/check-fast.sh` beside the other script
  tests; its fixtures are created under `apps/web/` (a path neither `.gitignore` nor
  `.prettierignore` covers) and removed on exit.

## Acceptance items

- **AC-1** `scripts/lint-file.sh <path>` exits 0 on a JS/TS file under `apps/web/` that ESLint and
  Prettier both pass, on a file ESLint ignores, and on a file Prettier passes or ignores elsewhere
  in the repo.
- **AC-2** It exits 1, printing the finding, on a JS/TS file under `apps/web/` with an ESLint error.
- **AC-3** It exits 1, printing the file, on any file Prettier would reformat or can't parse.
- **AC-4** It exits 2 when given no path, a path that isn't a file, or when it can't run its tools
  (no `pnpm`, no `node_modules`).
- **AC-5** `scripts/lint-file.sh` is committed executable, `scripts/check-fast.sh` runs
  `scripts/lint-file.test.sh`, and `scripts/contract-check.py` no longer lists it as absent.
- **AC-6** `CLAUDE.md`'s Orientation names every top-level doc (`*.md` at the root) and `design/`.

## Out of scope

- The UI checks and `DESIGN.md`'s front matter (`ROADMAP.md` R-7).
- Linting `packages/*` (the `FINDINGS.md` entry).
- The per-edit hook itself, which the devshop owns.
