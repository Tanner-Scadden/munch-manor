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

// NOTE: a row's party is 'Solo' or 'Crew' (an online co-op run). Every
// player in a crew who shares stats sends their own summary, so a co-op
// run is one row per such player, not one per crew.
const winRate = (party: string) => `
  SELECT difficulty,
    count(*) AS runs,
    sum(outcome = 'Victory') AS wins,
    sum(outcome = 'GameOver') AS losses,
    sum(outcome = 'Quit') AS quits
  FROM runs WHERE mode = 'Campaign' AND party = '${party}'
  GROUP BY difficulty ORDER BY difficulty`

const WaveRow = Schema.Struct({
  mode: Schema.String,
  wave: Count,
  deaths: Count,
})

const DEATH_WAVES = `
  SELECT mode, wave, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver' AND party = 'Solo'
  GROUP BY mode, wave ORDER BY mode, wave`

const CrewWaveRow = Schema.Struct({
  mode: Schema.String,
  crew_size: Count,
  wave: Count,
  deaths: Count,
})

const COOP_DEATH_WAVES = `
  SELECT mode, crew_size, wave, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver' AND party = 'Crew'
  GROUP BY mode, crew_size, wave ORDER BY mode, crew_size, wave`

const CrewRow = Schema.Struct({
  crew_size: Count,
  runs: Count,
  wins: Count,
  losses: Count,
  quits: Count,
  kills: Schema.NullOr(Count),
  downs: Schema.NullOr(Count),
  revives: Schema.NullOr(Count),
})

// NOTE: kills, downs, and revives are each player's own seat's, averaged.
const COOP_CREWS = `
  SELECT crew_size,
    count(*) AS runs,
    sum(outcome = 'Victory') AS wins,
    sum(outcome = 'GameOver') AS losses,
    sum(outcome = 'Quit') AS quits,
    avg(seat_kills) AS kills,
    avg(seat_downs) AS downs,
    avg(seat_revives) AS revives
  FROM runs WHERE party = 'Crew'
  GROUP BY crew_size ORDER BY crew_size`

const KillerRow = Schema.Struct({
  killed_by: Schema.String,
  deaths: Count,
})

const DEADLIEST = `
  SELECT killed_by, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver' AND party = 'Solo'
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

const EndRow = Schema.Struct({
  party: Schema.String,
  outcome: Schema.String,
  runs: Count,
})

const ENDS = `
  SELECT party, outcome, count(*) AS runs FROM runs
  WHERE outcome IN ('GameOver', 'Victory') GROUP BY party, outcome`

// FORMATTING

const percent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((100 * part) / whole)}%` : '-'

const average = (value: number | null): string =>
  value === null ? '-' : value.toFixed(1)

type WinRow = typeof WinRow.Type

const winRows = (rows: ReadonlyArray<WinRow>) =>
  Array.map(rows, row => [
    row.difficulty,
    `${row.runs}`,
    `${row.wins}`,
    `${row.losses}`,
    `${row.quits}`,
    percent(row.wins, row.wins + row.losses),
  ])

const WIN_HEADERS = [
  'difficulty',
  'runs',
  'wins',
  'losses',
  'quits',
  'win rate',
]

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

  const [
    wins,
    waves,
    killers,
    medians,
    devices,
    days,
    shares,
    ends,
    crews,
    crewWins,
    crewWaves,
  ] = yield* Effect.all([
    run(winRate('Solo'), WinRow),
    run(DEATH_WAVES, WaveRow),
    run(DEADLIEST, KillerRow),
    run(MEDIAN_LENGTH, MedianRow),
    run(DEVICES, DeviceRow),
    run(RUNS_PER_DAY, DayRow),
    run(SHARES, ShareRow),
    run(ENDS, EndRow),
    run(COOP_CREWS, CrewRow),
    run(winRate('Crew'), WinRow),
    run(COOP_DEATH_WAVES, CrewWaveRow),
  ])
  const endedAs = (party: string, outcome: string): number =>
    Array.reduce(ends, 0, (sum, row) =>
      row.party === party && row.outcome === outcome ? sum + row.runs : sum,
    )
  // NOTE: a co-op end screen's shares are against the co-op runs that
  // ended there, each player's own.
  const runsEndedOn = (screen: string): number =>
    endedAs(
      screen.startsWith('Coop') ? 'Crew' : 'Solo',
      screen.endsWith('Victory') ? 'Victory' : 'GameOver',
    )

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
          'Solo campaign win rate by difficulty (wins out of finished runs)',
          WIN_HEADERS,
          winRows(wins),
        ),
        section(
          'Solo wave of death',
          ['mode', 'wave', 'deaths'],
          Array.map(waves, row => [row.mode, `${row.wave}`, `${row.deaths}`]),
        ),
        section(
          'Solo deadliest kinds (what landed the last bite)',
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
          'Co-op runs by crew size (one row per player; own seat averages)',
          [
            'crew',
            'runs',
            'wins',
            'losses',
            'quits',
            'win rate',
            'kills',
            'downs',
            'revives',
          ],
          Array.map(crews, row => [
            `${row.crew_size}`,
            `${row.runs}`,
            `${row.wins}`,
            `${row.losses}`,
            `${row.quits}`,
            percent(row.wins, row.wins + row.losses),
            average(row.kills),
            average(row.downs),
            average(row.revives),
          ]),
        ),
        section(
          "Co-op campaign win rate by difficulty (the room's)",
          WIN_HEADERS,
          winRows(crewWins),
        ),
        section(
          'Co-op wave of death',
          ['mode', 'crew', 'wave', 'deaths'],
          Array.map(crewWaves, row => [
            row.mode,
            `${row.crew_size}`,
            `${row.wave}`,
            `${row.deaths}`,
          ]),
        ),
        section(
          'Shares by end screen',
          ['screen', 'path', 'shares', 'visits', 'per end'],
          Array.map(shares, row => [
            row.screen,
            row.path,
            `${row.shares}`,
            `${row.visits}`,
            percent(row.shares, runsEndedOn(row.screen)),
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
