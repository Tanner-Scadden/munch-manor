#!/bin/sh
# Plays <runs> pacing runs in $WORKERS processes (the guard sets it), one
# slice each, then prints nothing: `bun tools/balance/pacing.ts report`
# reads the slices. See tools/balance/pacing.ts.
runs=${1:-8}
workers=${WORKERS:-4}
per=$(( (runs + workers - 1) / workers ))
from=${FROM:-0}
end=$(( from + runs ))
while [ "$from" -lt "$end" ]; do
  count=$per
  if [ $(( from + count )) -gt "$end" ]; then count=$(( end - from )); fi
  bun tools/balance/pacing.ts run "$count" "$from" &
  from=$(( from + count ))
done
wait
