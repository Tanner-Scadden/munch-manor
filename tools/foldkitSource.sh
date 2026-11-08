#!/bin/sh
# Clones the Foldkit repository into repos/foldkit, which git ignores, checked
# out at the commit of the installed foldkit package: a canary's version names
# its source commit (0.170.0-canary.<commit>), a release has its tag
# (foldkit@<version>). Agents read the source, examples, and docs from it (see
# FOLDKIT.md); nothing imports from it. Run it again after upgrading Foldkit.
#   bun run foldkit:source
set -eu

version=$(bun -e "console.log(require('./node_modules/foldkit/package.json').version)")
case "$version" in
  *-canary.*) ref=${version##*-canary.} ;;
  *) ref="foldkit@$version" ;;
esac

dir=repos/foldkit
if [ ! -d "$dir/.git" ]; then
  rm -rf "$dir"
  git clone --quiet --filter=blob:none https://github.com/foldkit/foldkit.git "$dir"
fi
git -C "$dir" fetch --quiet --tags origin
git -C "$dir" checkout --quiet --detach "$ref"
echo "repos/foldkit is at $(git -C "$dir" rev-parse --short=12 HEAD), the source of foldkit@$version"
