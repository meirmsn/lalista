#!/usr/bin/env bash
# Builds what scripts/local-run.sh serves: the web app's OpenNext Worker build in apps/web/.open-next
# (project contract, scripts/build.sh). Runs from the repo root with the installed node_modules;
# installs nothing, needs no secret, telemetry off. Its users: the devshop's reviewer before its
# local run, the design review before ship, and scripts/check-slow.sh before Playwright.
# The app reads only NEXT_PUBLIC_* values, inlined at build time: the build serves the Supabase it is
# given (NEXT_PUBLIC_SUPABASE_URL), for a local run the local stack. Given none (the devshop's
# reviewer has no stack), it defaults to the local stack's URL and a placeholder key that can't
# authenticate: the public pages render and the signed-in ones redirect to /sign-in, instead of
# every page answering 500 ("URL and Key are required").
# Known exception to "reaches no other host": next/font/google fetches the two fonts from Google at
# build time (FINDINGS.md F-18).
# BUILD_SHA (the commit being built) is accepted and not used: nothing in the app names its commit.
set -euo pipefail
cd "$(dirname "$0")/.."
export NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-no-local-stack}"
exec pnpm --filter @lalista/web build:worker
