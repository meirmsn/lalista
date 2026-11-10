# Move lalista to devshop v4

**Go:** "Can you upgrade to DevShop 4.0?" … "Can you manage all of that? Answer anything that has to be done in there and get it done on a new session or multiple new sessions. Just go and open them. Don't come to me." (owner, 2026-11-10)

## Intent

The owner asked to upgrade lalista from devshop v3.0.0 to v4.0.0, in one PR, and for Claude to
decide what the upgrade asks without coming back to them. v4.0.0 has two changes. The breaking one
renames the devshop plugin to `ak`, so its skills are `ak:intent`, `ak:build`, `ak:pr` and so on.
The other stops leaks before a push: lockfiles that resolve from a non-public registry, Claude
session links in commits and PR bodies, and git commands that skip the hooks. No change to what
the app renders.

## Decisions

- Pin `v4.0.0`, the newest release in the devshop copy (Claude, under the owner's go, 2026-11-10).
- The major release's migration is the skill rename. Nothing in lalista outside the v1-era records
  (`BUILD-LOG.md`, `PLAN.md`, `PRODUCT-ROADMAP.md`, old `specs/` folders) names a `devshop:` skill,
  and those records stay as history. So the migration needs only the pin and the environment cache
  rebuild the owner already did (Claude, 2026-11-10).
- Both `devshop` files that changed (`scripts/secret-scan.sh`, `scripts/project-contract.txt`) are
  taken whole, as the upgrade requires (Claude, 2026-11-10).
- Seed `CLAUDE.md`: apply. Its Rules gain v4's line banning Claude session links in commits and PR
  bodies. It matches the owner's standing rule ("No Claude session links in commits, PRs or
  comments"). Rejected: skip, which would leave the project's rules overridden by the platform's
  attribution (Claude, 2026-11-10).
- Every other seed (`ci.yml`, `check-fast.sh`, `check-slow.sh`, `.gitleaks.toml`, `tests/README.md`,
  `specs/.gitkeep`) has an unchanged template, so nothing to apply.
- The new lockfile check reads `package-lock.json`, `npm-shrinkwrap.json` and `yarn.lock`, not
  pnpm's `pnpm-lock.yaml`. Today lalista's lockfile names no registry URL at all, so there is
  nothing to catch. Logged in `FINDINGS.md`, not worked around here (Claude, 2026-11-10).

## Acceptance items

- **AC-1** `.devshop-version` holds `v4.0.0`, and every `devshop` file of v4.0.0's
  `project-files.txt` that the project has is identical to v4.0.0's — verified by review:
  `project-files-at.sh check --version v4.0.0 --project .` exits 0.
- **AC-2** `CLAUDE.md`'s Rules ban Claude session links in commit messages and PR bodies, and it
  names no `devshop:` skill — verified by review: `grep -n 'session links' CLAUDE.md` finds the
  rule and `grep -n 'devshop:[a-z]' CLAUDE.md` finds nothing.
- **AC-3** `scripts/check-fast.sh origin/main` passes on this branch, the new lockfile check
  included — verified by review: run on this branch, and `fast` green in CI.

## Out of scope

- Rewriting `devshop:` or `/ak-*` names in the v1-era records.
- Making the devshop's lockfile check read `pnpm-lock.yaml` (a devshop change, not this repo's).
