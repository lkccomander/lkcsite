#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/.." && pwd)"

cd "${root_dir}"

# These process values take precedence over .env when dotenv loads. This
# launcher is intentionally paper-only and must never submit live orders.
export PAPER_TRADING=true
export BOT_ID="${BOT_ID:-polymarket-bot-v5-pi-paper}"
export NODE_ENV="${NODE_ENV:-production}"
export UI_SERVER_ENABLED=0
export RABBITHAT_SECRET_COMMAND=""
export RABBITHAT_SECRET_PREFIX=""
export RABBITHAT_ALLOW_DOTENV_SECRETS=false
export TELEMETRY_ROOT="${TELEMETRY_ROOT:-${root_dir}/polydb/telemetry}"

if [[ ! -d node_modules ]]; then
  echo "node_modules missing; run npm ci or npm install first" >&2
  exit 1
fi

if [[ ! -f dist/index.js ]]; then
  echo "dist/index.js missing; running npm run build" >&2
  npm run build
fi

echo "[pi-paper-run] starting paper session; bot_id=${BOT_ID}; telemetry=${TELEMETRY_ROOT}"
exec node dist/index.js
