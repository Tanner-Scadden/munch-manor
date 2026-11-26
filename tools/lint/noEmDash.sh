#!/bin/sh
# NOTE: AGENTS.md "Prose": no em dashes in code, comments, or docs. Skipped:
# repos/ (vendored source). The dash is built from its bytes so this file
# never matches itself.
DASH=$(printf '\342\200\224')
if git grep -n -- "$DASH" -- . ':!repos'; then
  echo 'Em dash found: use a period, a comma, or a colon.' >&2
  exit 1
fi
