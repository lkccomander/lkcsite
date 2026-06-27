#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/.." && pwd)"

cd "${root_dir}"

export NODE_ENV="${NODE_ENV:-production}"
export UI_SERVER_ENABLED="${UI_SERVER_ENABLED:-0}"
export RABBITHAT_SECRET_COMMAND="${RABBITHAT_SECRET_COMMAND:-${root_dir}/scripts/get_secret_env.sh}"
export PI_SECRETS_FILE="${PI_SECRETS_FILE:-${root_dir}/.env.pi.secrets}"

if [[ ! -d node_modules ]]; then
  echo "node_modules missing; run npm install first" >&2
  exit 1
fi

if [[ ! -f dist/index.js ]]; then
  echo "dist/index.js missing; running npm run build" >&2
  npm run build
fi

exec node dist/index.js
