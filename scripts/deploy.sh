#!/usr/bin/env bash
# What: Build the web app as a Cloudflare Worker (OpenNext) and deploy it, recording the
#       version it replaces so the deploy can be undone. Runs in CI's `deploy` job, on `main`
#       only, in the `production` environment.
# Why: one script holds the whole deploy, so CI and its test (scripts/deploy.test.sh) run the
#       same steps. Order matters: nothing is uploaded until the live version is recorded, and
#       the smoke check runs against the build just uploaded (`/build.txt` is the commit).
# Does NOT: roll back. A failed smoke check prints the rollback line; running it is the
#       owner's call (dashboard: Workers → lalista → Deployments).
#
# Reads env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   required (wrangler reads them)
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY   required (inlined at build)
#   NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_POSTHOG_KEY   optional (inlined)
#   BUILD_SHA      the commit being deployed (CI: github.sha)
#   SITE_URL       the custom domain's origin; unset skips its smoke check
#   DEPLOY_NAME    the only Worker this may deploy (default: lalista)
#   SMOKE_TRIES, SMOKE_WAIT   smoke-check attempts and seconds between them (default 10, 6)
#   WRANGLER, BUILD_CMD       overridable for the test (default: pnpm exec wrangler, pnpm build:worker)
# Writes to $GITHUB_OUTPUT: url, version, previous_version, rollback, deployed, site_url, site_smoke.
#
# Exit codes: 0 deployed and smoke-checked · 1 failed (the output says whether it may be live)
#             2 refused before anything changed (missing settings, wrong Worker name)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="${REPO_ROOT}/apps/web"
DEPLOY_NAME="${DEPLOY_NAME:-lalista}"
SMOKE_TRIES="${SMOKE_TRIES:-10}"
SMOKE_WAIT="${SMOKE_WAIT:-6}"
WRANGLER="${WRANGLER:-pnpm exec wrangler}"
BUILD_CMD="${BUILD_CMD:-pnpm build:worker}"
OUT="${GITHUB_OUTPUT:-/dev/null}"

cd "$WEB_DIR"

missing=()
for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY BUILD_SHA; do
  if [ -z "${!name:-}" ]; then missing+=("$name"); fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::Not deploying: unset in the production environment: ${missing[*]}" >&2
  exit 2
fi

# 1. Refuse any config that names another Worker: the deploy token reaches every Worker in
#    its account.
config_name="$(sed -nE 's/^[[:space:]]*"name":[[:space:]]*"([^"]+)".*/\1/p' wrangler.jsonc | head -1)"
if [ "$config_name" != "$DEPLOY_NAME" ]; then
  echo "::error::Not deploying: wrangler.jsonc names '${config_name}', expected '${DEPLOY_NAME}'" >&2
  exit 2
fi

# 2. Build. build.txt is served from public/ so the smoke check can see which build is live.
printf '%s\n' "$BUILD_SHA" >public/build.txt
$BUILD_CMD

# 3. Record the live version before anything changes. No Worker or no deployment yet is a
#    first deploy; any other failure stops here, because a deploy that can't be undone isn't made.
status_file="$(mktemp)"
status_err="$(mktemp)"
trap 'rm -f "$status_file" "$status_err" "${deploy_out:-}"' EXIT
if $WRANGLER deployments status --name "$DEPLOY_NAME" --json >"$status_file" 2>"$status_err"; then
  previous_version="$(node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const v = (d.versions || []).filter((x) => x.percentage === 100);
    console.log(v.length === 1 ? v[0].version_id : "split");
  ' "$status_file")"
elif grep -qE '10007|does not exist|not found|no deployments' "$status_file" "$status_err"; then
  previous_version="none"
else
  echo "::error::Not deploying: could not read the live version" >&2
  cat "$status_file" "$status_err" >&2
  exit 1
fi
case "$previous_version" in
  none) rollback="first deploy: nothing to roll back to (delete the Worker in the dashboard to undo)" ;;
  split) rollback="the previous deployment was split across versions: restore it in the dashboard (Workers → ${DEPLOY_NAME} → Deployments)" ;;
  *) rollback="npx wrangler rollback ${previous_version} --name ${DEPLOY_NAME}" ;;
esac
{
  echo "previous_version=${previous_version}"
  echo "rollback=${rollback}"
} >>"$OUT"

# 4. Deploy.
deploy_out="$(mktemp)"
WRANGLER_OUTPUT_FILE_PATH="$deploy_out" $WRANGLER deploy
echo "deployed=yes" >>"$OUT"
read -r url version < <(node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
  const d = lines.map((l) => JSON.parse(l)).find((e) => e.type === "deploy") || {};
  const t = (d.targets || []).find((x) => x.includes("workers.dev")) || "";
  const url = t && !t.startsWith("https://") ? "https://" + t : t;
  console.log(url || "-", d.version_id || "-");
' "$deploy_out")
{
  echo "url=${url}"
  echo "version=${version}"
} >>"$OUT"

# 5. Smoke check: /build.txt is this commit and / has a <title>, twice in a row, because a
#    new route reaches Cloudflare's edges one by one.
smoke() {
  local base="$1" passes=0 i
  for ((i = 1; i <= SMOKE_TRIES; i++)); do
    if [ "$(curl -fsS "${base}/build.txt" 2>/dev/null | tr -d '[:space:]')" = "$BUILD_SHA" ] &&
      curl -fsS "${base}/" 2>/dev/null | grep -q '<title>'; then
      passes=$((passes + 1))
      if [ "$passes" -ge 2 ]; then return 0; fi
    else
      passes=0
    fi
    sleep "$SMOKE_WAIT"
  done
  return 1
}

if [ "$url" = "-" ] || ! smoke "$url"; then
  echo "::error::Deployed version ${version} may be live but failed its smoke check at ${url}. Undo: ${rollback}" >&2
  exit 1
fi
echo "Smoke check passed: ${url}"

site_smoke="skipped"
if [ -n "${SITE_URL:-}" ]; then
  echo "site_url=${SITE_URL}" >>"$OUT"
  if smoke "$SITE_URL"; then
    site_smoke="passed"
  else
    echo "site_smoke=failed" >>"$OUT"
    echo "::error::${SITE_URL} does not serve build ${BUILD_SHA}. Undo: ${rollback}" >&2
    exit 1
  fi
else
  echo "SITE_URL unset: the custom domain was not checked."
fi
echo "site_smoke=${site_smoke}" >>"$OUT"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "| Deploy | |"
    echo "|---|---|"
    echo "| Commit | \`${BUILD_SHA}\` |"
    echo "| Version | \`${version}\` |"
    echo "| Replaced | \`${previous_version}\` |"
    echo "| URL | ${url} |"
    echo "| Domain check | ${site_smoke} |"
    echo "| Undo | \`${rollback}\` |"
  } >>"$GITHUB_STEP_SUMMARY"
fi
