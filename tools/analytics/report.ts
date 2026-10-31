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
import {
  COOP_DEATH_WAVES,
  COOP_GAMES,
  COOP_PLAYERS,
  COOP_WIN_RATE,
  DEADLIEST,
  DEATH_WAVES,
  DEVICES,
  ENDS,
  MEDIAN_LENGTH,
  RUNS_PER_DAY,
  SHARES,
  SOLO_WIN_RATE,
} from './queries'

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

const WaveRow = Schema.Struct({
  mode: Schema.String,
  wave: Count,
  deaths: Count,
})

const CrewWaveRow = Schema.Struct({
  mode: Schema.String,
  crew_size: Count,
  wave: Count,
  deaths: Count,
})

// NOTE: per game: a co-op game is one crew_key (tools/analytics/queries.ts).
const CrewRow = Schema.Struct({
  crew_size: Count,
  runs: Count,
  wins: Count,
  losses: Count,
  quits: Count,
})

// NOTE: per player: each row is one player's own seat.
const CrewPlayerRow = Schema.Struct({
  crew_size: Count,
  players: Count,
  kills: Schema.NullOr(Count),
  downs: Schema.NullOr(Count),
  revives: Schema.NullOr(Count),
})

const KillerRow = Schema.Struct({
  killed_by: Schema.String,
  deaths: Count,
})

const MedianRow = Schema.Struct({
  mode: Schema.String,
  runs: Count,
  median_ms: Schema.NullOr(Count),
})

const DeviceRow = Schema.Struct({
  device: Schema.String,
  screen_fit: Schema.String,
  runs: Count,
})

const DayRow = Schema.Struct({ received_day: Schema.String, runs: Count })

const ShareRow = Schema.Struct({
  screen: Schema.String,
  path: Schema.String,
  shares: Count,
  visits: Count,
})

const EndRow = Schema.Struct({
  party: Schema.String,
  outcome: Schema.String,
  runs: Count,
})

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
    crewPlayers,
    crewWins,
    crewWaves,
  ] = yield* Effect.all([
    run(SOLO_WIN_RATE, WinRow),
    run(DEATH_WAVES, WaveRow),
    run(DEADLIEST, KillerRow),
    run(MEDIAN_LENGTH, MedianRow),
    run(DEVICES, DeviceRow),
    run(RUNS_PER_DAY, DayRow),
    run(SHARES, ShareRow),
    run(ENDS, EndRow),
    run(COOP_GAMES, CrewRow),
    run(COOP_PLAYERS, CrewPlayerRow),
    run(COOP_WIN_RATE, WinRow),
    run(COOP_DEATH_WAVES, CrewWaveRow),
  ])
  const endedAs = (party: string, outcome: string): number =>
    Array.reduce(ends, 0, (sum, row) =>
      row.party === party && row.outcome === outcome ? sum + row.runs : sum,
    )
  // NOTE: a co-op end screen's shares are against the co-op games that
  // ended there (ENDS counts a crew's game once), so a crew of three that
  // all share reads as 3 per game.
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
        `Munch Manor analytics: stage ${stage} (D1 ${name}), ${totalRuns} summaries (a co-op game sends one per player)`,
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
          'Co-op games by crew size (per game: one per crew_key; a version 2 row with no key counts as its own game)',
          ['crew', 'games', 'wins', 'losses', 'quits', 'win rate'],
          Array.map(crews, row => [
            `${row.crew_size}`,
            `${row.runs}`,
            `${row.wins}`,
            `${row.losses}`,
            `${row.quits}`,
            percent(row.wins, row.wins + row.losses),
          ]),
        ),
        section(
          'Co-op players by crew size (per player: own seat averages)',
          ['crew', 'players', 'kills', 'downs', 'revives'],
          Array.map(crewPlayers, row => [
            `${row.crew_size}`,
            `${row.players}`,
            average(row.kills),
            average(row.downs),
            average(row.revives),
          ]),
        ),
        section(
          "Co-op campaign win rate by difficulty (per game, the room's difficulty)",
          WIN_HEADERS,
          winRows(crewWins),
        ),
        section(
          'Co-op wave of death (per game: the furthest wave any player saw)',
          ['mode', 'crew', 'wave', 'deaths'],
          Array.map(crewWaves, row => [
            row.mode,
            `${row.crew_size}`,
            `${row.wave}`,
            `${row.deaths}`,
          ]),
        ),
        section(
          'Shares by end screen (per end: solo runs, co-op games)',
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
