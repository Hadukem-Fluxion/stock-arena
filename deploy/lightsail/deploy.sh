#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $(id -u) != 0 ]]; then
  echo "Run this deployment through sudo." >&2
  exit 1
fi
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo"
exec 9>/var/lock/mstocks-arena-deploy.lock
flock -n 9 || { echo "Another deployment is running." >&2; exit 1; }
export MSTOCKS_ENV_FILE=${MSTOCKS_ENV_FILE:-/etc/mstocks-arena/.env}
export MSTOCKS_PUBLIC_ENV_FILE=${MSTOCKS_PUBLIC_ENV_FILE:-/etc/mstocks-arena/public.env}
for file in "$MSTOCKS_ENV_FILE" "$MSTOCKS_PUBLIC_ENV_FILE"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Hosting environment files are missing or unsafe." >&2; exit 1; }
  [[ $(stat -c %u "$file") == 0 && $(stat -c %a "$file") == 600 ]] || { echo "Hosting environment files must be root-owned with mode 600." >&2; exit 1; }
done

case "${1:-deploy}" in
  deploy)
    export APP_RELEASE
    APP_RELEASE=$(git rev-parse HEAD)
    [[ -z $(git status --porcelain --untracked-files=normal) ]] || { echo "Deploy only a clean, approved checkout." >&2; exit 1; }
    ;;
  rollback)
    [[ ${2:-} =~ ^[a-f0-9]{40}$ ]] || { echo "Pass the full previous release commit." >&2; exit 1; }
    export APP_RELEASE=$2
    docker image inspect "mstocks-arena:$APP_RELEASE" >/dev/null
    ;;
  *) echo "Usage: deploy.sh [deploy | rollback <approved-commit>]" >&2; exit 1 ;;
esac
compose=(docker compose --env-file "$MSTOCKS_PUBLIC_ENV_FILE" -f deploy/lightsail/compose.yml)
"${compose[@]}" config --quiet
if [[ ${1:-deploy} == deploy ]]; then
  "${compose[@]}" build --pull api
fi
"${compose[@]}" run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile
# Stop the old writer before migrations; a failed migration leaves both apps stopped.
"${compose[@]}" stop worker api
"${compose[@]}" up --no-deps --force-recreate --abort-on-container-exit --exit-code-from migrate migrate
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 api
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 worker caddy
install -d -m 700 /var/lib/mstocks-arena
printf '%s\n' "$APP_RELEASE" > /var/lib/mstocks-arena/current-release
echo "Deployment complete. Verify HTTPS health and worker snapshots."
