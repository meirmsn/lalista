#!/usr/bin/env bash
# The slow CI tier: integration tests, the database checks and the end-to-end tests. CI's `slow` job
# runs it after `fast` passes, once its setup steps have started the local Supabase stack and put
# `supabase status -o env` into the environment (API_URL, ANON_KEY, SERVICE_ROLE_KEY). The integration
# tests also need ANTHROPIC_API_KEY (CI gives it the QA key, never production's).
#   - integration tests (Vitest, VITEST_INTEGRATION=1);
#   - type drift (generated types match the migrations) and the rollback SQL EXPLAIN check;
#   - the web app built as a Cloudflare Worker (OpenNext, scripts/build.sh), then Playwright on both
#     projects (mobile, desktop) against it in wrangler's local Workers runtime.
# Every part runs even after one fails, except Playwright, which needs the build.
# Exit 0 = clean; 1 = failures; 2 = couldn't run.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

for v in API_URL ANON_KEY SERVICE_ROLE_KEY; do
  if [ -z "${!v:-}" ]; then
    echo "check-slow: $v isn't set: start the local stack (supabase start) and export supabase status -o env"
    exit 2
  fi
done
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export WRANGLER_SEND_METRICS=false CI_SLOW_JOB=1 E2E_TARGET=worker CI="${CI:-1}"

worst=0
part() {
  local rc
  echo "== $*"
  "$@"
  rc=$?
  case $rc in
    0) ;;
    1) echo "$1 failed"; [ "$worst" -ge 1 ] || worst=1 ;;
    *) echo "$1 couldn't run (exit $rc)"; worst=2 ;;
  esac
  return "$rc"
}

part pnpm test:integration
part bash scripts/ci-type-drift.sh
part bash scripts/ci-rollback-explain.sh
if part bash scripts/build.sh; then
  part pnpm --filter @lalista/web exec playwright test --project=mobile --project=desktop
else
  echo "Playwright skipped: the Worker build failed"
fi
exit "$worst"
