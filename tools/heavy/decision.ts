import {
  Array,
  Function,
  Match,
  Number,
  Option,
  Order,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'

import { encodeJson } from '../json'

export const BUDGET_WARN_AT = 3
export const BUDGET_REFUSE_AT = 6
export const REPORT_EVERY_MS = 30_000

// NOTE: the guard aims to keep the 1 minute load near 70% of the cores.
const TARGET_SHARE = 0.7
// NOTE: the load average lags, so a job started in the last minute counts
// at its estimated cost on top of the load.
const RECENT_MS = 60_000
const MAX_SHARED_JOBS = 4
export const MAX_CPU_WORKERS = 8
const MIN_TEST_WORKERS = 2
// NOTE: the cap for the WORKERS a Timing or Shared job is given. Neither
// uses it much; only CPU jobs size it to the budget.
export const MAX_OTHER_WORKERS = 4
const DEFAULT_PARALLEL = 3

// NOTE: a hold of the solo lock is a lease. A job past it is not stopped,
// but its guard says so loudly, and every waiting job names it.
export const DEFAULT_LEASE_MS = 10 * 60_000
export const LEASE_REMIND_MS = 5 * 60_000
// NOTE: a worktree whose job held a file this recently goes behind waiting
// jobs from other worktrees, so turns go round by worktree.
export const RECENT_TURN_MS = 5 * 60_000
// NOTE: a chunked CPU job plays about this many runs a turn, rounded up to
// a whole number of rounds of its workers. A campaign run takes about 3.5 s
// of one worker, so a chunk is well under 2 minutes even with 1 worker.
export const DEFAULT_CHUNK_RUNS = 25
// NOTE: how long a later Shared job may start ahead of an earlier Timing or
// CPU waiter that a running CPU job holds up anyway (backfill). After this
// the waiter is due at the CPU job's next chunk boundary, so no more Shared
// jobs pass it, and only the ones already running stand in its way.
export const BACKFILL_GRACE_MS = 2 * 60_000

// JOB CLASS

// NOTE: Timing jobs run alone, since load skews their numbers. A CPU job,
// such as the balance bot, runs beside Shared jobs when the budget allows,
// one at a time. Shared jobs, such as screenshot and tap audits, run up to
// MAX_SHARED_JOBS at once within the budget.
export const JobClass = Schema.TaggedUnion({
  Timing: {},
  Cpu: {},
  Shared: {},
})
export type JobClass = typeof JobClass.Type

const ClassName = Schema.Literals(['Timing', 'Cpu', 'Shared'])
type ClassName = typeof ClassName.Type

const jobClassOfName = (name: ClassName): JobClass =>
  Match.value(name).pipe(
    Match.when('Timing', () => JobClass.cases.Timing.make({})),
    Match.when('Cpu', () => JobClass.cases.Cpu.make({})),
    Match.when('Shared', () => JobClass.cases.Shared.make({})),
    Match.exhaustive,
  )

// LOCK

// NOTE: `jobClass` and `cost` are new. A file without them was written by
// an older guard: in the solo lock it counts as Timing, and in a slot its
// cost is estimated from its command.
export const LockHolder = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  command: Schema.String,
  cwd: Schema.String,
  startedAt: Schema.Finite,
  jobClass: Schema.optionalKey(ClassName),
  cost: Schema.optionalKey(Schema.Finite),
  leaseMs: Schema.optionalKey(Schema.Finite),
  // NOTE: when the lease last began: the start, or the last boundary where
  // a chunked job offered to yield and nobody was waiting.
  leaseFrom: Schema.optionalKey(Schema.Finite),
})
export type LockHolder = typeof LockHolder.Type

const LockHolderJson = Schema.fromJsonString(LockHolder)

export const decodeLockHolder = (text: string): Option.Option<LockHolder> =>
  Schema.decodeOption(LockHolderJson)(text)

export const encodeLockHolder = (holder: LockHolder): string =>
  `${encodeJson(LockHolder)(holder)}\n`

export const LockState = Schema.TaggedUnion({
  Free: {},
  Held: { holder: LockHolder },
  Stale: { holder: LockHolder },
  Unreadable: { text: Schema.String },
})
export type LockState = typeof LockState.Type

export const classifyLock: {
  (
    isAlive: (pid: number) => boolean,
  ): (maybeText: Option.Option<string>) => LockState
  (
    maybeText: Option.Option<string>,
    isAlive: (pid: number) => boolean,
  ): LockState
} = Function.dual(
  2,
  (
    maybeText: Option.Option<string>,
    isAlive: (pid: number) => boolean,
  ): LockState =>
    Option.match(maybeText, {
      onNone: () => LockState.cases.Free.make({}),
      onSome: text =>
        Option.match(decodeLockHolder(text), {
          onNone: () => LockState.cases.Unreadable.make({ text }),
          onSome: holder =>
            isAlive(holder.pid)
              ? LockState.cases.Held.make({ holder })
              : LockState.cases.Stale.make({ holder }),
        }),
    }),
)

export const isSameHolderValue: {
  (holder: LockHolder): (current: LockHolder) => boolean
  (current: LockHolder, holder: LockHolder): boolean
} = Function.dual(
  2,
  (current: LockHolder, holder: LockHolder): boolean =>
    current.pid === holder.pid && current.startedAt === holder.startedAt,
)

export const isSameHolder: {
  (holder: LockHolder): (maybeText: Option.Option<string>) => boolean
  (maybeText: Option.Option<string>, holder: LockHolder): boolean
} = Function.dual(
  2,
  (maybeText: Option.Option<string>, holder: LockHolder): boolean =>
    pipe(
      maybeText,
      Option.flatMap(decodeLockHolder),
      Option.exists(current => isSameHolderValue(current, holder)),
    ),
)

// TURNS

// NOTE: when a worktree's job last let go of a file. One file a worktree,
// named by `turnFileKey`, so two worktrees never write the same file.
export const HeldTurn = Schema.Struct({
  cwd: Schema.String,
  at: Schema.Finite,
})
export type HeldTurn = typeof HeldTurn.Type

const HeldTurnJson = Schema.fromJsonString(HeldTurn)

export const decodeHeldTurn = (text: string): Option.Option<HeldTurn> =>
  Schema.decodeOption(HeldTurnJson)(text)

export const encodeHeldTurn = (turn: HeldTurn): string =>
  `${encodeJson(HeldTurn)(turn)}\n`

// NOTE: FNV-1a over the path, so the file name is short and safe.
export const turnFileKey = (cwd: string): string =>
  pipe(
    Array.fromIterable(cwd),
    Array.reduce(0x811c9dc5, (hash, character) =>
      Math.imul(
        hash ^ Option.getOrElse(String.codePointAt(0)(character), () => 0),
        0x01000193,
      ),
    ),
    hash => String.padStart(8, '0')((hash >>> 0).toString(16)),
  )

// BUDGET LEDGER

export const Ledger = Schema.Record(
  Schema.String,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
)
export type Ledger = typeof Ledger.Type

const LedgerJson = Schema.fromJsonString(Ledger)

export const decodeLedger = (text: string): Ledger =>
  pipe(
    Schema.decodeOption(LedgerJson)(text),
    Option.getOrElse(() => ({})),
  )

export const encodeLedger = (ledger: Ledger): string =>
  `${encodeJson(Ledger, 2)(ledger)}\n`

export const budgetKey: {
  (branch: string): (repoRoot: string) => string
  (repoRoot: string, branch: string): string
} = Function.dual(
  2,
  (repoRoot: string, branch: string): string => `${repoRoot}#${branch}`,
)

export const batchesUsed: {
  (key: string): (ledger: Ledger) => number
  (ledger: Ledger, key: string): number
} = Function.dual(2, (ledger: Ledger, key: string): number =>
  pipe(
    Record.get(ledger, key),
    Option.getOrElse(() => 0),
  ),
)

export const recordBatch: {
  (key: string): (ledger: Ledger) => Ledger
  (ledger: Ledger, key: string): Ledger
} = Function.dual(2, (ledger: Ledger, key: string): Ledger =>
  Record.set(ledger, key, batchesUsed(ledger, key) + 1),
)

export const resetBudget: {
  (key: string): (ledger: Ledger) => Ledger
  (ledger: Ledger, key: string): Ledger
} = Function.dual(2, (ledger: Ledger, key: string): Ledger =>
  Record.remove(ledger, key),
)

// INVOCATION

export const BudgetPolicy = Schema.TaggedUnion({
  Enforced: {},
  AllowMore: {},
})
export type BudgetPolicy = typeof BudgetPolicy.Type

export const Invocation = Schema.TaggedUnion({
  RunCommand: {
    command: Schema.NonEmptyArray(Schema.String),
    budgetPolicy: BudgetPolicy,
    maybeClassOverride: Schema.Option(JobClass),
  },
  ResetBudget: {},
  ShowUsage: { problem: Schema.String },
})
export type Invocation = typeof Invocation.Type

const SEPARATOR = '--'
const ALLOW_MORE = '--allow-more'
const RESET_BUDGET = '--reset-budget'
const CLASS_FLAGS: ReadonlyArray<readonly [string, JobClass]> = [
  ['--timing', JobClass.cases.Timing.make({})],
  // NOTE: kept from the two class guard, where Exclusive meant alone.
  ['--exclusive', JobClass.cases.Timing.make({})],
  ['--cpu', JobClass.cases.Cpu.make({})],
  ['--shared', JobClass.cases.Shared.make({})],
]
const KNOWN_FLAGS: ReadonlyArray<string> = [
  SEPARATOR,
  ALLOW_MORE,
  RESET_BUDGET,
  ...Array.map(CLASS_FLAGS, ([flag]) => flag),
]

export const USAGE =
  'Usage: bun run heavy -- [--allow-more] [--timing | --cpu | --shared] <command...>, or bun run heavy -- --reset-budget'

export const parseArguments = (args: ReadonlyArray<string>): Invocation => {
  const [flags, command] = Array.span(args, String.startsWith('--'))
  const unknownFlags = Array.filter(
    flags,
    flag => !Array.contains(KNOWN_FLAGS, flag),
  )
  if (Array.isArrayNonEmpty(unknownFlags)) {
    return Invocation.cases.ShowUsage.make({
      problem: `Unknown flag ${Array.join(unknownFlags, ', ')}.`,
    })
  }
  if (Array.contains(flags, RESET_BUDGET)) {
    return Invocation.cases.ResetBudget.make({})
  }
  const classes = Array.filter(CLASS_FLAGS, ([flag]) =>
    Array.contains(flags, flag),
  )
  if (classes.length > 1) {
    return Invocation.cases.ShowUsage.make({
      problem: 'Pass at most one of --timing, --cpu, and --shared.',
    })
  }
  return Array.match(command, {
    onEmpty: () =>
      Invocation.cases.ShowUsage.make({ problem: 'No command to run.' }),
    onNonEmpty: nonEmptyCommand =>
      Invocation.cases.RunCommand.make({
        command: nonEmptyCommand,
        budgetPolicy: Array.contains(flags, ALLOW_MORE)
          ? BudgetPolicy.cases.AllowMore.make({})
          : BudgetPolicy.cases.Enforced.make({}),
        maybeClassOverride: pipe(
          Array.head(classes),
          Option.map(([, jobClass]) => jobClass),
        ),
      }),
  })
}

// JOB

export const JobKind = Schema.TaggedUnion({
  Balance: {},
  Other: {},
})
export type JobKind = typeof JobKind.Type

export const jobKindOf = (command: ReadonlyArray<string>): JobKind =>
  Array.some(command, String.endsWith('balance/simulate.ts'))
    ? JobKind.cases.Balance.make({})
    : JobKind.cases.Other.make({})

// NOTE: a script counts by its name alone (`taps.ts`, `./taps.ts`) or under
// an `audit/` folder (`tools/audit/taps.ts`), so `src/platform/save.ts` is not the
// save audit.
const auditScript = (names: string): RegExp =>
  new RegExp(`^(?:(?:.*/)?audit/|\\./)?(?:${names})\\.ts$`)

const TIMING_SCRIPTS: ReadonlyArray<RegExp> = [
  auditScript('perf|perf-check|profile|measure|splash'),
]

// NOTE: the balance bot, the determinism checks, and a recorded run's replay
// are not timed, but they keep cores busy for minutes, so they size
// themselves to the budget.
const CPU_SCRIPTS: ReadonlyArray<RegExp> = [
  /(?:^|\/)balance\/(?:simulate|nightly)\.ts$/,
  /(?:^|\/)determinism\/(?:crossEngine|beforeAfter)\.ts$/,
  /(?:^|\/)learn\/replay\.ts$/,
]

const SHARED_SCRIPTS: ReadonlyArray<RegExp> = [
  auditScript(
    'shots\\d+|taps|twoThumbs|closes|profileClicks|offline|sqlite|sync|save|live-check|icons|og|beacon-check|mp',
  ),
]

// NOTE: these scripts drive several browser contexts at once, set by their
// own variable, and each context costs about this many cores. shots33 shoots
// full HD desktop screens, which measured near two cores a context: with a
// cost of one it pushed the load to 16 against a target of 8.4.
const PARALLEL_SCRIPTS: ReadonlyArray<readonly [RegExp, string, number]> = [
  [auditScript('taps'), 'TAPS_PARALLEL', 1],
  [auditScript('closes'), 'CLOSES_PARALLEL', 1],
  [auditScript('profileClicks'), 'PROFILE_PARALLEL', 1],
  [auditScript('shots33'), 'SHOTS_PARALLEL', 2],
  [auditScript('shots34'), 'SHOTS_PARALLEL', 1],
]

// NOTE: the environment variables a Shared script's cost reads.
export const PARALLEL_ENV_KEYS: ReadonlyArray<string> = Array.dedupe(
  Array.map(PARALLEL_SCRIPTS, ([, key]) => key),
)

// NOTE: the command is split into words, so a script inside `sh -c "..."`
// is still found.
const commandWords = (command: ReadonlyArray<string>): ReadonlyArray<string> =>
  pipe(
    command,
    Array.flatMap(part => String.split(/[\s;&|()'"]+/)(part)),
    Array.filter(String.isNonEmpty),
  )

const mentionsAny = (
  words: ReadonlyArray<string>,
  patterns: ReadonlyArray<RegExp>,
): boolean =>
  Array.some(words, word => Array.some(patterns, pattern => pattern.test(word)))

// NOTE: the most careful class a command names wins, and a command the
// guard does not know is Timing, so a new heavy script runs alone until it
// is listed.
export const jobClassOf: {
  (
    maybeOverride: Option.Option<JobClass>,
  ): (command: ReadonlyArray<string>) => JobClass
  (
    command: ReadonlyArray<string>,
    maybeOverride: Option.Option<JobClass>,
  ): JobClass
} = Function.dual(
  2,
  (
    command: ReadonlyArray<string>,
    maybeOverride: Option.Option<JobClass>,
  ): JobClass =>
    Option.getOrElse(maybeOverride, () => {
      const words = commandWords(command)
      if (mentionsAny(words, TIMING_SCRIPTS)) {
        return JobClass.cases.Timing.make({})
      }
      if (mentionsAny(words, CPU_SCRIPTS)) {
        return JobClass.cases.Cpu.make({})
      }
      return mentionsAny(words, SHARED_SCRIPTS)
        ? JobClass.cases.Shared.make({})
        : JobClass.cases.Timing.make({})
    }),
)

const parallelOf = (maybeValue: Option.Option<string>): number => {
  const value = globalThis.Number(
    Option.getOrElse(maybeValue, () => `${DEFAULT_PARALLEL}`),
  )
  return globalThis.Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

// NOTE: about one core per browser context. A Shared script that drives
// one page costs 1, and taps.ts with TAPS_PARALLEL=3 costs 3.
export const sharedCostOf: {
  (
    env: (key: string) => Option.Option<string>,
  ): (command: ReadonlyArray<string>) => number
  (
    command: ReadonlyArray<string>,
    env: (key: string) => Option.Option<string>,
  ): number
} = Function.dual(
  2,
  (
    command: ReadonlyArray<string>,
    env: (key: string) => Option.Option<string>,
  ): number => {
    const words = commandWords(command)
    return pipe(
      Array.findFirst(PARALLEL_SCRIPTS, ([pattern]) =>
        mentionsAny(words, [pattern]),
      ),
      Option.match({
        onNone: () => 1,
        onSome: ([, key, perContext]) => parallelOf(env(key)) * perContext,
      }),
    )
  },
)

// DECISION

// NOTE: one Shared slot file as the guard found it, numbered from 1.
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

// NOTE: which file the job holds while it runs: the solo lock, whose name
// every guard knows and which a Timing or a CPU job holds, or one Shared
// slot.
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

// NOTE: the old cap for jobs that do not size to the budget.
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

// LEASE

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

// NOTE: what the guard holding the solo lock prints once its lease is up,
// and again every LEASE_REMIND_MS while it runs on.
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

// NOTE: a solo lock without a class came from an older guard, which ran
// everything alone, so it counts as Timing.
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

// NOTE: the estimated cost of the jobs that started within the last
// minute, which the 1 minute load does not show yet.
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

// QUEUE ORDER

// NOTE: when the worktree last let go of a file within RECENT_TURN_MS, or
// 0 when it has not.
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

// NOTE: the queue goes round by worktree, then by arrival. A worktree that
// let go of a file in the last RECENT_TURN_MS goes behind waiting jobs from
// worktrees that did not, and of two that did, the one whose turn ended
// first goes first. Within a worktree, or between worktrees with no recent
// turn, the job that arrived first goes first. A chunked job that yields
// arrives again, so it goes behind every job that arrived while it ran.
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

// NOTE: queue fairness by turn and arrival (see isAheadInQueue). A Timing or CPU job that started waiting
// first blocks every later arrival. A Shared job that started waiting first
// blocks later Shared jobs of equal or larger cost and Timing jobs, so a
// small job may slip into a gap a big one cannot use. A later CPU job is
// not blocked by it, but leaves its cost free (see reservedCost).
// NOTE: backfill. A Shared job may start ahead of an earlier Timing or CPU
// waiter while a CPU job holds the solo lock: that waiter cannot start
// before the CPU job lets go, and the Shared job only uses budget left
// beside the CPU job. It stops once the waiter has waited
// BACKFILL_GRACE_MS, and never applies when the waiter waits only for
// Shared jobs to drain, so it cannot starve the waiter.
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

// NOTE: what a CPU job leaves free for Shared jobs that were waiting first:
// the cost of the one at the head of the queue, at most the target. Keeping
// the cost of every one of them free once held back 16 cores' worth on a
// 12 core laptop and starved balance batches. The rest are not delayed long:
// a CPU job yields at each chunk boundary, well within BACKFILL_GRACE_MS,
// and then queues again behind them.
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

// NOTE: a CPU job takes what is left of the budget, after the load, the
// jobs started in the last minute, and the Shared jobs that were waiting
// first. A WORKERS the caller set is a ceiling.
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

// NOTE: a waiting job names a solo holder past its lease, whatever else
// keeps it waiting, and says only how long when the reason named it.
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

// NOTE: the lowest numbered slot not held by a live job. A missing slot file
// is free, and a stale or corrupt one is taken over.
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

// NOTE: two guards can each see the other's file missing and both take
// theirs. Each one looks again after taking its own and backs off when it
// finds a job it must not run beside, so at worst both back off and retry,
// never both run. A CPU job and Shared jobs may run together.
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

// HANDOVER

// NOTE: a job that yields between parts (see turn.ts) asks its guard at
// each boundary. While any other job waits, the guard lets go of its file
// and queues again as a new arrival; otherwise the job keeps its turn and
// goes on at once, so a lone job loses nothing to chunking.
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

// NOTE: the runs a chunk plays: HEAVY_CHUNK_RUNS when set (0 means no
// chunks), or DEFAULT_CHUNK_RUNS rounded up to whole rounds of the workers.
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

// NOTE: the next part of `total` to play after `done`, with `size` runs a
// chunk. A size of 0 or less plays the rest at once.
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

// TEST WORKERS

// NOTE: `bun run test` does not queue. It reads the budget once and runs
// vitest with what is left, at least MIN_TEST_WORKERS and at most one less
// than the cores, vitest's own default.
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
// REPORTING

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
