import { Array, Console, Data, Effect, Option, Schema, pipe } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import {
  type CloudflareError,
  accountId,
  apiToken,
  databaseId,
  databaseName,
  query,
} from './cloudflare'

// Prints what real players did, from a stage's analytics D1 database:
//
//   bun tools/analytics/report.ts --stage prod
//   bun tools/analytics/report.ts --stage pr-42

const USAGE = 'Usage: bun tools/analytics/report.ts --stage <prod|pr-N|name>'

class UsageError extends Data.TaggedError('UsageError')<{
  readonly reason: string
}> {}

const stageArgument = (
  args: ReadonlyArray<string>,
): Effect.Effect<string, UsageError> =>
  pipe(
    Array.findFirstIndex(args, arg => arg === '--stage'),
    Option.flatMap(index => Array.get(args, index + 1)),
    Effect.fromOption,
    Effect.mapError(() => new UsageError({ reason: USAGE })),
  )

// QUERIES

const Count = Schema.Number

const WinRow = Schema.Struct({
  difficulty: Schema.String,
  runs: Count,
  wins: Count,
  losses: Count,
  quits: Count,
})

const WIN_RATE = `
  SELECT difficulty,
    count(*) AS runs,
    sum(outcome = 'Victory') AS wins,
    sum(outcome = 'GameOver') AS losses,
    sum(outcome = 'Quit') AS quits
  FROM runs WHERE mode = 'Campaign'
  GROUP BY difficulty ORDER BY difficulty`

const WaveRow = Schema.Struct({
  mode: Schema.String,
  wave: Count,
  deaths: Count,
})

const DEATH_WAVES = `
  SELECT mode, wave, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver'
  GROUP BY mode, wave ORDER BY mode, wave`

const KillerRow = Schema.Struct({
  killed_by: Schema.String,
  deaths: Count,
})

const DEADLIEST = `
  SELECT killed_by, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver'
  GROUP BY killed_by ORDER BY deaths DESC`

const MedianRow = Schema.Struct({
  mode: Schema.String,
  runs: Count,
  median_ms: Schema.NullOr(Count),
})

const MEDIAN_LENGTH = `
  WITH ordered AS (
    SELECT mode, run_ms,
      row_number() OVER (PARTITION BY mode ORDER BY run_ms) AS position,
      count(*) OVER (PARTITION BY mode) AS runs
    FROM runs
  )
  SELECT mode, max(runs) AS runs, avg(run_ms) AS median_ms FROM ordered
  WHERE position IN ((runs + 1) / 2, (runs + 2) / 2)
  GROUP BY mode ORDER BY mode`

const DeviceRow = Schema.Struct({
  device: Schema.String,
  screen_fit: Schema.String,
  runs: Count,
})

const DEVICES = `
  SELECT device, screen_fit, count(*) AS runs FROM runs
  GROUP BY device, screen_fit ORDER BY runs DESC`

const DayRow = Schema.Struct({ received_day: Schema.String, runs: Count })

const RUNS_PER_DAY = `
  SELECT received_day, count(*) AS runs FROM runs
  GROUP BY received_day ORDER BY received_day DESC LIMIT 30`

// NOTE: taps on SHARE by end screen, against the runs that ended
// there, so the share rate reads at a glance.
const ShareRow = Schema.Struct({
  screen: Schema.String,
  path: Schema.String,
  shares: Count,
  visits: Count,
})

const SHARES = `
  SELECT screen, path, count(*) AS shares, count(DISTINCT visit_id) AS visits
  FROM shares GROUP BY screen, path ORDER BY shares DESC`

const EndRow = Schema.Struct({ outcome: Schema.String, runs: Count })

const ENDS = `
  SELECT outcome, count(*) AS runs FROM runs
  WHERE outcome IN ('GameOver', 'Victory') GROUP BY outcome`

// FORMATTING

const percent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((100 * part) / whole)}%` : '-'

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

const duration = (ms: number): string => {
  const seconds = Math.round(ms / MS_PER_SECOND)
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  return `${minutes}:${globalThis.String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}`
}

const table = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string => {
  const widths = Array.map(headers, (header, column) =>
    Math.max(
      header.length,
      ...Array.map(rows, row => (row[column] ?? '').length),
    ),
  )
  const line = (cells: ReadonlyArray<string>): string =>
    Array.join(
      Array.map(cells, (cell, column) => cell.padEnd(widths[column] ?? 0)),
      '  ',
    ).trimEnd()
  return Array.join(
    [
      line(headers),
      line(Array.map(widths, width => '-'.repeat(width))),
      ...Array.map(rows, line),
    ],
    '\n',
  )
}

const section = (
  title: string,
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string =>
  Array.isReadonlyArrayEmpty(rows)
    ? `${title}\n(no runs yet)`
    : `${title}\n${table(headers, rows)}`

// PROGRAM

const program = Effect.gen(function* () {
  const stage = yield* stageArgument(process.argv.slice(2))
  const token = yield* apiToken
  const account = yield* accountId(token)
  const name = databaseName(stage)
  const database = yield* databaseId(token, account, name)
  const run = <S extends Schema.Top>(sql: string, row: S) =>
    query(token, account, database, sql, row)

  const [wins, waves, killers, medians, devices, days, shares, ends] =
    yield* Effect.all([
      run(WIN_RATE, WinRow),
      run(DEATH_WAVES, WaveRow),
      run(DEADLIEST, KillerRow),
      run(MEDIAN_LENGTH, MedianRow),
      run(DEVICES, DeviceRow),
      run(RUNS_PER_DAY, DayRow),
      run(SHARES, ShareRow),
      run(ENDS, EndRow),
    ])
  const endedAs = (outcome: string): number =>
    Array.reduce(ends, 0, (sum, row) =>
      row.outcome === outcome ? sum + row.runs : sum,
    )
  const runsEndedOn = (screen: string): number =>
    screen.endsWith('Victory') ? endedAs('Victory') : endedAs('GameOver')

  const totalRuns = Array.reduce(medians, 0, (sum, { runs }) => sum + runs)
  const totalDeaths = Array.reduce(
    killers,
    0,
    (sum, { deaths }) => sum + deaths,
  )

  yield* Console.log(
    Array.join(
      [
        `Munch Manor analytics: stage ${stage} (D1 ${name}), ${totalRuns} runs`,
        section(
          'Campaign win rate by difficulty (wins out of finished runs)',
          ['difficulty', 'runs', 'wins', 'losses', 'quits', 'win rate'],
          Array.map(wins, row => [
            row.difficulty,
            `${row.runs}`,
            `${row.wins}`,
            `${row.losses}`,
            `${row.quits}`,
            percent(row.wins, row.wins + row.losses),
          ]),
        ),
        section(
          'Wave of death',
          ['mode', 'wave', 'deaths'],
          Array.map(waves, row => [row.mode, `${row.wave}`, `${row.deaths}`]),
        ),
        section(
          'Deadliest kinds (what landed the last bite)',
          ['kind', 'deaths', 'share'],
          Array.map(killers, row => [
            row.killed_by,
            `${row.deaths}`,
            percent(row.deaths, totalDeaths),
          ]),
        ),
        section(
          'Median run length',
          ['mode', 'runs', 'median'],
          Array.map(medians, row => [
            row.mode,
            `${row.runs}`,
            row.median_ms === null ? '-' : duration(row.median_ms),
          ]),
        ),
        section(
          'Devices',
          ['device', 'screen', 'runs', 'share'],
          Array.map(devices, row => [
            row.device,
            row.screen_fit,
            `${row.runs}`,
            percent(row.runs, totalRuns),
          ]),
        ),
        section(
          'Shares by end screen (solo runs only send summaries)',
          ['screen', 'path', 'shares', 'visits', 'per solo end'],
          Array.map(shares, row => [
            row.screen,
            row.path,
            `${row.shares}`,
            `${row.visits}`,
            row.screen.startsWith('Coop')
              ? '-'
              : percent(row.shares, runsEndedOn(row.screen)),
          ]),
        ),
        section(
          'Runs per day (UTC, last 30)',
          ['day', 'runs'],
          Array.map(days, row => [row.received_day, `${row.runs}`]),
        ),
      ],
      '\n\n',
    ),
  )
})

const reportFailure = (error: CloudflareError | UsageError) =>
  Effect.andThen(
    Console.error(
      error._tag === 'UsageError'
        ? error.reason
        : `Cloudflare: ${error.reason}`,
    ),
    Effect.sync(() => {
      process.exitCode = 1
    }),
  )

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTags({
      CloudflareError: reportFailure,
      UsageError: reportFailure,
    }),
    Effect.provide(NodeServices.layer),
  ),
)
