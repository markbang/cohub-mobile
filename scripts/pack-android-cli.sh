#!/usr/bin/env bash
# Usage: scripts/pack-android-cli.sh <cli-version> <out-dir>
# Packs what DeviceCli downloads: the Cohub CLI installed for Android arm64 (zip of node_modules) and
# upstream Cohub's Node for Android, checked against its published SHA-256 and mirrored beside it.
set -euo pipefail

version=${1:?cli version, e.g. 10.18.0}
out=${2:?output directory}
node_version=26.13.0
node_build=2
node_name="node-v${node_version}-android-arm64-${node_build}.gz"
node_base="https://public.cohub.live/node/v${node_version}"

mkdir -p "$out"
out=$(cd "$out" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$out/$node_name" "$node_base/$node_name"
expected=$(curl -fsSL "$node_base/$node_name.sha256" | cut -d' ' -f1)
echo "$expected  $out/$node_name" | sha256sum -c - >/dev/null

npm install --prefix "$work" --omit=dev --no-audit --no-fund --no-package-lock \
  --os=android --cpu=arm64 "@neta-art/cohub-cli@${version}" >/dev/null
test -f "$work/node_modules/@neta-art/cohub-cli/bin/cohub.js"

zip="cohub-cli-${version}-android-arm64.zip"
rm -f "$out/$zip"
# Fixed times and order keep the archive's digest stable for the same files.
(
  cd "$work"
  find node_modules -exec touch -h -d '2000-01-01T00:00:00Z' {} +
  find node_modules -path '*/.bin' -prune -o -type f -print | LC_ALL=C sort | zip -X -q -@ "$out/$zip"
)

cd "$out"
sha256sum "$node_name" "$zip"
