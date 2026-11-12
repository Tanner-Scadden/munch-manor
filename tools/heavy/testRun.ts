// `bun run test` and `bun run test:full`: one vitest run, sized to the heavy
// guard's budget. `bun run test` is the fast tier, every project but `sim`.
// `bun run test:full` (the `--full` flag) adds the `sim` project, the whole
// wave replays and seed sweeps (see vitest.config.ts). Any other arguments go
// on to vitest, such as `bun run test -- src/world/zombies/__tests__/kaboomer.story.test.ts` or
// `bun run test -- --changed`.
//
// It never queues and takes no lock. It reads the budget once, gives vitest
// what is left (at least 2 workers, at most one less than the cores), and
// marks itself in the lock directory for as long as it runs, so test runs
// from several agents, and the guard, count each other. In CI it runs
// vitest with its own worker defaults.
import { Array, Clock, Config, Console, Effect, Option } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { formatLoad, testWorkers } from './decision'
import { GuardExit, makeContext, readBudget, runChild } from './guard'
import { ensureLockDirectory, whileTesting } from './lock'
import type { LockHolder } from './records'

const FULL_FLAG = '--full'

const ARGUMENTS = Array.drop(process.argv, 2)

const isFull = Array.contains(ARGUMENTS, FULL_FLAG)

const passedOn = Array.filter(ARGUMENTS, argument => argument !== FULL_FLAG)

// NOTE: the fast tier names the one project it leaves out, so a new project
// (a new package) runs in both tiers without touching this file.
const TIER_ARGUMENTS: ReadonlyArray<string> = isFull
  ? []
  : ['--project', '!sim']

const COMMAND = isFull ? 'bun run test:full' : 'bun run test'

const runVitest = (extraArgs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const exitCode = yield* runChild(
      ['vitest', 'run', ...TIER_ARGUMENTS, ...extraArgs, ...passedOn],
      {},
    ).pipe(Effect.orDie)
    if (exitCode !== 0) {
      return yield* GuardExit.make({ code: exitCode })
    }
  })

const budgeted = Effect.gen(function* () {
  const context = yield* makeContext
  yield* ensureLockDirectory(context.lockDirectory)
  const budget = yield* readBudget(context)
  const workers = testWorkers(budget)
  yield* Console.log(
    `heavy: tests with ${workers} workers (load ${formatLoad(budget.load)}, target ${formatLoad(budget.target)} on ${budget.cores} cores).`,
  )
  const startedAt = yield* Clock.currentTimeMillis
  const holder: LockHolder = {
    pid: process.pid,
    command: COMMAND,
    cwd: process.cwd(),
    startedAt,
    jobClass: 'Shared',
    cost: workers,
  }
  yield* whileTesting(
    context.lockDirectory,
    holder,
    runVitest([`--maxWorkers=${workers}`]),
  )
})

const program = Effect.gen(function* () {
  const maybeCi = yield* Config.String('CI').pipe(Config.option)
  yield* Option.isSome(maybeCi) ? runVitest([]) : budgeted
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
