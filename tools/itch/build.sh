#!/bin/sh
# Builds the game for itch.io and zips it for upload as an HTML game, with
# index.html at the top of the zip (see "itch.io" in infra/README.md).
#
# The build talks to production's API, so co-op, device linking, and the
# anonymous run summaries work from itch's page, and joins the same rooms as
# munchmanor.com. Its service worker is the kill switch (KILL_SERVICE_WORKER),
# which removes itself: inside itch's frame a worker could keep serving an old
# build after a new upload. A shared room link points at munchmanor.com,
# since a link to itch's frame would open the game outside its page. The
# build id says itch, so its version.json matches the page it ships with.
#   bun run build:itch
set -eu

sha=$(git rev-parse --short=9 HEAD)
BUILD_ID="itch-$sha" \
  VITE_API_ORIGIN=https://api.munchmanor.com \
  VITE_COOP=On \
  VITE_ROOM_LINK_BASE=https://munchmanor.com/ \
  KILL_SERVICE_WORKER=1 \
  bun run build

out=tools/itch/out
mkdir -p "$out"
zip_path="$out/munch-manor-itch-$sha.zip"
rm -f "$zip_path"
# NOTE: _headers is Cloudflare's; itch ignores it.
(cd dist && zip -qr "../$zip_path" . -x _headers)
echo "Wrote $zip_path ($(du -h "$zip_path" | cut -f1)), build itch-$sha"
