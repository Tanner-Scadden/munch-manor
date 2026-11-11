#!/bin/sh
# Plays <runs> pacing runs in rounds of $WORKERS processes (the guard sets
# it), one slice of $SLICE_RUNS runs (2 by default) each, and yields the
# guard's turn between rounds (`pacing.ts yield`, over yieldTurn in
# tools/heavy/turn.ts), taking the WORKERS the guard grants for the next
# round. Prints nothing: `bun tools/balance/pacing.ts report` reads the
# slices. See tools/balance/pacing.ts.
runs=${1:-8}
workers=${WORKERS:-4}
slice=${SLICE_RUNS:-2}
from=${FROM:-0}
pids=""
failed=0
end=$(( from + runs ))
while [ "$from" -lt "$end" ]; do
  started=0
  while [ "$started" -lt "$workers" ] && [ "$from" -lt "$end" ]; do
    count=$slice
    if [ $(( from + count )) -gt "$end" ]; then count=$(( end - from )); fi
    bun tools/balance/pacing.ts run "$count" "$from" &
    pids="$pids $!"
    from=$(( from + count ))
    started=$(( started + 1 ))
  done
  for pid in $pids; do
    wait "$pid" || failed=1
  done
  pids=""
  if [ "$from" -lt "$end" ]; then
    workers=$(bun tools/balance/pacing.ts yield "$workers")
  fi
done
exit $failed
