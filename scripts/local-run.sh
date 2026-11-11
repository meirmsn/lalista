#!/usr/bin/env bash
# Serves the web app on 127.0.0.1:$PORT (default 3000) in wrangler's local Workers runtime, the one
# production runs on, until stopped. It serves what scripts/build.sh built (the OpenNext build) and
# builds nothing: run scripts/build.sh first. Installs nothing. The app talks to the Supabase its
# build was given (NEXT_PUBLIC_SUPABASE_URL); for a local run, the local stack.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
if [ ! -d .open-next ]; then
  echo "local-run: no OpenNext build in apps/web/.open-next (run: scripts/build.sh)" >&2
  exit 2
fi
export WRANGLER_SEND_METRICS=false
exec pnpm exec wrangler dev --ip 127.0.0.1 --port "${PORT:-3000}"
