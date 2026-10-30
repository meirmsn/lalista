# Move the web app from Vercel to Cloudflare Workers

**Go:** pending

## Intent

The owner, on starting the clean public repo: check where the project stands, move it to
Cloudflare, remove everything that is Vercel, keep Supabase, and get back to working on the app.
The owner already created the `production` environment (branch rule `main`) with the Cloudflare
deploy token and account id. The Supabase values come later, and the change should do as much as
it can without them.

## Decisions

- Host the Next.js app as one Worker, `lalista`, built with OpenNext (`@opennextjs/cloudflare`)
  and deployed only from `main` by CI in the `production` environment. This follows the devshop's
  Cloudflare home. Rejected: keeping Vercel (owner, 2026-10-30).
- Keep Supabase (database, auth, realtime, edge function) as it is (owner, 2026-10-30).
- No per-PR preview Workers yet. They need a second, preview-only Cloudflare account, and with no
  real users they can wait. Rejected: previews in the production account, where a PR's workflow
  could overwrite production (owner agreed to the three-phase plan, 2026-10-30).
- Next 16.2.4 → 16.4.1, with `@opennextjs/cloudflare` 1.20.12 and `wrangler` 4.149.0, all at
  least two weeks old. Every OpenNext 1.20 release requires a newer Next. Next 16.3.8 fails
  `next/font/google` under Turbopack, and OpenNext 1.20.11 throws on Next 16.4.1. Rejected:
  OpenNext 1.19 on Next 16.2.4, a May release line behind Next's later security patches.
- Node 20 → 22 in `.nvmrc`, CI and the devcontainer image, because wrangler 4.149 requires Node 22.
  The `supabase-runner` relay container stays on 20: it's a stdlib-only relay, apart from the app.
- No R2 incremental cache, no image binding and no `global_fetch_strictly_public` flag. The app
  has no ISR and no `next/image`, and never fetches its own domain. So the deploy token needs only
  Workers Scripts Edit, and the Worker can reach the local Supabase at 127.0.0.1 in CI's E2E run.
- Keepalive queries the database (`/rest/v1/stores` with the anon key) instead of pinging the site.
  A public page makes no database query, so the old ping never kept Supabase from pausing the free
  project, which is what happened.
- The README no longer says CI runs in a private repo with Actions off here. With this change, CI
  and the deploy run in this repo.
- The devshop's CI tiers (`scripts/check-fast.sh`, `check-slow.sh`, the PR-title rule) come with
  the devshop upgrade, a separate change.
- After the merge, the owner:
  - puts the Supabase values in `production`;
  - attaches the custom domain to the Worker, then sets `SITE_URL`;
  - deletes the Vercel project, its tokens and its GitHub app.

## Acceptance items

- **AC-1** `apps/web/wrangler.jsonc` names the Worker `lalista` and holds no account id, routes or
  hosts. `pnpm --filter @lalista/web build:worker` builds the Worker.
- **AC-2** `scripts/deploy.sh`:
  - refuses (exit 2, nothing deployed) when a required production setting is unset or the config
    names another Worker;
  - records the live version before uploading, and stops if it can't read it;
  - after deploying, fails with the undo line unless `/build.txt` is the commit and `/` has a title.

  Tested by `scripts/deploy.test.sh`.

- **AC-3** CI's `deploy` job runs only on push to `main`, in the `production` environment, after
  `fast`. `fast` runs `scripts/deploy.test.sh`.
- **AC-4** CI's `slow` job runs the Playwright suite against the Worker build
  (`E2E_TARGET=worker`).
- **AC-5** `deploy-migrations.yml`, `deploy-functions.yml` and `keepalive.yml` run in the
  `production` environment, and keepalive queries the database.
- **AC-6** No file outside `pnpm-lock.yaml`, `BUILD-LOG.md` and `specs/` mentions Vercel. There is
  no `vercel.json` and no `vercel` dependency.

## Out of scope

- Per-PR preview Workers and the preview-only Cloudflare account.
- Attaching the custom domain and deleting the Vercel project (owner, after merge).
- The devshop CI-tier alignment and devshop upgrade.
- Any change to the app's behaviour.
