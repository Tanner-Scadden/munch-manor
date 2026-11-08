import {
  Array,
  Clock,
  Config,
  Console,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Function,
  Option,
  Path,
  Ref,
  Runtime,
  Schedule,
  Schema,
  Scope,
  String,
  pipe,
} from 'effect'
import { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Os from 'node:os'

import {
  type BudgetPolicy,
  Decision,
  Handover,
  Hold,
  Invocation,
  JobClass,
  JobKind,
  LockAction,
  type LockHolder,
  type LockState,
  PARALLEL_ENV_KEYS,
  type SharedSlot,
  type Snapshot,
  USAGE,
  batchesUsed,
  budgetKey,
  classifyLock,
  decide,
  decideHandover,
  formatDuration,
  formatLoad,
  isSameHolderValue,
  jobClassOf,
  jobKindOf,
  maybeConflictAfterTaking,
  maybeLeaseWarning,
  parseArguments,
  recordBatch,
  resetBudget,
  sharedCostOf,
  shouldReport,
  summaryLine,
  targetLoad,
} from './decision'
import { readLedger, updateLedger } from './ledger'
import {
  acquireLock,
  clearIfNotHeld,
  ensureLockDirectory,
  isProcessAlive,
  readSharedSlots,
  readTestRuns,
  readTextIfPresent,
  readTurns,
  readWaiters,
  recordTurn,
  releaseLock,
  rewriteLock,
  sharedSlotPath,
  whileWaiting,
} from './lock'
import {
  GUARD_PID_ENV,
  type PendingRequest,
  TURN_DIR_ENV,
  grantTurn,
  readRequests,
} from './turn'

class BudgetRefused extends Schema.TaggedError<
  BudgetRefused,
  { readonly brand: unique symbol }
>()('BudgetRefused', {
  reason: Schema.String,
}) {}

class WaitTimedOut extends Schema.TaggedError<
  WaitTimedOut,
  { readonly brand: unique symbol }
>()('WaitTimedOut', {
  minutes: Schema.Finite,
  maybeLastReason: Schema.Option(Schema.String),
}) {}

/** @stability unstable */
export class CommandFailedToStart extends Schema.TaggedError<
  CommandFailedToStart,
  { readonly brand: unique symbol }
>()('CommandFailedToStart', {
  command: Schema.String,
  cause: Schema.instanceOf(PlatformError),
}) {}

// NOTE: the guard exits with the child's code, and every message it fails
// with is printed before it fails, so the runtime reports nothing more.
export class GuardExit extends Schema.TaggedError<
  GuardExit,
  { readonly brand: unique symbol }
>()('GuardExit', {
  code: Schema.Finite,
}) {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }
  override readonly [Runtime.errorReported] = false
}

class NotYet extends Schema.TaggedError<
  NotYet,
  { readonly brand: unique symbol }
>()('NotYet', {
  reason: Schema.String,
}) {}

// NOTE: the solo lock keeps the name every guard has used, so guards in
// worktrees that have not rebased still see it. The directory beside it
// holds the Shared slots and the markers.
const LOCK_FILE = 'munch-manor-heavy.lock'
const LOCK_DIRECTORY = 'munch-manor-heavy.d'
const LEDGER_FILE = 'munch-manor-heavy-budget.json'
const FAILURE_EXIT_CODE = 1

const GuardConfig = Config.all({
  maybeRequestedWorkers: Config.Int('WORKERS').pipe(Config.option),
  maybeTargetLoad: Config.Number('HEAVY_TARGET_LOAD').pipe(Config.option),
  waitMinutes: Config.Number('HEAVY_WAIT_MINUTES').pipe(Config.withDefault(30)),
  pollSeconds: Config.Number('HEAVY_POLL_SECONDS').pipe(Config.withDefault(10)),
  leaseMinutes: Config.Number('HEAVY_LEASE_MINUTES').pipe(
    Config.withDefault(10),
  ),
  stateDirectory: Config.String('HEAVY_STATE_DIR').pipe(
    Config.withDefault(Os.tmpdir()),
  ),
  // NOTE: for trying the guard: a fixed 1 minute load instead of the real
  // one, so a scratch run can check the budget on any machine.
  maybeFakeLoad: Config.Number('HEAVY_FAKE_LOAD').pipe(Config.option),
})

export type Context = Readonly<{
  lockPath: string
  lockDirectory: string
  ledgerPath: string
  ledgerKey: string
  maybeRequestedWorkers: Option.Option<number>
  maybeTargetLoad: Option.Option<number>
  maybeFakeLoad: Option.Option<number>
  waitMinutes: number
  pollSeconds: number
  leaseMs: number
}>

// NOTE: who this guard is while it waits: its pid, its command, its class
// and cost, and when it arrived, which orders it against other waiters.
type Arrival = Readonly<{
  command: Array.NonEmptyReadonlyArray<string>
  jobClass: JobClass
  cost: number
  budgetPolicy: BudgetPolicy
  job: JobKind
  waiter: LockHolder
}>

type WaitLog = Readonly<{
  maybeLastReportAt: Option.Option<number>
  maybeLastReason: Option.Option<string>
}>

type Plan = Readonly<{
  hold: Hold
  workers: number
  loadBefore: number
  holder: LockHolder
}>

// NOTE: the turn a running job holds now. Each turn holds its file in its
// own scope, so a handover closes it and the next turn opens another.
type CurrentTurn = Readonly<{
  scope: Scope.Closeable
  plan: Plan
  maybeLastWarnedAt: Option.Option<number>
  isReleased: boolean
}>

const say = (line: string): Effect.Effect<void> => Console.log(`heavy: ${line}`)

const readMachine = (context: Pick<Context, 'maybeFakeLoad'>) =>
  Effect.sync(() => ({
    load: Option.getOrElse(context.maybeFakeLoad, () =>
      pipe(
        Os.loadavg(),
        Array.head,
        Option.getOrElse(() => 0),
      ),
    ),
    cores: Os.availableParallelism(),
  }))

const gitLine = (
  args: ReadonlyArray<string>,
): Effect.Effect<
  Option.Option<string>,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return yield* spawner
      .string(ChildProcess.make('git', args))
      .pipe(Effect.map(String.trim), Effect.option)
  })

/** @stability unstable */
export const makeContext = Effect.gen(function* () {
  const config = yield* GuardConfig
  const path = yield* Path.Path
  const repoRoot = yield* gitLine(['rev-parse', '--show-toplevel'])
  const branch = yield* gitLine(['rev-parse', '--abbrev-ref', 'HEAD'])
  const context: Context = {
    lockPath: path.join(config.stateDirectory, LOCK_FILE),
    lockDirectory: path.join(config.stateDirectory, LOCK_DIRECTORY),
    ledgerPath: path.join(config.stateDirectory, LEDGER_FILE),
    ledgerKey: budgetKey(
      Option.getOrElse(repoRoot, () => process.cwd()),
      Option.getOrElse(branch, () => 'unknown'),
    ),
    maybeRequestedWorkers: config.maybeRequestedWorkers,
    maybeTargetLoad: config.maybeTargetLoad,
    maybeFakeLoad: config.maybeFakeLoad,
    waitMinutes: config.waitMinutes,
    pollSeconds: config.pollSeconds,
    leaseMs: config.leaseMinutes * 60_000,
  }
  return context
})

const readLocks = (context: Context) =>
  Effect.gen(function* () {
    const maybeLockText = yield* readTextIfPresent(context.lockPath)
    const shared = yield* readSharedSlots(context.lockDirectory)
    return {
      lock: classifyLock(maybeLockText, isProcessAlive),
      shared,
    }
  })

export type Budget = Readonly<{
  load: number
  cores: number
  target: number
  now: number
  lock: LockState
  shared: ReadonlyArray<SharedSlot>
  extraRecent: ReadonlyArray<LockHolder>
}>

// NOTE: what the budget reads, for a guard and for `bun run test`: the
// load, the target, the running jobs, and the test runs.
/** @stability unstable */
export const readBudget = (
  context: Context,
): Effect.Effect<Budget, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const machine = yield* readMachine(context)
    const now = yield* Clock.currentTimeMillis
    const { lock, shared } = yield* readLocks(context)
    const testRuns = yield* readTestRuns(context.lockDirectory)
    return {
      load: machine.load,
      cores: machine.cores,
      target: targetLoad(machine.cores, context.maybeTargetLoad),
      now,
      lock,
      shared,
      extraRecent: testRuns,
    }
  })

const gatherSnapshot = (
  context: Context,
  arrival: Arrival,
): Effect.Effect<Snapshot, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const budget = yield* readBudget(context)
    const waiters = yield* readWaiters(context.lockDirectory)
    const turns = yield* readTurns(context.lockDirectory)
    const ledger = yield* readLedger(context.ledgerPath)
    return {
      ...budget,
      pid: arrival.waiter.pid,
      cwd: arrival.waiter.cwd,
      turns,
      jobClass: arrival.jobClass,
      cost: arrival.cost,
      maybeRequestedWorkers: context.maybeRequestedWorkers,
      waiters: Array.filter(
        waiters,
        waiter => waiter.pid !== arrival.waiter.pid,
      ),
      arrivedAt: arrival.waiter.startedAt,
      batchesUsed: batchesUsed(ledger, context.ledgerKey),
      job: arrival.job,
      budgetPolicy: arrival.budgetPolicy,
    }
  })

const reportWait = (
  waitLog: Ref.Ref<WaitLog>,
  reason: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const log = yield* Ref.get(waitLog)
    if (shouldReport(log.maybeLastReportAt, now)) {
      yield* say(`Waiting: ${reason}`)
      yield* Ref.set(waitLog, {
        maybeLastReportAt: Option.some(now),
        maybeLastReason: Option.some(reason),
      })
    } else {
      yield* Ref.set(waitLog, { ...log, maybeLastReason: Option.some(reason) })
    }
  })

const pathOfHold = (context: Context, hold: Hold): string =>
  Hold.match(hold, {
    Solo: () => context.lockPath,
    Shared: ({ slot }) => sharedSlotPath(context.lockDirectory, slot),
  })

const takeTheLock = (
  context: Context,
  arrival: Arrival,
  hold: Hold,
  cost: number,
  lockAction: LockAction,
): Effect.Effect<
  LockHolder,
  NotYet | PlatformError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Effect.gen(function* () {
    const path = pathOfHold(context, hold)
    yield* LockAction.match(lockAction, {
      Create: () => Effect.void,
      TakeOver: ({ reason }) =>
        say(reason).pipe(Effect.andThen(clearIfNotHeld(path))),
    })
    const startedAt = yield* Clock.currentTimeMillis
    const holder: LockHolder = {
      pid: process.pid,
      command: Array.join(arrival.command, ' '),
      cwd: process.cwd(),
      startedAt,
      jobClass: arrival.jobClass._tag,
      cost,
      ...(Hold.isAnyOf(['Solo'])(hold) ? { leaseMs: context.leaseMs } : {}),
    }
    yield* acquireLock(path, holder).pipe(
      Effect.catchTag('LockTaken', () =>
        Effect.fail(NotYet.make({ reason: 'another job took the lock first' })),
      ),
    )
    const { lock, shared } = yield* readLocks(context)
    const maybeConflict = maybeConflictAfterTaking(
      arrival.jobClass,
      holder,
      lock,
      shared,
    )
    if (Option.isSome(maybeConflict)) {
      yield* releaseLock(path, holder)
      return yield* NotYet.make({ reason: maybeConflict.value })
    }
    // NOTE: when the turn ends, the worktree's turn is recorded, so its
    // next job goes behind other worktrees' waiting jobs for a while.
    yield* Effect.addFinalizer(() =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap(at =>
          recordTurn(context.lockDirectory, { cwd: holder.cwd, at }),
        ),
      ),
    )
    return holder
  })

const execute = (
  context: Context,
  arrival: Arrival,
  waitLog: Ref.Ref<WaitLog>,
  snapshot: Snapshot,
): Effect.Effect<
  Plan,
  BudgetRefused | NotYet | PlatformError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Decision.match(decide(snapshot), {
    Refuse: ({ reason }) => Effect.fail(BudgetRefused.make({ reason })),
    Wait: ({ reason }) =>
      reportWait(waitLog, reason).pipe(
        Effect.andThen(Effect.fail(NotYet.make({ reason }))),
      ),
    Run: ({ hold, workers, cost, lockAction, notes }) =>
      Effect.gen(function* () {
        const holder = yield* takeTheLock(
          context,
          arrival,
          hold,
          cost,
          lockAction,
        )
        yield* Effect.forEach(notes, say, { discard: true })
        return { hold, workers, loadBefore: snapshot.load, holder }
      }),
  })

// NOTE: every job marks itself as waiting, so jobs that arrive after it
// queue behind it by the fairness rule in `blockingWaiters`. A first turn
// gives up after HEAVY_WAIT_MINUTES; a job that yielded mid-run waits for
// as long as it takes, since giving up would throw its work away.
type WaitLimit = 'GivesUp' | 'WaitsOn'

const waitForTurn = (
  context: Context,
  arrival: Arrival,
  waitLimit: WaitLimit,
): Effect.Effect<
  Plan,
  BudgetRefused | WaitTimedOut | PlatformError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Effect.gen(function* () {
    yield* ensureLockDirectory(context.lockDirectory)
    const waitLog = yield* Ref.make<WaitLog>({
      maybeLastReportAt: Option.none(),
      maybeLastReason: Option.none(),
    })
    const poll = pipe(
      gatherSnapshot(context, arrival),
      Effect.flatMap(snapshot => execute(context, arrival, waitLog, snapshot)),
      Effect.retry({
        schedule: Schedule.spaced(Duration.seconds(context.pollSeconds)),
        while: error => error._tag === 'NotYet',
      }),
      Effect.catchTag('NotYet', ({ reason }) =>
        Effect.fail(
          WaitTimedOut.make({
            minutes: context.waitMinutes,
            maybeLastReason: Option.some(reason),
          }),
        ),
      ),
    )
    const limited =
      waitLimit === 'WaitsOn'
        ? poll
        : poll.pipe(
            Effect.timeoutOrElse({
              duration: Duration.minutes(context.waitMinutes),
              orElse: () =>
                Ref.get(waitLog).pipe(
                  Effect.flatMap(({ maybeLastReason }) =>
                    Effect.fail(
                      WaitTimedOut.make({
                        minutes: context.waitMinutes,
                        maybeLastReason,
                      }),
                    ),
                  ),
                ),
            }),
          )
    return yield* whileWaiting(context.lockDirectory, arrival.waiter, limited)
  })

// NOTE: waits for a turn and holds its file in a fresh scope, which the
// caller closes to let go of it.
const takeTurn = (
  context: Context,
  arrival: Arrival,
  waitLimit: WaitLimit,
): Effect.Effect<
  CurrentTurn,
  BudgetRefused | WaitTimedOut | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const plan = yield* waitForTurn(context, arrival, waitLimit).pipe(
      Scope.provide(scope),
      Effect.onError(cause => Scope.close(scope, Exit.failCause(cause))),
    )
    return { scope, plan, maybeLastWarnedAt: Option.none(), isReleased: false }
  })

const countBatch = (
  context: Context,
  command: Array.NonEmptyReadonlyArray<string>,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  JobKind.match(jobKindOf(command), {
    Other: () => Effect.void,
    Balance: () =>
      updateLedger(context.ledgerPath, ledger =>
        recordBatch(ledger, context.ledgerKey),
      ).pipe(
        Effect.flatMap(ledger =>
          say(
            `Balance batch ${batchesUsed(ledger, context.ledgerKey)} on ${context.ledgerKey}.`,
          ),
        ),
      ),
  })

/** @stability unstable */
export const runChild: {
  (
    env: Readonly<Record<string, string>>,
  ): (
    command: Array.NonEmptyReadonlyArray<string>,
  ) => Effect.Effect<
    number,
    CommandFailedToStart,
    ChildProcessSpawner.ChildProcessSpawner
  >
  (
    command: Array.NonEmptyReadonlyArray<string>,
    env: Readonly<Record<string, string>>,
  ): Effect.Effect<
    number,
    CommandFailedToStart,
    ChildProcessSpawner.ChildProcessSpawner
  >
} = Function.dual(
  2,
  (
    command: Array.NonEmptyReadonlyArray<string>,
    env: Readonly<Record<string, string>>,
  ): Effect.Effect<
    number,
    CommandFailedToStart,
    ChildProcessSpawner.ChildProcessSpawner
  > =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const exitCode = yield* spawner
        .exitCode(
          ChildProcess.make(
            Array.headNonEmpty(command),
            Array.tailNonEmpty(command),
            {
              env,
              extendEnv: true,
              stdin: 'inherit',
              stdout: 'inherit',
              stderr: 'inherit',
              detached: false,
            },
          ),
        )
        .pipe(
          Effect.mapError(cause =>
            CommandFailedToStart.make({
              command: Array.join(command, ' '),
              cause,
            }),
          ),
        )
      return exitCode
    }),
)

const describeHold = (hold: Hold, jobClass: JobClass): string =>
  Hold.match(hold, {
    Solo: () =>
      JobClass.isAnyOf(['Cpu'])(jobClass) ? 'as the CPU job' : 'alone (timing)',
    Shared: ({ slot }) => `in shared slot ${slot}`,
  })

// NOTE: the variables a Shared script's cost reads, read once per job.
const readParallelEnv = Effect.gen(function* () {
  const entries = yield* Effect.forEach(PARALLEL_ENV_KEYS, key =>
    Effect.gen(function* () {
      const value = yield* Config.option(Config.String(key))
      return [key, value] as const
    }),
  )
  return (key: string): Option.Option<string> =>
    pipe(
      Array.findFirst(entries, ([name]) => name === key),
      Option.flatMap(([, value]) => value),
    )
})

const makeArrival = (
  command: Array.NonEmptyReadonlyArray<string>,
  jobClass: JobClass,
  cost: number,
  budgetPolicy: BudgetPolicy,
  job: JobKind,
  arrivedAt: number,
): Arrival => ({
  command,
  jobClass,
  cost,
  budgetPolicy,
  job,
  waiter: {
    pid: process.pid,
    command: Array.join(command, ' '),
    cwd: process.cwd(),
    startedAt: arrivedAt,
    jobClass: jobClass._tag,
    cost,
  },
})

const REQUEST_POLL = Duration.millis(500)

// NOTE: answers one yield request from the job. When another job waits,
// the turn's file is let go and the job queues again as a new arrival (as
// another kind of job, so its batch is not counted or refused twice), and
// the grant waits until it holds a file again.
const answerRequest = (
  context: Context,
  arrival: Arrival,
  current: Ref.Ref<CurrentTurn>,
  handovers: Ref.Ref<number>,
  turnDirectory: string,
  pending: PendingRequest,
) =>
  Effect.gen(function* () {
    const waiters = yield* readWaiters(context.lockDirectory)
    const turn = yield* Ref.get(current)
    const queueAgain = Effect.gen(function* () {
      yield* Scope.close(turn.scope, Exit.void)
      yield* Ref.set(current, { ...turn, isReleased: true })
      const queuedAt = yield* Clock.currentTimeMillis
      const next = yield* takeTurn(
        context,
        makeArrival(
          arrival.command,
          arrival.jobClass,
          arrival.cost,
          arrival.budgetPolicy,
          JobKind.cases.Other.make({}),
          queuedAt,
        ),
        'WaitsOn',
      )
      yield* Ref.set(current, next)
      yield* Ref.update(handovers, count => count + 1)
      const backAt = yield* Clock.currentTimeMillis
      yield* say(
        `Back after ${formatDuration(backAt - queuedAt)}, ${describeHold(next.plan.hold, arrival.jobClass)} with WORKERS=${next.plan.workers}.`,
      )
    })
    // NOTE: a job that offers to yield and keeps its turn renews its lease.
    const renewLease = Effect.gen(function* () {
      if (!Hold.isAnyOf(['Solo'])(turn.plan.hold)) {
        return
      }
      const now = yield* Clock.currentTimeMillis
      const holder: LockHolder = { ...turn.plan.holder, leaseFrom: now }
      yield* rewriteLock(context.lockPath, holder)
      yield* Ref.set(current, {
        ...turn,
        plan: { ...turn.plan, holder },
        maybeLastWarnedAt: Option.none(),
      })
    })
    // NOTE: a turn let go of by an earlier answer that then failed is
    // queued for again, whoever waits.
    yield* Handover.match(decideHandover(process.pid, waiters), {
      Keep: () => (turn.isReleased ? queueAgain : renewLease),
      HandOver: ({ reason }) =>
        say(`Handing over after ${pending.request.label}: ${reason}.`).pipe(
          Effect.andThen(queueAgain),
        ),
    })
    const after = yield* Ref.get(current)
    yield* grantTurn(turnDirectory, pending.id, after.plan.workers)
  })

const serveTurns = (
  context: Context,
  arrival: Arrival,
  current: Ref.Ref<CurrentTurn>,
  handovers: Ref.Ref<number>,
  turnDirectory: string,
) =>
  readRequests(turnDirectory).pipe(
    Effect.flatMap(requests =>
      Effect.forEach(
        requests,
        pending =>
          answerRequest(
            context,
            arrival,
            current,
            handovers,
            turnDirectory,
            pending,
          ),
        { discard: true },
      ),
    ),
    Effect.catch(error =>
      say(`Could not answer a yield (${error._tag}), trying again.`),
    ),
    Effect.repeat(Schedule.spaced(REQUEST_POLL)),
  )

// NOTE: a solo turn past its lease is not stopped. Its guard says so on
// stderr, once and then every few minutes, naming who waits.
const watchLease = (context: Context, current: Ref.Ref<CurrentTurn>) =>
  Effect.gen(function* () {
    const turn = yield* Ref.get(current)
    // NOTE: a turn handed over holds no file while it queues again.
    if (!Hold.isAnyOf(['Solo'])(turn.plan.hold) || turn.isReleased) {
      return
    }
    const now = yield* Clock.currentTimeMillis
    const value_1 = yield* readWaiters(context.lockDirectory)
    const waiters = Array.filter(value_1, waiter => waiter.pid !== process.pid)
    const maybeWarning = maybeLeaseWarning({
      holder: turn.plan.holder,
      now,
      maybeLastWarnedAt: turn.maybeLastWarnedAt,
      waiters,
    })
    if (Option.isSome(maybeWarning)) {
      yield* Console.error(`heavy: ${maybeWarning.value}`)
      yield* Ref.update(current, latest =>
        isSameHolderValue(latest.plan.holder, turn.plan.holder)
          ? { ...latest, maybeLastWarnedAt: Option.some(now) }
          : latest,
      )
    }
  }).pipe(
    Effect.ignore,
    Effect.repeat(
      Schedule.spaced(Duration.seconds(Math.min(30, context.pollSeconds))),
    ),
  )

const runGuarded = (
  command: Array.NonEmptyReadonlyArray<string>,
  budgetPolicy: BudgetPolicy,
  maybeClassOverride: Option.Option<JobClass>,
) =>
  Effect.gen(function* () {
    const context = yield* makeContext
    const arrivedAt = yield* Clock.currentTimeMillis
    const jobClass = jobClassOf(command, maybeClassOverride)
    const envValue = yield* readParallelEnv
    const cost = JobClass.match(jobClass, {
      Timing: () => 1,
      Cpu: () => 1,
      Shared: () => sharedCostOf(command, envValue),
    })
    const arrival = makeArrival(
      command,
      jobClass,
      cost,
      budgetPolicy,
      jobKindOf(command),
      arrivedAt,
    )
    const first = yield* takeTurn(context, arrival, 'GivesUp')
    const current = yield* Ref.make(first)
    yield* Effect.addFinalizer(() =>
      Ref.get(current).pipe(
        Effect.flatMap(({ scope }) => Scope.close(scope, Exit.void)),
      ),
    )
    const plan = first.plan
    yield* countBatch(context, command)
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const turnDirectory = path.join(
      context.lockDirectory,
      `turns-${process.pid}`,
    )
    yield* fs.makeDirectory(turnDirectory, { recursive: true })
    yield* Effect.addFinalizer(() =>
      Effect.ignore(fs.remove(turnDirectory, { recursive: true })),
    )
    const handovers = yield* Ref.make(0)
    yield* Effect.forkScoped(
      serveTurns(context, arrival, current, handovers, turnDirectory),
    )
    yield* Effect.forkScoped(watchLease(context, current))
    const machine = yield* readMachine(context)
    yield* say(
      `Running ${Array.join(command, ' ')} ${describeHold(plan.hold, jobClass)} with WORKERS=${plan.workers} (load ${formatLoad(machine.load)} on ${machine.cores} cores).`,
    )
    const startedAt = yield* Clock.currentTimeMillis
    const exitCode = yield* runChild(command, {
      WORKERS: `${plan.workers}`,
      [TURN_DIR_ENV]: turnDirectory,
      [GUARD_PID_ENV]: `${process.pid}`,
    })
    const endedAt = yield* Clock.currentTimeMillis
    const after = yield* readMachine(context)
    yield* say(
      summaryLine({
        exitCode,
        wallMs: endedAt - startedAt,
        workers: plan.workers,
        loadBefore: plan.loadBefore,
        loadAfter: after.load,
      }),
    )
    const handedOver = yield* Ref.get(handovers)
    if (handedOver > 0) {
      yield* say(
        `Handed over ${handedOver} ${handedOver === 1 ? 'time' : 'times'} at a boundary between parts.`,
      )
    }
    if (exitCode !== 0) {
      return yield* GuardExit.make({ code: exitCode })
    }
  }).pipe(Effect.scoped)

const resetThisBudget = Effect.gen(function* () {
  const context = yield* makeContext
  yield* updateLedger(context.ledgerPath, ledger =>
    resetBudget(ledger, context.ledgerKey),
  )
  yield* say(`Reset the balance budget for ${context.ledgerKey}.`)
})

const failWith = (message: string): Effect.Effect<never, GuardExit> =>
  Console.error(`heavy: ${message}`).pipe(
    Effect.andThen(Effect.fail(GuardExit.make({ code: FAILURE_EXIT_CODE }))),
  )

/** @stability unstable */
export const program = Effect.suspend(() =>
  Invocation.match(parseArguments(Array.drop(process.argv, 2)), {
    ShowUsage: ({ problem }) => failWith(`${problem}\n${USAGE}`),
    ResetBudget: () => resetThisBudget,
    RunCommand: ({ command, budgetPolicy, maybeClassOverride }) =>
      runGuarded(command, budgetPolicy, maybeClassOverride),
  }),
).pipe(
  Effect.catchTags({
    BudgetRefused: ({ reason }) => failWith(`Refused: ${reason}`),
    WaitTimedOut: ({ minutes, maybeLastReason }) =>
      failWith(
        `Gave up after waiting ${minutes} minutes${Option.match(maybeLastReason, { onNone: () => '.', onSome: reason => `: ${reason}` })}`,
      ),
    CommandFailedToStart: ({ command, cause }) =>
      failWith(`Could not run ${command}: ${cause.message}`),
  }),
)
