#!/usr/bin/env bash
set -euo pipefail

share_root="${PI_RELEASE_SHARE_ROOT:-/mnt/pifiles/PATBv5/releases}"
live_root="${PI_BOT_ROOT:-/home/pi/PATBv5}"
state_dir="/var/lib/patbv5-sync"
manifest="${share_root}/current.json"
mkdir -p "$state_dir"
exec 9>"${state_dir}/sync.lock"
flock -n 9 || exit 0
[[ -r "$manifest" ]] || { echo "release manifest unavailable: $manifest" >&2; exit 1; }
release_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8-sig"))["releaseId"])' "$manifest")"
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]+$ ]] || { echo "invalid release id" >&2; exit 1; }
[[ "$(cat "${state_dir}/last-release" 2>/dev/null || true)" != "$release_id" ]] || exit 0
release="${share_root}/${release_id}"
[[ -f "$release/PATBv5/package-lock.json" && -d "$release/PATBv5pi" ]] || { echo "incomplete release: $release_id" >&2; exit 1; }
stage="${live_root}.stage-${release_id}"
backup="${live_root}.backup-${release_id}"
rm -rf "$stage"
mkdir -p "$stage"
cp -a "$release/PATBv5/." "$stage/"
rm -rf "$stage/node_modules" "$stage/dist"
cp -a "$live_root/.env" "$stage/.env"
cp -a "$release/PATBv5pi/." "$stage/pi-overlay/"
bash "$stage/pi-overlay/apply-to-bot.sh" "$stage"
(cd "$stage" && npm ci && npm run build)
systemctl stop patbv5-paper
mv "$live_root" "$backup"
mv "$stage" "$live_root"
if ! systemctl start patbv5-paper; then
  systemctl stop patbv5-paper || true
  mv "$live_root" "${live_root}.failed-${release_id}"
  mv "$backup" "$live_root"
  systemctl start patbv5-paper || true
  exit 1
fi
echo "$release_id" > "${state_dir}/last-release"
echo "applied Pi release $release_id"
