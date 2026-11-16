#!/usr/bin/env bash
# Pull the shared interface from a sediment-interface checkout into this repo.
#
#   dev/sync_core.sh [path-to-sediment-interface]   (default: ../sediment-interface)
#
# index.html (the interface) and its harness are owned by the public sediment-interface repo
# and vendored here byte for byte. The harness is stored as dev/interface_harness.js, because
# dev/headless_harness.js in this repo is the coastal model's own harness. dev/core.lock
# records the commit and the hashes, and dev/site_checks.js fails the interface harness if
# either file no longer matches the lock. To change the interface, change it in
# sediment-interface, commit there, then run this. model.js and site.js are this repo's own.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-$here/../sediment-interface}"
# source path in sediment-interface : path here
pairs=("index.html:index.html" "dev/headless_harness.js:dev/interface_harness.js")

[ -d "$src/.git" ] || { echo "not a git checkout: $src" >&2; exit 1; }
for p in "${pairs[@]}"; do
  if [ -n "$(git -C "$src" status --porcelain -- "${p%%:*}")" ]; then
    echo "uncommitted changes to ${p%%:*} in $src; commit them first" >&2; exit 1
  fi
done
commit="$(git -C "$src" rev-parse HEAD)"
{
  echo "# Written by dev/sync_core.sh. Do not edit."
  echo "source bradcantrell/sediment-interface"
  echo "commit $commit"
  for p in "${pairs[@]}"; do
    from="${p%%:*}"; to="${p##*:}"
    git -C "$src" show "HEAD:$from" > "$here/$to"
    echo "sha256 $(sha256sum "$here/$to" | cut -d' ' -f1) $to"
  done
} > "$here/dev/core.lock"
echo "synced the interface from $src at ${commit:0:7}"
