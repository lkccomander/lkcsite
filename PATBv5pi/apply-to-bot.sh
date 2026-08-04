#!/usr/bin/env bash
set -euo pipefail

target_dir="${1:-}"
if [[ -z "${target_dir}" ]]; then
  echo "usage: $0 /path/to/PATBv5" >&2
  exit 1
fi

if [[ ! -d "${target_dir}" ]]; then
  echo "target bot folder not found: ${target_dir}" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "${target_dir}/scripts" "${target_dir}/docs"

install -m 755 "${script_dir}/scripts/get_secret_env.sh" "${target_dir}/scripts/get_secret_env.sh"
install -m 755 "${script_dir}/scripts/pi_run.sh" "${target_dir}/scripts/pi_run.sh"
install -m 755 "${script_dir}/scripts/pi_paper_run.sh" "${target_dir}/scripts/pi_paper_run.sh"
install -m 644 "${script_dir}/docs/raspberry-pi.md" "${target_dir}/docs/raspberry-pi.md"

mkdir -p "${target_dir}/deploy/raspberry-pi"
install -m 644 "${script_dir}/patbv5-paper.service" "${target_dir}/deploy/raspberry-pi/patbv5-paper.service"

if [[ ! -f "${target_dir}/.env" ]]; then
  install -m 644 "${script_dir}/.env.pi.example" "${target_dir}/.env"
  echo "created ${target_dir}/.env from .env.pi.example"
else
  echo "left existing ${target_dir}/.env untouched"
fi

echo "Pi overlay applied to ${target_dir}"
