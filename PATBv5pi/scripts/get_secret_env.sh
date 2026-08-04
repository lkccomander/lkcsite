#!/usr/bin/env bash
set -euo pipefail

secret_key="${RABBITHAT_SECRET_KEY:-${SECRET_KEY:-}}"
if [[ -z "${secret_key}" ]]; then
  echo "missing secret key" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/.." && pwd)"
secrets_file="${PI_SECRETS_FILE:-${root_dir}/.env.pi.secrets}"

if [[ -n "${!secret_key:-}" ]]; then
  printf '%s\n' "${!secret_key}"
  exit 0
fi

if [[ ! -f "${secrets_file}" ]]; then
  echo "secret file not found: ${secrets_file}" >&2
  exit 1
fi

value="$(
  awk -F= -v key="${secret_key}" '
    $1 == key {
      sub(/^[^=]*=/, "", $0)
      print $0
      exit
    }
  ' "${secrets_file}"
)"

if [[ -z "${value}" ]]; then
  echo "secret not found: ${secret_key}" >&2
  exit 1
fi

if [[ "${value}" =~ ^\".*\"$ ]] || [[ "${value}" =~ ^\'.*\'$ ]]; then
  value="${value:1:${#value}-2}"
fi

printf '%s\n' "${value}"
