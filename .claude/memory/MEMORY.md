# Project Memory — lalista / workspace

## gstack Setup — virtiofs Build Workaround

The workspace is on a virtiofs mount (`/run/host_virtiofs/...`). Bun's `--compile` fails with `ENOENT` when trying to rename temp build files because it can't cross device boundaries.

The workspace ships gstack as `dist/` binaries only — there is no `src/` under `/workspace/.claude/skills/gstack/...`, so rebuilds must source from `/devshop/.claude/skills/gstack/...`.

**Fix (two commands, both idempotent):**

```bash
/devshop/kit/scripts/rebuild-browse.sh /workspace
/devshop/kit/scripts/populate-playwright-cache.sh /workspace
```

`rebuild-browse.sh` builds in `/tmp`, copies binaries + the Node server bundle (`server-node.mjs` + `bun-polyfill.cjs`) into `/workspace/.claude/skills/gstack/browse/dist/`, and stamps `.version`. `populate-playwright-cache.sh` symlinks `~/.cache/ms-playwright/chromium-<rev>/chrome-linux/{chrome,headless_shell}` → `$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (defaults to `/usr/bin/chromium`) for every Chromium revision referenced by an installed `playwright-core` — so launches don't hit the firewall-blocked Playwright CDN.

As of 2026-04-27 the browse CLI also falls back to the bundled `server-node.mjs` (Node) when `src/server.ts` (Bun) isn't shipped, so once the workspace dist is rebuilt against current devshop source it doesn't need `/devshop` mounted at runtime.

If `design` or `gstack-global-discover` need the same treatment, mirror the rebuild-browse pattern: build from `/devshop/.claude/skills/gstack/.../src/` to `/tmp`, copy back to `/workspace/.claude/skills/gstack/.../dist/`.

## .gitignore Rules

- **Do NOT add `.gstack/` to .gitignore.** The `.gstack/projects/` directory contains gstack-generated plans (office-hours, eng-review, etc.) that should be tracked in git. If ignoring specific subfolders is needed (e.g. analytics or sessions), ignore those specifically — never the whole `.gstack/` folder.
