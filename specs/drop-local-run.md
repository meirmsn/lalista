# Remove scripts/local-run.sh so the devshop's review can run

**Go:** "Answer anything that has to be done in there and get it done on a new session or multiple new sessions. Just go and open them. Don't come to me." (owner, 2026-11-10, delegating the devshop v4 upgrade and the Dependabot PRs, both blocked by this)

## Intent

PR #15 added `scripts/local-run.sh`. Since it merged, the devshop's reviewer (`ship.sh` →
`review.sh`) finds a local run declared at the base commit and starts it from a fresh copy of each
PR's head, waiting 60 seconds for it to answer. In lalista that can't work: the copy has no
OpenNext build (a build takes minutes) and only the root `node_modules`, so `apps/web` can't find
`wrangler`. Every PR's review exits "could not run", which blocks the v4 upgrade and the Dependabot
work the owner asked for. Removing the script puts lalista back where it was before #15: the
reviewer reads the UI instead of browsing it.

## Decisions

- Remove the script rather than change the devshop: the reviewer is the devshop's, and its fix
  (building the project's run, or a longer wait, in a workspace-aware copy) belongs in a devshop
  session; reported to the owner in the session's devshop findings (Claude, 2026-11-10).
- Not a script that serves a build made outside the reviewer's copy: the reviewer would then judge
  a build it didn't make (Claude, 2026-11-10).
- The project contract keeps passing: `scripts/local-run.sh` is optional for lalista (the
  Cloudflare home that would require it isn't detected, as lalista's `wrangler.jsonc` is under
  `apps/web/`).
- This PR can't go through `ship.sh` (its review is the thing that can't run); it is opened
  without it, once, and says so. `docs/DEVELOPMENT.md` points at `pnpm --filter @lalista/web
preview:worker` for a local Worker run instead.

## Acceptance items

- **AC-1** `scripts/local-run.sh` is gone and nothing in the repo's current docs names it.
- **AC-2** `ship.sh` runs its review on the next PR without the local-run error — verified by
  review: the v4 upgrade PR's `ship.sh` run after this merges.

## Out of scope

- Fixing the devshop's reviewer for pnpm workspaces and slow builds.
- Running the browser review for lalista (`ROADMAP.md` R-7 covers the page checks).
