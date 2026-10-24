#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == --live ]]; then
  [[ $# == 1 ]] || { echo "Usage: smoke-test.sh --live" >&2; exit 1; }
  # Read-only checks: never use Compose down/up, migration tools or provider APIs.
  for url in http://127.0.0.1:8787/api/health https://77-114-44-78.sslip.io/api/health; do
    curl --proto '=http,https' --fail --silent --show-error --max-time 20 "$url" | \
      python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True'
  done
  echo "Live health checks passed; no services or data changed."
  exit 0
fi
[[ $# == 0 && ${CI:-} == true ]] || { echo "Use --live on a server; destructive test mode requires CI=true." >&2; exit 1; }
# CI only: never read deployment secrets or contact a real database/provider.
temporary=$(mktemp -d)
cleanup() {
  docker compose -p mstocks-arena-ci --env-file "$temporary/public.env" -f deploy/lightsail/compose.yml down -v >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT
export APP_RELEASE=ci
export MSTOCKS_ENV_FILE="$temporary/app.env"
export MSTOCKS_PUBLIC_ENV_FILE="$temporary/public.env"
printf 'API_HOST=localhost\n' > "$temporary/public.env"
printf 'DATABASE_URL=postgresql://synthetic@unavailable.invalid/postgres\nSESSION_SECRET=%048d\n' 0 > "$temporary/app.env"
compose=(docker compose -p mstocks-arena-ci --env-file "$temporary/public.env" -f deploy/lightsail/compose.yml)
"${compose[@]}" config --quiet
"${compose[@]}" config --format json > "$temporary/config.json"
python3 - "$temporary/config.json" <<'PY'
import json, sys
services = json.load(open(sys.argv[1]))['services']
assert not services['worker'].get('ports')
assert services['api']['ports'][0]['host_ip'] == '127.0.0.1'
assert services['api']['depends_on']['migrate']['condition'] == 'service_completed_successfully'
assert services['worker']['depends_on']['api']['condition'] == 'service_healthy'
PY
"${compose[@]}" run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile
# The production entrypoint must reject a missing DB rather than silently create PGlite.
if docker run --rm -e DATABASE_URL= mstocks-arena:ci migrate; then
  echo "Migration unexpectedly accepted missing configuration." >&2; exit 1
fi
# With an unreachable DB, normal Compose startup must not start API or worker.
if "${compose[@]}" up -d --wait --wait-timeout 45 api; then
  echo "API unexpectedly started after failed migrations." >&2; exit 1
fi
"${compose[@]}" ps --status running -q api | grep . && exit 1
# Bypass dependencies only in this health-only test; API database access is lazy.
"${compose[@]}" up -d --no-deps --wait --wait-timeout 90 api
"${compose[@]}" up -d --no-deps caddy
for attempt in $(seq 1 30); do
  if "${compose[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$temporary/ca.crt" 2>/dev/null; then break; fi
  sleep 1
done
curl --retry 20 --retry-connrefused --retry-delay 1 --fail --silent --show-error \
  --cacert "$temporary/ca.crt" --resolve localhost:443:127.0.0.1 https://localhost/api/health > "$temporary/health.json"
python3 - "$temporary/health.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))['ok'] is True
PY
"${compose[@]}" stop api
curl --silent --cacert "$temporary/ca.crt" --resolve localhost:443:127.0.0.1 \
  'https://localhost/api/health?code=synthetic-private-query-marker' >/dev/null
"${compose[@]}" logs --no-log-prefix caddy > "$temporary/proxy.log"
if grep -q 'synthetic-private-query-marker' "$temporary/proxy.log"; then
  echo "Proxy logs leaked a request query." >&2; exit 1
fi
echo "Container smoke tests passed; no real secrets or production services used."
