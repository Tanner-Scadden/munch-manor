// The nightly balance suite. Run it through the heavy guard, never
// directly: `bun run balance:nightly`. It plays every campaign bot, endless,
// the portrait campaign bots, and the wave snapshot pass for every wave, one
// job after another with the guard's WORKERS, holds the results to the
// targets and the stored baseline, and writes
// tools/balance/reports/<YYYY-MM-DD>.md. `--update-baseline` rewrites
// tools/balance/baseline.json, which is also written when it is missing.
// Each job yields the guard's turn between its chunks, and the suite
// yields between jobs, so other agents' jobs go in between.
// `--extend-baseline` adds only the metrics the baseline lacks. `--runs n`
// and `--wave-runs n` shrink the jobs for a quick try.

import {
  Array,
  Clock,
  Config,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Ref,
  Runtime,
  Schema,
  String,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { yieldTurn } from '../heavy/turn'
import { balanceModel } from './model'
import {
  Baseline,
  BaselineJson,
  type BaselineState,
  type BaselineWrite,
  type CampaignResult,
  type Job,
  type Metric,
  baselineOf,
  campaignMetrics,
  extendBaseline,
  formatReport,
  localDate,
  modelMetrics,
  nightlyJobs,
  parseInvocation,
  wavePassMetrics,
} from './suite'
import { Summary, type WavePassSummary } from './summary'

class JobFailed extends Schema.TaggedError<
  JobFailed,
  { readonly brand: unique symbol }
>()('JobFailed', {
  job: Schema.String,
  reason: Schema.String,
}) {}

class BadSummary extends Schema.TaggedError<
  BadSummary,
  { readonly brand: unique symbol }
>()('BadSummary', {
  job: Schema.String,
  reason: Schema.String,
}) {}

// NOTE: a failed job prints why before the suite fails, so the runtime
// reports nothing more and the exit code is 1.
class NightlyExit extends Schema.TaggedError<
  NightlyExit,
  { readonly brand: unique symbol }
>()('NightlyExit', {
  code: Schema.Finite,
}) {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }
  override readonly [Runtime.errorReported] = false
}

const failWith = (message: string): Effect.Effect<never, NightlyExit> =>
  Console.error(`nightly: ${message}`).pipe(
    Effect.andThen(Effect.fail(NightlyExit.make({ code: 1 }))),
  )

// JOBS

const SIMULATE = 'tools/balance/simulate.ts'
const REPORTS = 'tools/balance/reports'
const BASELINE = 'tools/balance/baseline.json'

const SummaryJson = Schema.fromJsonString(Summary)

const runJob = (
  job: Job,
  outPath: string,
  maybeWorkers: Option.Option<number>,
): Effect.Effect<
  Summary,
  JobFailed | BadSummary | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem
    yield* Console.log(`\nnightly: ${job.title}`)
    const exitCode = yield* spawner
      .exitCode(
        ChildProcess.make(
          process.execPath,
          [SIMULATE, ...job.args, '--json', outPath],
          {
            env: Option.match(maybeWorkers, {
              onNone: () => job.env,
              onSome: workers => ({ ...job.env, WORKERS: `${workers}` }),
            }),
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
          JobFailed.make({ job: job.id, reason: cause.message }),
        ),
      )
    if (exitCode !== 0) {
      return yield* JobFailed.make({
        job: job.id,
        reason: `simulate.ts exited with ${exitCode}`,
      })
    }
    const text = yield* fs.readFileString(outPath)
    return yield* Schema.decodeEffect(SummaryJson)(text).pipe(
      Effect.mapError(error =>
        BadSummary.make({ job: job.id, reason: error.message }),
      ),
    )
  })

const readBaseline: Effect.Effect<
  BaselineState,
  BadSummary,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const maybeText = yield* fs.readFileString(BASELINE).pipe(
    Effect.asSome,
    Effect.orElseSucceed(() => Option.none<string>()),
  )
  return yield* Option.match(maybeText, {
    onNone: () => Effect.succeed<BaselineState>({ _tag: 'Absent' }),
    onSome: text =>
      Schema.decodeEffect(BaselineJson)(text).pipe(
        Effect.mapBoth({
          onSuccess: (baseline): BaselineState => ({
            _tag: 'Compared',
            baseline,
          }),
          onFailure: error =>
            BadSummary.make({ job: 'baseline', reason: error.message }),
        }),
      ),
  })
})

const gitCommit: Effect.Effect<
  string,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* spawner
    .string(ChildProcess.make('git', ['rev-parse', '--short', 'HEAD']))
    .pipe(
      Effect.map(String.trim),
      Effect.orElseSucceed(() => 'unknown'),
    )
})

type Played = Readonly<{
  campaigns: ReadonlyArray<CampaignResult>
  maybeWavePass: Option.Option<WavePassSummary>
}>

const collect = (
  jobs: ReadonlyArray<Job>,
  summaries: ReadonlyArray<Summary>,
): Played =>
  Array.reduce(
    Array.zip(jobs, summaries),
    { campaigns: [], maybeWavePass: Option.none() } satisfies Played,
    (played: Played, [job, summary]): Played =>
      summary._tag === 'Campaign'
        ? {
            ...played,
            campaigns: Array.append(played.campaigns, { job, summary }),
          }
        : { ...played, maybeWavePass: Option.some(summary) },
  )

const metricsOf = (
  played: Played,
  model: ReturnType<typeof balanceModel>,
): ReadonlyArray<Metric> => [
  ...Array.flatMap(played.campaigns, ({ job, summary }) =>
    campaignMetrics(job.id, job.title, summary),
  ),
  ...Option.match(played.maybeWavePass, {
    onNone: () => [],
    onSome: wavePassMetrics,
  }),
  ...modelMetrics(model),
]

const program = Effect.gen(function* () {
  const invocation = parseInvocation(Array.drop(process.argv, 2))
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const workers = yield* Config.String('WORKERS').pipe(Config.withDefault('1'))
  const startedAt = yield* Clock.currentTimeMillis
  const date = localDate(startedAt)
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'nightly-' })
  const jobs = nightlyJobs(invocation.sizes)
  // NOTE: between jobs the suite yields the guard's turn, and runs the next
  // job with the WORKERS the guard granted.
  const grantedWorkers = yield* Ref.make(Option.none<number>())
  const summaries = yield* Effect.forEach(jobs, (job, index) =>
    Effect.gen(function* () {
      if (index > 0) {
        const maybeGranted = yield* yieldTurn(`the job before ${job.id}`)
        if (Option.isSome(maybeGranted)) {
          yield* Ref.set(grantedWorkers, maybeGranted)
        }
      }
      const maybeWorkers = yield* Ref.get(grantedWorkers)
      return yield* runJob(
        job,
        path.join(scratch, `${job.id}.json`),
        maybeWorkers,
      )
    }),
  )
  const played = collect(jobs, summaries)
  const model = balanceModel()
  const metrics = metricsOf(played, model)
  const baselineState = yield* readBaseline
  const commit = yield* gitCommit
  const baselineWrite: BaselineWrite =
    invocation.baselinePolicy === 'Update' || baselineState._tag === 'Absent'
      ? 'Written'
      : invocation.baselinePolicy === 'Extend'
        ? 'Extended'
        : 'Kept'
  const endedAt = yield* Clock.currentTimeMillis
  const report = formatReport({
    date,
    commit,
    wallSeconds: (endedAt - startedAt) / 1000,
    workers,
    campaigns: played.campaigns,
    maybeWavePass: played.maybeWavePass,
    model,
    metrics,
    baselineState,
    baselineWrite,
  })
  yield* fs.makeDirectory(REPORTS, { recursive: true })
  const reportPath = path.join(REPORTS, `${date}.md`)
  yield* fs.writeFileString(reportPath, report)
  if (baselineWrite !== 'Kept') {
    const next =
      baselineWrite === 'Extended' && baselineState._tag === 'Compared'
        ? extendBaseline(baselineState.baseline, metrics)
        : baselineOf(metrics, date, commit)
    const encoded = yield* Schema.encodeEffect(
      Schema.fromJsonString(Baseline, { space: 2 }),
    )(next).pipe(
      Effect.mapError(error =>
        BadSummary.make({ job: 'baseline', reason: error.message }),
      ),
    )
    yield* fs.writeFileString(BASELINE, `${encoded}\n`)
    yield* Console.log(`nightly: wrote the baseline to ${BASELINE}`)
  }
  yield* Console.log(`\nnightly: report written to ${reportPath}`)
}).pipe(
  Effect.scoped,
  Effect.catchTags({
    JobFailed: ({ job, reason }) =>
      failWith(`the ${job} job failed: ${reason}`),
    BadSummary: ({ job, reason }) =>
      failWith(`could not read the ${job} summary: ${reason}`),
  }),
)

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
