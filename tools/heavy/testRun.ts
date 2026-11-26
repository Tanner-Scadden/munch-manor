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

const TIER_ARGUMENTS: ReadonlyArray<string> = isFull
  ? []
  : ['--project', '!sim']

const COMMAND = isFull ? 'bun run test:full' : 'bun run test'

const runVitest = (extraArgs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const exitCode = yield* runChild(
      [
        'vitest',
        'run',
        '--configLoader',
        'native',
        ...TIER_ARGUMENTS,
        ...extraArgs,
        ...passedOn,
      ],
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
