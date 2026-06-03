#!/usr/bin/env bash
set -eu

PROJECT_ROOT="${PROJECT_ROOT:-/home/pi/lkcsite/PATBv5}"

cd "$PROJECT_ROOT"

mkdir -p "$PROJECT_ROOT/runtime"

echo "[run-bot] starting at $(date -Is)"
echo "[run-bot] project root: $PROJECT_ROOT"

exec /usr/bin/env node dist/index.js
