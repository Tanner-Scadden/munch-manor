import { Array, Function, Option, Schema, String, pipe } from 'effect'

import { JobClass } from './records'

// JOB

const DEFAULT_PARALLEL = 3

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

// NOTE: the balance bot and the determinism checks are not timed, but they
// keep cores busy for minutes, so they size themselves to the budget.
const CPU_SCRIPTS: ReadonlyArray<RegExp> = [
  /(?:^|\/)balance\/(?:simulate|nightly)\.ts$/,
  /(?:^|\/)determinism\/(?:crossEngine|beforeAfter)\.ts$/,
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
