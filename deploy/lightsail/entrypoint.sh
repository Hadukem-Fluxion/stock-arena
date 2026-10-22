#!/bin/sh
set -eu
node scripts/lightsail/validate-env.mjs "$@"
case "$1" in
  api) exec pnpm start:api ;;
  worker) exec pnpm start:worker ;;
  migrate) exec pnpm db:migrate ;;
esac
