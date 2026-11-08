# Heavy guard

A small Effect program that every CPU-heavy job goes through, so several agents on one laptop share it instead of piling up. It aims to keep the machine at about 70% busy. Run it from the repo root.

| Command                                      | What it does                                                  |
| -------------------------------------------- | ------------------------------------------------------------- |
| `bun run balance [runs]`                     | The balance bot through the guard                             |
| `bun run perf:check`                         | The frame time gate through the guard                         |
| `bun run heavy -- <command...>`              | Any other heavy command, such as an audit or shots script     |
| `bun run heavy -- --allow-more <command...>` | Run past the balance budget                                   |
| `bun run heavy -- --timing <command...>`     | Run as a Timing job, whatever the command                     |
| `bun run heavy -- --cpu <command...>`        | Run as a CPU job, whatever the command                        |
| `bun run heavy -- --shared <command...>`     | Run as a Shared job, whatever the command                     |
| `bun run heavy -- --reset-budget`            | Reset this worktree and branch's balance batch count          |
| `bun run test`                               | The fast test tier, with vitest's workers sized to the budget |
| `bun run test:full`                          | The full test tier (adds the sim tier), sized the same way    |

| Variable              | Default | What it does                                                          |
| --------------------- | ------- | --------------------------------------------------------------------- |
| `HEAVY_LEASE_MINUTES` | 10      | The lease of a solo turn                                              |
| `HEAVY_CHUNK_RUNS`    | 25      | Runs a balance chunk plays (rounded to whole rounds), 0 for no chunks |
| `HEAVY_WAIT_MINUTES`  | 30      | How long a first turn waits before giving up                          |
| `HEAVY_POLL_SECONDS`  | 10      | How often a waiting guard looks again                                 |

Env vars on the command line, such as `MODE=endless bun run balance 100`, pass through to the child. `--exclusive` still works and means `--timing`.

## Why, and the rules

The game is developed on one laptop (12 cores), often with several agents at once. Two agents running 8-process balance batches together pushed the load average to 30 and made every step about three times slower. Running every job alone went too far the other way: agents queued for half an hour behind a throttled splash audit that used 1% of a core, on a machine at load 4. The owner wants the laptop at about 70% of its capacity.

- **Everything heavy goes through the guard:** the balance bot, `perf:check`, headless Chrome audits, and the shots scripts. Never call `tools/balance/simulate.ts` or a heavy audit directly. The guard only protects jobs that go through it.
- **Timing jobs run alone.** Load skews frame times, so `perf:check` and the timing audits never share the machine.
- **CPU jobs size their workers to the budget.** On an idle machine a balance batch gets 7 or 8 workers instead of 4.
- **Cap tuning at about three batches per change.** Use 100 runs to sort ideas and 200 runs only to confirm the final numbers. Results within a few points of a target are fine: list misses as follow-ups instead of running more batches. The batch budget below backs this up.

## Job classes

`jobClassOf` in `decision.ts` reads the class from the command's words, so a script inside `sh -c "..."` counts too. A script counts by its bare name (`taps.ts`, `./taps.ts`) or under an `audit/` folder, so `src/platform/save.ts` is not the save audit. A command that names several classes takes the most careful one, and a command the guard does not know is Timing, so a new heavy script runs alone until it is listed.

| Class  | Commands                                                                                                                                           | Runs                                                                                      | Cost                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Timing | `perf.ts`, `perf-check.ts` (`bun run perf:check`), `profile.ts`, `measure.ts`, `splash.ts`, and anything unknown                                   | Alone: no CPU job, no Shared job. While the load is at or under the core count            | Not budgeted                                                                                                                |
| CPU    | `balance/simulate.ts` (`bun run balance`, wave snapshots), `balance/nightly.ts`, `determinism/crossEngine.ts`, `beforeAfter.ts`                    | One at a time, beside Shared jobs, never beside a Timing job. When at least 1 worker fits | Its `WORKERS`                                                                                                               |
| Shared | `shots<N>.ts`, `taps.ts`, `twoThumbs.ts`, `offline.ts`, `sqlite.ts`, `sync.ts`, `save.ts`, `live-check.ts`, `icons.ts`, `og.ts`, `beacon-check.ts` | Up to 4 at once, beside a CPU job, when its cost fits                                     | 1 per browser context: `taps.ts` is `TAPS_PARALLEL` (3), `shots33.ts` and `shots34.ts` are `SHOTS_PARALLEL` (3), the rest 1 |

## The budget

```
target   = 0.70 x cores                     (8.4 on 12 cores, or HEAVY_TARGET_LOAD)
recent   = the cost of every running job and test run started in the last minute
headroom = target - 1 minute load - recent
```

The 1 minute load lags by about a minute, so a job that just started counts at its estimated cost until the load shows it.

- **A Shared job starts** when its cost fits: `cost <= headroom`.
- **A CPU job starts** when at least one worker fits, and gets `WORKERS = min(8, the caller's WORKERS if set, floor(headroom - reserved))`, where `reserved` is the cost of the Shared job at the head of the queue that was waiting before it, at most the target. Only the head counts, so a queue of screenshot audits cannot hold back more than the machine has; the others wait at most until the CPU job's next chunk boundary, when it queues again behind them. The guard prints how it sized them, such as `WORKERS=7 fits the budget (target 8.4, load 1.1, 0.0 just started, cap 8).`
- **A Timing job** keeps the old gate, since it runs alone: it waits while the load is above the core count.
- **Timing and Shared jobs** get `WORKERS` as before: the caller's (4 by default), at most 4, cut once the load passes half the cores.

## Fairness

Every waiting job writes a marker with when it arrived, its worktree (its `cwd`), its class, and its cost, and removes it once it holds its file, gives up, or is stopped. A marker whose pid is gone is removed when read.

**The queue order** (`isAheadInQueue`) goes round by worktree, then by arrival. When a job lets go of a file, its guard records the time for its worktree in `held-<key>.json`. A worktree whose turn ended in the last 5 minutes goes behind waiting jobs from worktrees whose turn did not, and of two that both had one, the one whose turn ended first goes first. Within a worktree, or between worktrees with no recent turn, the job that arrived first goes first. So one worktree's back-to-back jobs alternate with another worktree's instead of hogging the queue. "Waiting first" below means ahead in this order.

- A Timing or CPU job waiting first blocks every job that arrives after it, so Shared jobs cannot starve it, except by backfill.
- A Shared job waiting first blocks later Timing jobs and later Shared jobs of equal or larger cost. A smaller Shared job may slip into a gap a bigger one cannot use.
- A CPU job that arrives later is not blocked by a waiting Shared job, but sizes its workers to leave that job's cost free.
- **Backfill.** A Shared job that fits the budget may start ahead of a Timing or CPU job that waits only because a CPU job holds the solo lock: that waiter cannot start before the CPU job lets go anyway, and the Shared job runs beside the CPU job, which Shared jobs may. It stops once the waiter has waited 2 minutes (`BACKFILL_GRACE_MS`), and never applies when the waiter waits for Shared jobs to drain, so at the CPU job's next chunk boundary the waiter gets the lock as soon as the backfilled jobs end. The guard notes it: `Backfill: starting beside the CPU job ahead of pid 6001: bun tools/audit/splash.ts, which waits for that job anyway.` In a model of a typical mix in `decision.test.ts` (a nightly in 30 second chunks, a splash run with three 1 minute profiles, and two worktrees each queueing a 1 minute screenshot job every 2 minutes), screenshot jobs wait 6 seconds on average and 70 at most, the most being a shot that arrived as a splash profile began, which runs alone. Without backfill the worst is 160 seconds.

## Long jobs yield

A job that holds the solo lock for a long time splits itself into parts and yields between them, so other jobs go in between. The guard gives the job `HEAVY_TURN_DIR` and `HEAVY_GUARD_PID`. At each boundary the job calls `yieldTurn` (or `yieldTurnAsync` from a plain script) from `turn.ts`, which writes a request into that directory and waits for the guard's grant.

- **Nobody waiting:** the guard grants at once, so a lone job loses nothing, and renews the turn's lease.
- **Someone waiting:** the guard says `Handing over after 28 of 200 runs: 1 job is waiting (...)`, lets go of its file, and queues again as a new arrival, so it goes behind every job that arrived while it ran and, by the round robin, behind other worktrees. Its batch is not counted or refused again, and the second wait never gives up, since that would throw the work away. Once it holds a file again it grants the request with the new `WORKERS`, and the job goes on with them. The guard's last line says how many times it handed over.

Who yields where:

| Job                   | Boundary                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `balance/simulate.ts` | Every chunk of about 25 runs (`DEFAULT_CHUNK_RUNS`, rounded up to whole rounds of the workers; about 15 seconds at 7 workers, 90 at 1) |
| `simulate.ts --wave`  | Every group of snapshot slots, one slot a worker, so each slot's snapshots are found once                                              |
| `balance/nightly.ts`  | Between its jobs, as well as inside each job                                                                                           |
| `audit/splash.ts`     | Between profiles (fast, slow4g, slow3g)                                                                                                |
| `audit/perf-check.ts` | Between scenarios                                                                                                                      |

`HEAVY_CHUNK_RUNS=n` sets the chunk, and `HEAVY_CHUNK_RUNS=0` plays a batch whole. The chunks never change the results: run `i` is always seed `seedAt(firstSeed, i)`, campaign chunks are merged in seed order, and wave runs are sorted by wave and run. A 50 run batch chunked and unchunked prints the same report.

With every long job yielding, a waiting job is never held up by one long holder for more than a part, about 2 minutes. `decision.test.ts` checks this on a model of the queue: an hour of chunked balance runs beside timing and CPU jobs from three worktrees, where no job waits more than 15 minutes and a job that arrives mid-chunk starts at the next boundary (the same hour unchunked makes them wait far longer).

## Leases

A turn of the solo lock is a lease of 10 minutes (`HEAVY_LEASE_MINUTES`), written into the lock file. A job past it is not stopped. Its guard prints `LEASE UP: pid 6001: ... has held the lock 12m 0s, past its 10 minute lease. ...` on stderr, naming who waits, and again every 5 minutes. A waiting job's message names it too: `Waiting: lock held by pid 6001: ...; it has held the lock 12m 0s, past its 10 minute lease`. A job that yields and keeps its turn starts a new lease. A job that keeps showing up past its lease should be split so it yields.

## What it does

1. **Files.** Every file holds `{pid, command, cwd, startedAt, jobClass, cost}`, is written to a draft, and is hard linked into place, so taking it is atomic. A file whose pid is gone, or that does not decode, is stale: the guard says so and takes it over. A file is released when the child exits, when it fails, and on `SIGINT` or `SIGTERM`, which also stops the child. In the temp directory:
   - `munch-manor-heavy.lock`, the solo lock, held by the Timing or CPU job. One file, so there is at most one of them.
   - `munch-manor-heavy.d/shared-<n>.lock`, one per Shared job, `n` from 1 to 4.
   - `munch-manor-heavy.d/exclusive-waiting-<pid>.json` for a waiting Timing or CPU job, and `waiting-<pid>.json` for a waiting Shared job.
   - `munch-manor-heavy.d/tests-<pid>.json` for a running `bun run test`.
   - `munch-manor-heavy.d/held-<key>.json`, `{cwd, at}`: when a worktree's job last let go of a file, for the round robin.
   - `munch-manor-heavy.d/turns-<pid>/`, where the running job's yield requests and the guard's grants pass.
2. **A second look.** After taking its file, each guard looks again: a Timing job that finds a live Shared slot, or a Shared job that finds a live Timing job in the solo lock, lets go and waits. Two guards racing can both back off, but never both run.
3. **Waiting.** The guard checks every `HEAVY_POLL_SECONDS` (10) for up to `HEAVY_WAIT_MINUTES` (30), and prints why at most every 30 seconds, such as `Waiting: load 5.5 + 0.0 just started + 3 for this job is over the target of 8.4 on 12 cores` or `Waiting: a job is waiting first (pid 6001: bun tools/audit/splash.ts)`. When it gives up it exits with 1.
4. **Balance batch budget.** Balance runs are counted per worktree and branch in `munch-manor-heavy-budget.json` in the temp directory. The third batch warns, and the sixth is refused unless `--allow-more` is passed. A corrupt ledger reads as empty.
5. **Run.** The child gets the terminal's stdin, stdout, and stderr. The guard says how it runs (alone, as the CPU job, or in which slot), exits with the child's code, and prints one line with the wall time and the load before and after.

`HEAVY_STATE_DIR` moves the files and the ledger, and `HEAVY_FAKE_LOAD` replaces the 1 minute load with a fixed number, which is how to try the guard without touching the real files or depending on the machine. For example, with `HEAVY_STATE_DIR` in a scratch directory, `HEAVY_FAKE_LOAD=0 HEAVY_TARGET_LOAD=4.5 HEAVY_POLL_SECONDS=1`, a `--cpu` script with `WORKERS=4` that sleeps in parts and calls `yieldTurnAsync` between them, and two `--shared` jobs started from two other directories while it runs: the Shared jobs do not fit beside it, start at its next boundary, and it comes back beside them with `WORKERS=2`.

## Tests

`bun run test` and `bun run test:full` (`testRun.ts`, the second with `--full`) run one vitest over every project but `sim`, or over all of them, and pass any other arguments on to vitest. Neither queues or takes a lock. It reads the budget once, runs vitest with `--maxWorkers` set to `floor(headroom)`, at least 2 and at most one less than the cores, and marks itself in `tests-<pid>.json` while it runs, so test runs from several agents, and the guard, count each other in the first minute. In CI (`CI` set) it runs vitest with its own defaults.

## Worktrees on an older guard

A worktree that has not rebased runs an older guard.

- **The first guard** knows only `munch-manor-heavy.lock` and runs every job alone. Its jobs hold the solo lock without a class, so new guards treat them as Timing: everything waits for them. New Timing and CPU jobs hold that same file, so it waits for them. It does not read the slot directory, so it can start a job beside new Shared jobs.
- **The two class guard** (Exclusive and Shared) reads the slots and `exclusive-waiting-*.json`. It sees a new CPU job as Exclusive, so its Shared jobs wait for it, and it counts every slot file, up to its own 3. Its slot files have no cost, so new guards estimate it from the command.

Rebase a long-lived worktree before running timing audits in it.

## Files

| File               | What it holds                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decision.ts`      | The pure part: the snapshot, job classes and costs, the budget, fairness, the `Decision`, the slot pick, the test workers, the Schemas, argument parsing |
| `decision.test.ts` | Tests for every decision over fixed snapshots, run by `bun run test`                                                                                     |
| `lock.ts`          | Reading, taking, and releasing the lock and slot files, the markers, and checking a pid                                                                  |
| `turn.ts`          | Yielding between parts: `yieldTurn` for the job, the requests and grants for the guard, the chunk size                                                   |
| `ledger.ts`        | Reading and writing the balance batch ledger                                                                                                             |
| `guard.ts`         | The shell: reads the budget, gathers a snapshot, acts on the decision, and runs the child                                                                |
| `main.ts`          | The guard's entry point                                                                                                                                  |
| `testRun.ts`       | `bun run test` and `test:full`: vitest sized to the budget                                                                                               |

Every choice is made by `decide(snapshot)` and, at a boundary, `decideHandover`, which returns `Run` (with the file to hold, the workers, the cost, whether to take over a stale file, and notes), `Wait` (with the reason), or `Refuse` (with the reason). The shell only reads the load, the files, the markers, and the ledger into a snapshot and carries out what comes back. `maybeConflictAfterTaking` is the pure check each guard makes after taking its file.
