import {
  Array,
  Function,
  Match,
  Option,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'

import { encodeJson } from '../json'

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

export const jobClassOfName = (name: ClassName): JobClass =>
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
