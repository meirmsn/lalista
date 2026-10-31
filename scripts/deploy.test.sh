#!/usr/bin/env bash
# What: Tests scripts/deploy.sh with a fake wrangler and curl (no network, no Cloudflare).
# Why: the deploy only runs on `main`, so its refusals and its rollback record are proven here,
#      in the fast job, before a merge can reach them.
# Does NOT: build the app (BUILD_CMD is `true`) or reach Cloudflare.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="${REPO_ROOT}/scripts/deploy.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; rm -f "${REPO_ROOT}/apps/web/public/build.txt"' EXIT
failures=0

# Fake wrangler: `deployments status` answers per $FAKE_STATUS; `deploy` writes the output
# entry wrangler writes and logs the call.
cat >"$WORK/wrangler" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_LOG"
case "$1 $2" in
  "deployments status")
    case "$FAKE_STATUS" in
      live) echo '{"versions":[{"version_id":"v-old","percentage":100}]}' ;;
      split) echo '{"versions":[{"version_id":"a","percentage":50},{"version_id":"b","percentage":50}]}' ;;
      none) echo "✘ [ERROR] The Worker lalista has no deployments." >&2; exit 1 ;;
      broken) echo "✘ [ERROR] Authentication error [code: 10000]" >&2; exit 1 ;;
    esac ;;
  "deploy ")
    printf '{"type":"deploy","version":1,"version_id":"v-new","targets":["lalista.example.workers.dev"]}\n' >"$WRANGLER_OUTPUT_FILE_PATH" ;;
esac
EOF
# Fake curl: serves $FAKE_SHA as /build.txt and a page with a title.
cat >"$WORK/curl" <<'EOF'
#!/usr/bin/env bash
url="${*: -1}"
case "$url" in
  */build.txt) echo "$FAKE_SHA" ;;
  *) echo "<html><head><title>lalista</title></head></html>" ;;
esac
EOF
chmod +x "$WORK/wrangler" "$WORK/curl"

# run <expected exit> <name> [VAR=value ...]: runs deploy.sh with a complete settings set,
# overridden by the arguments; leaves its outputs in $WORK/out.
run() {
  local want="$1" name="$2"
  shift 2
  : >"$WORK/out"
  : >"$WORK/log"
  local got=0
  env PATH="$WORK:$PATH" WRANGLER="$WORK/wrangler" BUILD_CMD=true GITHUB_OUTPUT="$WORK/out" \
    FAKE_LOG="$WORK/log" FAKE_STATUS=live FAKE_SHA=abc123 SMOKE_TRIES=3 SMOKE_WAIT=0 \
    CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=a NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=k BUILD_SHA=abc123 SITE_URL= "$@" \
    "$DEPLOY" >"$WORK/stdout" 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: exit $got, expected $want"
    sed 's/^/     /' "$WORK/stdout"
    failures=$((failures + 1))
  fi
}
expect() { # expect <name> <grep pattern> <file>
  if grep -qE "$2" "$3"; then echo "ok   $1"; else
    echo "FAIL $1: no /$2/ in $(basename "$3")"
    failures=$((failures + 1))
  fi
}
expect_not() {
  if grep -qE "$2" "$3"; then
    echo "FAIL $1: found /$2/ in $(basename "$3")"
    failures=$((failures + 1))
  else echo "ok   $1"; fi
}

run 0 "AC-2 deploys and records the version it replaced"
expect "  rollback names the previous version" '^rollback=npx wrangler rollback v-old --name lalista$' "$WORK/out"
expect "  url is the workers.dev host over https" '^url=https://lalista.example.workers.dev$' "$WORK/out"
expect "  version is the new one" '^version=v-new$' "$WORK/out"
expect "  domain check skipped without SITE_URL" '^site_smoke=skipped$' "$WORK/out"

run 2 "AC-2 refuses with a production setting missing" NEXT_PUBLIC_SUPABASE_URL=
expect "  names the missing setting" 'NEXT_PUBLIC_SUPABASE_URL' "$WORK/stdout"
expect_not "  nothing deployed" '^deploy( |$)' "$WORK/log"

run 2 "AC-2 refuses a config naming another Worker" DEPLOY_NAME=website
expect_not "  nothing deployed" '^deploy( |$)' "$WORK/log"

run 0 "AC-2 first deploy when the Worker has no deployments" FAKE_STATUS=none
expect "  previous_version is none" '^previous_version=none$' "$WORK/out"

run 0 "AC-2 split deployment is recorded for the dashboard" FAKE_STATUS=split
expect "  rollback points to the dashboard" '^rollback=the previous deployment was split' "$WORK/out"

run 1 "AC-2 stops when the live version can't be read" FAKE_STATUS=broken
expect_not "  nothing deployed" '^deploy( |$)' "$WORK/log"

run 1 "AC-2 fails the smoke check when another build is live" FAKE_SHA=other
expect "  says it may be live, with the undo line" 'may be live.*Undo: npx wrangler rollback v-old' "$WORK/stdout"
expect "  deployed=yes was written" '^deployed=yes$' "$WORK/out"

run 0 "AC-2 checks the custom domain when SITE_URL is set" SITE_URL=https://example.test
expect "  domain check passed" '^site_smoke=passed$' "$WORK/out"

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all deploy.sh tests passed"
