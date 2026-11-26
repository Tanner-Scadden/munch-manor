import {
  Array,
  Function,
  Number,
  Option,
  Order,
  Schema,
  String,
  pipe,
} from 'effect'

import { JobKind, sharedCostOf } from './jobKind'
import {
  BudgetPolicy,
  type HeldTurn,
  JobClass,
  type LockHolder,
  LockState,
  isSameHolderValue,
  jobClassOfName,
} from './records'

export const BUDGET_WARN_AT = 3
export const BUDGET_REFUSE_AT = 6
export const REPORT_EVERY_MS = 30_000

const TARGET_SHARE = 0.7
const RECENT_MS = 60_000
const MAX_SHARED_JOBS = 4
export const MAX_CPU_WORKERS = 8
const MIN_TEST_WORKERS = 2
export const MAX_OTHER_WORKERS = 4

export const DEFAULT_LEASE_MS = 10 * 60_000
export const LEASE_REMIND_MS = 5 * 60_000
export const RECENT_TURN_MS = 5 * 60_000
export const DEFAULT_CHUNK_RUNS = 25
export const BACKFILL_GRACE_MS = 2 * 60_000

export type SharedSlot = Readonly<{
  slot: number
  lock: LockState
}>

export type Snapshot = Readonly<{
  pid: number
  cwd: string
  turns: ReadonlyArray<HeldTurn>
  load: number
  cores: number
  target: number
  now: number
  jobClass: JobClass
  cost: number
  maybeRequestedWorkers: Option.Option<number>
  lock: LockState
  shared: ReadonlyArray<SharedSlot>
  waiters: ReadonlyArray<LockHolder>
  extraRecent: ReadonlyArray<LockHolder>
  arrivedAt: number
  batchesUsed: number
  job: JobKind
  budgetPolicy: BudgetPolicy
}>

export const LockAction = Schema.TaggedUnion({
  Create: {},
  TakeOver: { reason: Schema.String },
})
export type LockAction = typeof LockAction.Type

export const Hold = Schema.TaggedUnion({
  Solo: {},
  Shared: { slot: Schema.Finite },
})
export type Hold = typeof Hold.Type

export const Decision = Schema.TaggedUnion({
  Run: {
    hold: Hold,
    workers: Schema.Finite,
    cost: Schema.Finite,
    lockAction: LockAction,
    notes: Schema.Array(Schema.String),
  },
  Wait: { reason: Schema.String },
  Refuse: { reason: Schema.String },
})
export type Decision = typeof Decision.Type

export const formatLoad = (load: number): string => load.toFixed(1)

export const targetLoad: {
  (maybeOverride: Option.Option<number>): (cores: number) => number
  (cores: number, maybeOverride: Option.Option<number>): number
} = Function.dual(
  2,
  (cores: number, maybeOverride: Option.Option<number>): number =>
    Option.getOrElse(maybeOverride, () => cores * TARGET_SHARE),
)

const isOverloaded = (load: number, cores: number): boolean => load > cores

export const allowedWorkers: {
  (load: number, cores: number): (requested: number) => number
  (requested: number, load: number, cores: number): number
} = Function.dual(
  3,
  (requested: number, load: number, cores: number): number => {
    const capped = Number.clamp(requested, {
      minimum: 1,
      maximum: MAX_OTHER_WORKERS,
    })
    if (load <= cores / 2) {
      return capped
    }
    return Math.min(capped, Math.max(1, Math.floor((cores - load) / 2)))
  },
)

const ordinal = (count: number): string =>
  pipe(
    ['first', 'second', 'third', 'fourth', 'fifth'],
    Array.get(count - 1),
    Option.getOrElse(() => `${count}th`),
  )

const isBalance = (snapshot: Snapshot): boolean =>
  JobKind.isAnyOf(['Balance'])(snapshot.job)

const thisBatch = (snapshot: Snapshot): number => snapshot.batchesUsed + 1

const maybeBudgetRefusal = (snapshot: Snapshot): Option.Option<string> =>
  isBalance(snapshot) &&
  BudgetPolicy.isAnyOf(['Enforced'])(snapshot.budgetPolicy) &&
  thisBatch(snapshot) >= BUDGET_REFUSE_AT
    ? Option.some(
        `This would be balance batch ${thisBatch(snapshot)} on this branch, and the budget stops at ${BUDGET_REFUSE_AT - 1}. Accept near-target results and list the misses as follow-ups, or pass --allow-more.`,
      )
    : Option.none()

const maybeBudgetWarning = (snapshot: Snapshot): Option.Option<string> =>
  isBalance(snapshot) && thisBatch(snapshot) >= BUDGET_WARN_AT
    ? Option.some(
        `${String.capitalize(ordinal(thisBatch(snapshot)))} balance batch on this branch; prefer accepting near-target results.`,
      )
    : Option.none()

const describeHolder = (holder: LockHolder): string =>
  `pid ${holder.pid}: ${holder.command}`

const describeHolders = (holders: ReadonlyArray<LockHolder>): string =>
  Array.join(Array.map(holders, describeHolder), '; ')

const leaseOf = (holder: LockHolder): number =>
  holder.leaseMs ?? DEFAULT_LEASE_MS

const leaseStartOf = (holder: LockHolder): number =>
  holder.leaseFrom ?? holder.startedAt

export const isPastLease: {
  (now: number): (holder: LockHolder) => boolean
  (holder: LockHolder, now: number): boolean
} = Function.dual(
  2,
  (holder: LockHolder, now: number): boolean =>
    now - leaseStartOf(holder) > leaseOf(holder),
)

const leaseMinutes = (holder: LockHolder): string =>
  `${globalThis.Number((leaseOf(holder) / 60_000).toFixed(1))} minute`

const leaseOverText = (holder: LockHolder, now: number): string =>
  `has held the lock ${formatDuration(now - leaseStartOf(holder))}, past its ${leaseMinutes(holder)} lease`

const pastLeasePart = (holder: LockHolder, now: number): string =>
  `${describeHolder(holder)} ${leaseOverText(holder, now)}`

export const maybeLeaseWarning = (
  warning: Readonly<{
    holder: LockHolder
    now: number
    maybeLastWarnedAt: Option.Option<number>
    waiters: ReadonlyArray<LockHolder>
  }>,
): Option.Option<string> => {
  const { holder, now, maybeLastWarnedAt, waiters } = warning
  const isDue = Option.match(maybeLastWarnedAt, {
    onNone: () => true,
    onSome: lastWarnedAt => now - lastWarnedAt >= LEASE_REMIND_MS,
  })
  if (!isPastLease(holder, now) || !isDue) {
    return Option.none()
  }
  const waiting = Array.isReadonlyArrayNonEmpty(waiters)
    ? `${waiters.length} waiting: ${describeHolders(waiters)}`
    : 'nobody is waiting yet'
  return Option.some(
    `LEASE UP: ${pastLeasePart(holder, now)}. It keeps running; split it so it yields between parts (see tools/heavy/turn.ts). ${String.capitalize(waiting)}.`,
  )
}

const soloClassOf = (holder: LockHolder): JobClass =>
  jobClassOfName(holder.jobClass ?? 'Timing')

const noEnv = (): Option.Option<string> => Option.none()

export const costOf = (holder: LockHolder): number =>
  holder.cost ?? sharedCostOf([holder.command], noEnv)

const liveSharedHolders = (
  shared: ReadonlyArray<SharedSlot>,
): ReadonlyArray<LockHolder> =>
  Array.flatMap(shared, ({ lock }) =>
    LockState.isAnyOf(['Held'])(lock) ? [lock.holder] : [],
  )

const liveHolders = (snapshot: Snapshot): ReadonlyArray<LockHolder> => [
  ...(LockState.isAnyOf(['Held'])(snapshot.lock) ? [snapshot.lock.holder] : []),
  ...liveSharedHolders(snapshot.shared),
  ...snapshot.extraRecent,
]

export const recentCost = (snapshot: Snapshot): number =>
  pipe(
    liveHolders(snapshot),
    Array.filter(holder => snapshot.now - holder.startedAt < RECENT_MS),
    Array.map(costOf),
    Number.sumAll,
  )

export const headroom = (snapshot: Snapshot): number =>
  snapshot.target - snapshot.load - recentCost(snapshot)

const waiterClassOf = (waiter: LockHolder): JobClass =>
  jobClassOfName(waiter.jobClass ?? 'Timing')

export const lastTurnAt: {
  (cwd: string, now: number): (turns: ReadonlyArray<HeldTurn>) => number
  (turns: ReadonlyArray<HeldTurn>, cwd: string, now: number): number
} = Function.dual(
  3,
  (turns: ReadonlyArray<HeldTurn>, cwd: string, now: number): number =>
    pipe(
      turns,
      Array.filter(turn => turn.cwd === cwd && now - turn.at < RECENT_TURN_MS),
      Array.reduce(0, (latest, turn) => Math.max(latest, turn.at)),
    ),
)

type QueueKey = readonly [number, number, number]

const queueKeyOf = (
  snapshot: Snapshot,
  job: Readonly<{ cwd: string; startedAt: number; pid: number }>,
): QueueKey => [
  lastTurnAt(snapshot.turns, job.cwd, snapshot.now),
  job.startedAt,
  job.pid,
]

const compareKeys = (first: QueueKey, second: QueueKey): number =>
  first[0] - second[0] || first[1] - second[1] || first[2] - second[2]

export const isAheadInQueue: {
  (waiter: LockHolder): (snapshot: Snapshot) => boolean
  (snapshot: Snapshot, waiter: LockHolder): boolean
} = Function.dual(
  2,
  (snapshot: Snapshot, waiter: LockHolder): boolean =>
    compareKeys(
      queueKeyOf(snapshot, waiter),
      queueKeyOf(snapshot, {
        cwd: snapshot.cwd,
        startedAt: snapshot.arrivedAt,
        pid: snapshot.pid,
      }),
    ) < 0,
)

const earlierWaiters = (snapshot: Snapshot): ReadonlyArray<LockHolder> =>
  Array.filter(snapshot.waiters, waiter => isAheadInQueue(snapshot, waiter))

const canBackfillPast = (snapshot: Snapshot, waiter: LockHolder): boolean =>
  JobClass.isAnyOf(['Shared'])(snapshot.jobClass) &&
  !JobClass.isAnyOf(['Shared'])(waiterClassOf(waiter)) &&
  LockState.isAnyOf(['Held'])(snapshot.lock) &&
  JobClass.isAnyOf(['Cpu'])(soloClassOf(snapshot.lock.holder)) &&
  snapshot.now - waiter.startedAt < BACKFILL_GRACE_MS

const backfilledWaiters = (snapshot: Snapshot): ReadonlyArray<LockHolder> =>
  Array.filter(earlierWaiters(snapshot), waiter =>
    canBackfillPast(snapshot, waiter),
  )

const blockingWaiters = (snapshot: Snapshot): ReadonlyArray<LockHolder> =>
  Array.filter(earlierWaiters(snapshot), waiter =>
    JobClass.match(waiterClassOf(waiter), {
      Timing: () => !canBackfillPast(snapshot, waiter),
      Cpu: () => !canBackfillPast(snapshot, waiter),
      Shared: () =>
        JobClass.match(snapshot.jobClass, {
          Timing: () => true,
          Cpu: () => false,
          Shared: () => costOf(waiter) <= snapshot.cost,
        }),
    }),
  )

const reservedCost = (snapshot: Snapshot): number =>
  pipe(
    earlierWaiters(snapshot),
    Array.filter(waiter => JobClass.isAnyOf(['Shared'])(waiterClassOf(waiter))),
    Array.sort(
      Order.make<LockHolder>((first, second) =>
        Number.sign(
          compareKeys(
            queueKeyOf(snapshot, first),
            queueKeyOf(snapshot, second),
          ),
        ),
      ),
    ),
    Array.head,
    Option.match({
      onNone: () => 0,
      onSome: head => Math.min(costOf(head), snapshot.target),
    }),
  )

const cpuWorkers = (snapshot: Snapshot): number =>
  Math.min(
    MAX_CPU_WORKERS,
    Option.getOrElse(snapshot.maybeRequestedWorkers, () => MAX_CPU_WORKERS),
    Math.floor(headroom(snapshot) - reservedCost(snapshot)),
  )

const budgetPart = (snapshot: Snapshot, need: string): string =>
  `load ${formatLoad(snapshot.load)} + ${formatLoad(recentCost(snapshot))} just started + ${need} is over the target of ${formatLoad(snapshot.target)} on ${snapshot.cores} cores`

const maybeLoadPart = (snapshot: Snapshot): Option.Option<string> =>
  JobClass.match(snapshot.jobClass, {
    Timing: () =>
      isOverloaded(snapshot.load, snapshot.cores)
        ? Option.some(
            `load ${formatLoad(snapshot.load)} over ${snapshot.cores} cores`,
          )
        : Option.none(),
    Cpu: () =>
      cpuWorkers(snapshot) < 1
        ? Option.some(
            budgetPart(
              snapshot,
              reservedCost(snapshot) > 0
                ? `1 worker (and ${formatLoad(reservedCost(snapshot))} kept for jobs waiting first)`
                : '1 worker',
            ),
          )
        : Option.none(),
    Shared: () =>
      snapshot.cost > headroom(snapshot)
        ? Option.some(budgetPart(snapshot, `${snapshot.cost} for this job`))
        : Option.none(),
  })

const maybeSoloBlocker = (snapshot: Snapshot): Option.Option<string> => {
  if (!LockState.isAnyOf(['Held'])(snapshot.lock)) {
    return Option.none()
  }
  const holder = snapshot.lock.holder
  const isTiming = JobClass.isAnyOf(['Timing'])(soloClassOf(holder))
  return JobClass.isAnyOf(['Shared'])(snapshot.jobClass) && !isTiming
    ? Option.none()
    : Option.some(
        isTiming
          ? `lock held by ${describeHolder(holder)}`
          : `a CPU job is running (${describeHolder(holder)})`,
      )
}

const withLeasePart = (snapshot: Snapshot, reason: string): string => {
  if (
    !LockState.isAnyOf(['Held'])(snapshot.lock) ||
    !isPastLease(snapshot.lock.holder, snapshot.now)
  ) {
    return reason
  }
  const holder = snapshot.lock.holder
  return String.includes(describeHolder(holder))(reason)
    ? `${reason}; it ${leaseOverText(holder, snapshot.now)}`
    : `${reason}; ${pastLeasePart(holder, snapshot.now)}`
}

const maybeSharedBlocker = (snapshot: Snapshot): Option.Option<string> => {
  const running = liveSharedHolders(snapshot.shared)
  return JobClass.match(snapshot.jobClass, {
    Timing: () =>
      Array.isReadonlyArrayNonEmpty(running)
        ? Option.some(
            `${running.length} shared ${running.length === 1 ? 'job' : 'jobs'} running (${describeHolders(running)})`,
          )
        : Option.none(),
    Cpu: () => Option.none(),
    Shared: () =>
      running.length >= MAX_SHARED_JOBS
        ? Option.some(
            `all ${MAX_SHARED_JOBS} shared slots busy (${describeHolders(running)})`,
          )
        : Option.none(),
  })
}

const maybeWaiterBlocker = (snapshot: Snapshot): Option.Option<string> => {
  const blocking = blockingWaiters(snapshot)
  return Array.isReadonlyArrayNonEmpty(blocking)
    ? Option.some(
        `${blocking.length === 1 ? 'a job is' : `${blocking.length} jobs are`} waiting first (${describeHolders(blocking)})`,
      )
    : Option.none()
}

export const maybeWaitReason = (snapshot: Snapshot): Option.Option<string> =>
  Option.map(maybeBaseWaitReason(snapshot), reason =>
    withLeasePart(snapshot, reason),
  )

const maybeBaseWaitReason = (snapshot: Snapshot): Option.Option<string> => {
  const blockers = Array.getSomes([
    maybeSoloBlocker(snapshot),
    maybeWaiterBlocker(snapshot),
    maybeSharedBlocker(snapshot),
  ])
  const maybeLoad = maybeLoadPart(snapshot)
  if (!Array.isReadonlyArrayNonEmpty(blockers)) {
    return maybeLoad
  }
  const lockPart = Array.join(blockers, '; ')
  return Option.some(
    Option.match(maybeLoad, {
      onNone: () => lockPart,
      onSome: loadPart => `${loadPart} (${lockPart})`,
    }),
  )
}

const lockActionOf = (lock: LockState, what: string): LockAction =>
  LockState.match(lock, {
    Free: () => LockAction.cases.Create.make({}),
    Held: () => LockAction.cases.Create.make({}),
    Stale: ({ holder }) =>
      LockAction.cases.TakeOver.make({
        reason: `Taking over a stale ${what}: ${describeHolder(holder)} is gone.`,
      }),
    Unreadable: () =>
      LockAction.cases.TakeOver.make({
        reason: `Taking over a ${what} file that does not decode.`,
      }),
  })

export const freeSlot = (
  shared: ReadonlyArray<SharedSlot>,
): Option.Option<SharedSlot> =>
  pipe(
    Array.range(1, MAX_SHARED_JOBS),
    Array.map((slot): SharedSlot =>
      pipe(
        Array.findFirst(shared, found => found.slot === slot),
        Option.getOrElse((): SharedSlot => ({
          slot,
          lock: LockState.cases.Free.make({}),
        })),
      ),
    ),
    Array.findFirst(({ lock }) => !LockState.isAnyOf(['Held'])(lock)),
  )

type Place = Readonly<{
  hold: Hold
  workers: number
  cost: number
  lockAction: LockAction
}>

const otherWorkers = (snapshot: Snapshot): number =>
  allowedWorkers(
    Option.getOrElse(snapshot.maybeRequestedWorkers, () => MAX_OTHER_WORKERS),
    snapshot.load,
    snapshot.cores,
  )

const placeOf = (snapshot: Snapshot): Place =>
  JobClass.match(snapshot.jobClass, {
    Timing: (): Place => ({
      hold: Hold.cases.Solo.make({}),
      workers: otherWorkers(snapshot),
      cost: snapshot.cost,
      lockAction: lockActionOf(snapshot.lock, 'lock'),
    }),
    Cpu: (): Place => {
      const workers = Math.max(1, cpuWorkers(snapshot))
      return {
        hold: Hold.cases.Solo.make({}),
        workers,
        cost: workers,
        lockAction: lockActionOf(snapshot.lock, 'lock'),
      }
    },
    Shared: (): Place =>
      Option.match(freeSlot(snapshot.shared), {
        onNone: (): Place => ({
          hold: Hold.cases.Shared.make({ slot: 1 }),
          workers: otherWorkers(snapshot),
          cost: snapshot.cost,
          lockAction: LockAction.cases.Create.make({}),
        }),
        onSome: ({ slot, lock }): Place => ({
          hold: Hold.cases.Shared.make({ slot }),
          workers: otherWorkers(snapshot),
          cost: snapshot.cost,
          lockAction: lockActionOf(lock, `shared slot ${slot}`),
        }),
      }),
  })

const maybeWorkerNote = (
  snapshot: Snapshot,
  place: Place,
): Option.Option<string> =>
  JobClass.isAnyOf(['Cpu'])(snapshot.jobClass)
    ? Option.some(
        `WORKERS=${place.workers} fits the budget (target ${formatLoad(snapshot.target)}, load ${formatLoad(snapshot.load)}, ${formatLoad(recentCost(snapshot))} just started, cap ${MAX_CPU_WORKERS}).`,
      )
    : Option.none()

const maybeBackfillNote = (snapshot: Snapshot): Option.Option<string> => {
  const passed = backfilledWaiters(snapshot)
  return Array.isReadonlyArrayNonEmpty(passed)
    ? Option.some(
        `Backfill: starting beside the CPU job ahead of ${describeHolders(passed)}, which waits for that job anyway.`,
      )
    : Option.none()
}

export const decide = (snapshot: Snapshot): Decision =>
  Option.match(maybeBudgetRefusal(snapshot), {
    onSome: reason => Decision.cases.Refuse.make({ reason }),
    onNone: () =>
      Option.match(maybeWaitReason(snapshot), {
        onSome: reason => Decision.cases.Wait.make({ reason }),
        onNone: () => {
          const place = placeOf(snapshot)
          return Decision.cases.Run.make({
            ...place,
            notes: Array.getSomes([
              maybeWorkerNote(snapshot, place),
              maybeBackfillNote(snapshot),
              maybeBudgetWarning(snapshot),
            ]),
          })
        },
      }),
  })

export const maybeConflictAfterTaking: {
  (
    self: LockHolder,
    lock: LockState,
    shared: ReadonlyArray<SharedSlot>,
  ): (jobClass: JobClass) => Option.Option<string>
  (
    jobClass: JobClass,
    self: LockHolder,
    lock: LockState,
    shared: ReadonlyArray<SharedSlot>,
  ): Option.Option<string>
} = Function.dual(
  4,
  (
    jobClass: JobClass,
    self: LockHolder,
    lock: LockState,
    shared: ReadonlyArray<SharedSlot>,
  ): Option.Option<string> =>
    JobClass.match(jobClass, {
      Timing: () => {
        const running = Array.filter(
          liveSharedHolders(shared),
          holder => !isSameHolderValue(holder, self),
        )
        return Array.isReadonlyArrayNonEmpty(running)
          ? Option.some(
              `a shared job started at the same time (${describeHolders(running)})`,
            )
          : Option.none()
      },
      Cpu: () => Option.none(),
      Shared: () =>
        LockState.isAnyOf(['Held'])(lock) &&
        !isSameHolderValue(lock.holder, self) &&
        JobClass.isAnyOf(['Timing'])(soloClassOf(lock.holder))
          ? Option.some(
              `a timing job started at the same time (${describeHolder(lock.holder)})`,
            )
          : Option.none(),
    }),
)

export const Handover = Schema.TaggedUnion({
  Keep: {},
  HandOver: { reason: Schema.String },
})
export type Handover = typeof Handover.Type

export const decideHandover: {
  (waiters: ReadonlyArray<LockHolder>): (selfPid: number) => Handover
  (selfPid: number, waiters: ReadonlyArray<LockHolder>): Handover
} = Function.dual(
  2,
  (selfPid: number, waiters: ReadonlyArray<LockHolder>): Handover => {
    const others = Array.filter(waiters, waiter => waiter.pid !== selfPid)
    return Array.isReadonlyArrayNonEmpty(others)
      ? Handover.cases.HandOver.make({
          reason: `${others.length === 1 ? '1 job is' : `${others.length} jobs are`} waiting (${describeHolders(others)})`,
        })
      : Handover.cases.Keep.make({})
  },
)

export const chunkRunsOf: {
  (maybeChunkRuns: Option.Option<number>): (workers: number) => number
  (workers: number, maybeChunkRuns: Option.Option<number>): number
} = Function.dual(
  2,
  (workers: number, maybeChunkRuns: Option.Option<number>): number =>
    Option.getOrElse(maybeChunkRuns, () => {
      const perRound = Math.max(1, Math.floor(workers))
      return Math.ceil(DEFAULT_CHUNK_RUNS / perRound) * perRound
    }),
)

export const nextChunk: {
  (total: number, size: number): (done: number) => readonly [number, number]
  (done: number, total: number, size: number): readonly [number, number]
} = Function.dual(
  3,
  (done: number, total: number, size: number): readonly [number, number] => [
    done,
    size <= 0 ? total : Math.min(total, done + size),
  ],
)

export const testWorkers = (
  snapshot: Pick<
    Snapshot,
    'load' | 'cores' | 'target' | 'now' | 'lock' | 'shared' | 'extraRecent'
  >,
): number =>
  Number.clamp(
    Math.floor(
      headroom({
        ...snapshot,
        pid: 0,
        cwd: '',
        turns: [],
        jobClass: JobClass.cases.Shared.make({}),
        cost: 0,
        maybeRequestedWorkers: Option.none(),
        waiters: [],
        arrivedAt: snapshot.now,
        batchesUsed: 0,
        job: JobKind.cases.Other.make({}),
        budgetPolicy: BudgetPolicy.cases.Enforced.make({}),
      }),
    ),
    {
      minimum: MIN_TEST_WORKERS,
      maximum: Math.max(MIN_TEST_WORKERS, snapshot.cores - 1),
    },
  )

export const shouldReport: {
  (now: number): (maybeLastReportAt: Option.Option<number>) => boolean
  (maybeLastReportAt: Option.Option<number>, now: number): boolean
} = Function.dual(
  2,
  (maybeLastReportAt: Option.Option<number>, now: number): boolean =>
    Option.match(maybeLastReportAt, {
      onNone: () => true,
      onSome: lastReportAt => now - lastReportAt >= REPORT_EVERY_MS,
    }),
)

export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

export const summaryLine = (
  summary: Readonly<{
    exitCode: number
    wallMs: number
    workers: number
    loadBefore: number
    loadAfter: number
  }>,
): string =>
  `exit ${summary.exitCode} after ${formatDuration(summary.wallMs)} with WORKERS=${summary.workers}, load ${formatLoad(summary.loadBefore)} before and ${formatLoad(summary.loadAfter)} after.`
