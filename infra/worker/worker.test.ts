import { String } from 'effect'
import * as Array from 'effect/Array'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'

import {
  MAX_SUMMARY_BYTES,
  RUN_SUMMARY_VERSION,
  type RunSummary,
  RunSummaryJson,
  SOLO_PARTY,
  type ShareEvent,
  ShareEventJson,
} from '../../src/platform/analytics.ts'
import {
  COOP_DEATH_WAVES,
  COOP_GAMES,
  COOP_PLAYERS,
  COOP_WIN_RATE,
  ENDS,
  MEDIAN_LENGTH,
  RUNS_PER_DAY,
} from '../../tools/analytics/queries.ts'
import {
  type RateLimiter,
  WorkerEnv,
  deleteExpiredRuns,
  makeHandler,
} from './api.ts'
import {
  RETENTION_DAYS,
  bodySize,
  decideRate,
  declaredSize,
  decodeSummary,
  retentionCutoffDay,
  rowOf,
  utcDay,
} from './rules.ts'
import { fromJson, memory, toJson } from './testing.ts'

const summary: RunSummary = {
  version: RUN_SUMMARY_VERSION,
  visitId: '0123456789abcdef',
  build: 'abc1234',
  mode: 'Campaign',
  difficulty: 'Normal',
  wave: 5,
  outcome: { _tag: 'GameOver', killedBy: 'Runner' },
  runMs: 312_000,
  kills: {
    Shambler: 40,
    Runner: 9,
    Tank: 1,
    Exploder: 3,
    Thrower: 0,
    Crawler: 2,
    Boss: 0,
  },
  heartsLost: 6,
  purchases: 4,
  powerUpsGrabbed: 2,
  trapsPlaced: 1,
  device: 'Touch',
  screenFit: 'Browser',
  frameTime: 'Under17Ms',
  party: SOLO_PARTY,
  modifiers: 0,
  dareItemsFound: 2,
}

// NOTE: a co-op crew as a build before the run key sent it.
const crewPartyV2 = {
  _tag: 'Crew',
  size: 3,
  seatKills: 21,
  seatDowns: 2,
  seatRevives: 1,
} as const

const CREW_KEY = '00ff00ff00ff00ff'

// NOTE: one player's own summary of an online co-op run.
const crewSummary: RunSummary = {
  ...summary,
  difficulty: 'Hard',
  party: { ...crewPartyV2, runKey: CREW_KEY },
}

const { modifiers: _modifiers, ...beforeModifiers } = crewSummary

const crewV2SummaryJson = toJson({
  ...beforeModifiers,
  version: 2,
  party: crewPartyV2,
})

// NOTE: a summary from a build before the run modifiers.
const versionThreeSummaryJson = toJson({ ...beforeModifiers, version: 3 })

// NOTE: a summary from a build before co-op summaries: no party.
const { party: _party, ...olderFields } = summary
const olderSummaryJson = toJson({ ...olderFields, version: 1 })

const encodeSummary = (posted: RunSummary): string =>
  Result.getOrThrow(Schema.encodeResult(RunSummaryJson)(posted))

const summaryJson = encodeSummary(summary)

// FAKES

const isComment = (line: string): boolean =>
  String.startsWith('--')(String.trim(line))

const migrationStatements = (sql: string): ReadonlyArray<string> => {
  const code = Array.join(
    Array.filter(String.split('\n')(sql), line => !isComment(line)),
    '\n',
  )
  return Array.filter(
    Array.map(String.split(';')(code), statement => String.trim(statement)),
    statement => statement !== '',
  )
}

// NOTE: every D1 migration's statements, in the order D1 applies them.
const migrations = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.resolve(import.meta.dirname, '../migrations')
  const names = yield* fs.readDirectory(directory)
  const files = Array.map(
    Array.sort(
      Array.filter(names, name => String.endsWith('.sql')(name)),
      Order.String,
    ),
    name => path.join(directory, name),
  )
  const texts = yield* Effect.forEach(files, file => fs.readFileString(file))
  return Array.flatMap(texts, text => migrationStatements(text))
}).pipe(Effect.orDie)

// NOTE: D1 is SQLite, so an in-memory SQLite database with the real
// migration stands in for it, through Effect SQL like the Worker's own.
const memoryDatabase = Effect.gen(function* () {
  const sql = yield* memory
  const platform = yield* Layer.build(NodeServices.layer)
  const statements = yield* Effect.provideContext(migrations, platform)
  yield* Effect.forEach(statements, statement =>
    Effect.orDie(sql.unsafe(statement)),
  )
  return sql
})

const countingLimiter = (limit: number): RateLimiter => {
  const counts = new Map<string, number>()
  return {
    limit: ({ key }) => {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return Promise.resolve({ success: count <= limit })
    },
  }
}

type Setup = Readonly<{
  sql: SqlClient.SqlClient
  context: Context.Context<WorkerEnv>
}>

const setUp = (visitLimit = 5, addressLimit = 20) =>
  Effect.map(memoryDatabase, (sql): Setup => ({
    sql,
    context: Context.make(WorkerEnv, {
      database: Layer.succeed(SqlClient.SqlClient, sql),
      visitLimiter: countingLimiter(visitLimit),
      addressLimiter: countingLimiter(addressLimit),
      addressSalt: 'test-salt',
    }),
  }))

const { handler } = makeHandler()

// NOTE: the Worker's own fetch handler, a Promise as Cloudflare calls it.
const fetchFrom = (setup: Setup, request: Request) =>
  Effect.promise(() => handler(request, setup.context))

const post = (
  setup: Setup,
  body: string,
  headers: Record<string, string> = {},
  path = '/api/runs',
) =>
  fetchFrom(
    setup,
    new Request(`https://api.test${path}`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'text/plain', ...headers },
    }),
  )

const query = (setup: Setup, statement: string) =>
  Effect.orDie(setup.sql.unsafe<Record<string, unknown>>(statement))

const countOf = (setup: Setup, table: string) =>
  Effect.map(
    query(setup, `SELECT count(*) AS n FROM ${table}`),
    rows => rows[0]?.['n'],
  )

const rowCount = (setup: Setup) => countOf(setup, 'runs')

// RULES

describe('the rules', () => {
  it('the size cap reads the header and then the body', () => {
    expect(declaredSize(undefined)).toBe('Fits')
    expect(declaredSize('not a number')).toBe('Fits')
    expect(declaredSize(globalThis.String(MAX_SUMMARY_BYTES))).toBe('Fits')
    expect(declaredSize(globalThis.String(MAX_SUMMARY_BYTES + 1))).toBe(
      'TooLarge',
    )
    expect(bodySize(String.repeat(MAX_SUMMARY_BYTES)('x'))).toBe('Fits')
    expect(bodySize(String.repeat(MAX_SUMMARY_BYTES + 1)('x'))).toBe('TooLarge')
    expect(bodySize(String.repeat(MAX_SUMMARY_BYTES / 2 + 1)('é'))).toBe(
      'TooLarge',
    )
  })

  it.effect('a summary decodes, and a broken one does not', () =>
    Effect.gen(function* () {
      const value = yield* decodeSummary(summaryJson)
      expect(value).toEqual(summary)
      const broken = toJson({ ...summary, mode: 'Speedrun' })
      const value_1 = yield* Effect.exit(decodeSummary(broken))
      expect(Exit.isFailure(value_1)).toBe(true)
      const value_2 = yield* Effect.exit(decodeSummary('{'))
      expect(Exit.isFailure(value_2)).toBe(true)
      const value_3 = yield* decodeSummary(encodeSummary(crewSummary))
      expect(value_3).toEqual(crewSummary)
      const crewOfFive = toJson({
        ...crewSummary,
        party: { ...crewSummary.party, size: 5 },
      })
      const value_4 = yield* Effect.exit(decodeSummary(crewOfFive))
      expect(Exit.isFailure(value_4)).toBe(true)
    }),
  )

  it('the address limit wins over the visit limit', () => {
    expect(decideRate({ visit: 'Allowed', address: 'Allowed' })).toEqual({
      _tag: 'Allowed',
    })
    expect(decideRate({ visit: 'Limited', address: 'Allowed' })).toEqual({
      _tag: 'Limited',
      by: 'Visit',
    })
    expect(decideRate({ visit: 'Limited', address: 'Limited' })).toEqual({
      _tag: 'Limited',
      by: 'Address',
    })
  })

  it.effect(
    'a row keeps the cause only for Game Over and stores kills as JSON',
    () =>
      Effect.gen(function* () {
        const at = Date.UTC(2026, 9, 29, 23, 59)
        const row = yield* rowOf(summary, at)
        expect(row.received_day).toBe('2026-10-29')
        expect(row.killed_by).toBe('Runner')
        expect(fromJson(row.kills)).toEqual(summary.kills)
        const quit = yield* rowOf({ ...summary, outcome: { _tag: 'Quit' } }, at)
        expect(quit.killed_by).toBe(null)
        expect(utcDay(Date.UTC(2026, 9, 30, 0, 0))).toBe('2026-10-30')
      }),
  )
})

// HANDLER

describe('POST /api/runs', () => {
  it.effect('a valid summary is stored and answers 202', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* post(setup, summaryJson, {
        'cf-connecting-ip': '203.0.113.7',
      })
      expect(response.status).toBe(202)
      const value_5 = yield* rowCount(setup)
      expect(value_5).toBe(1)
      const [stored] = yield* query(
        setup,
        'SELECT visit_id, outcome, killed_by, wave FROM runs',
      )
      expect(stored).toEqual({
        visit_id: summary.visitId,
        outcome: 'GameOver',
        killed_by: 'Runner',
        wave: 5,
      })
    }),
  )

  it.effect(
    "a co-op summary stores the crew's size and the seat's own numbers",
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const response = yield* post(setup, encodeSummary(crewSummary))
        expect(response.status).toBe(202)
        const value_6 = yield* query(
          setup,
          'SELECT summary_version, difficulty, party, crew_size, seat_kills, seat_downs, seat_revives, crew_key FROM runs',
        )
        expect(value_6).toEqual([
          {
            summary_version: 5,
            difficulty: 'Hard',
            party: 'Crew',
            crew_size: 3,
            seat_kills: 21,
            seat_downs: 2,
            seat_revives: 1,
            crew_key: CREW_KEY,
          },
        ])
      }),
  )

  it.effect('the run modifiers that bit are stored as a mask', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* post(
        setup,
        encodeSummary({ ...summary, modifiers: 12 }),
      )
      expect(response.status).toBe(202)
      const value_7 = yield* query(
        setup,
        'SELECT summary_version, modifiers FROM runs',
      )
      expect(value_7).toEqual([{ summary_version: 5, modifiers: 12 }])
    }),
  )

  it.effect(
    'an escape stores its outcome and the things it found, and a version 4 win still goes in',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const escaped = yield* post(
          setup,
          encodeSummary({ ...summary, outcome: { _tag: 'Escaped' } }),
        )
        expect(escaped.status).toBe(202)
        const { dareItemsFound: _found, ...older } = summary
        const won = yield* post(
          setup,
          toJson({ ...older, version: 4, outcome: { _tag: 'Victory' } }),
        )
        expect(won.status).toBe(202)
        const value_7b = yield* query(
          setup,
          'SELECT summary_version, outcome, dare_items_found FROM runs ORDER BY id',
        )
        expect(value_7b).toEqual([
          { summary_version: 5, outcome: 'Escaped', dare_items_found: 2 },
          { summary_version: 4, outcome: 'Victory', dare_items_found: 0 },
        ])
      }),
  )

  it.effect('a mask no modifier has is refused', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* post(
        setup,
        String.replace(
          '"modifiers":12',
          '"modifiers":16',
        )(encodeSummary({ ...summary, modifiers: 12 })),
      )
      expect(response.status).toBe(400)
      const value_8 = yield* rowCount(setup)
      expect(value_8).toBe(0)
    }),
  )

  it.effect('a version 3 summary from a cached build stores no modifiers', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      expect((yield* post(setup, versionThreeSummaryJson)).status).toBe(202)
      const value_9 = yield* query(
        setup,
        'SELECT summary_version, modifiers FROM runs',
      )
      expect(value_9).toEqual([{ summary_version: 3, modifiers: 0 }])
    }),
  )

  it.effect(
    'a version 2 co-op summary from a cached build stores with no crew key',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        expect((yield* post(setup, crewV2SummaryJson)).status).toBe(202)
        const value_10 = yield* query(
          setup,
          'SELECT summary_version, party, crew_size, seat_kills, crew_key FROM runs',
        )
        expect(value_10).toEqual([
          {
            summary_version: 2,
            party: 'Crew',
            crew_size: 3,
            seat_kills: 21,
            crew_key: null,
          },
        ])
      }),
  )

  it.effect('a co-op summary with a malformed crew key is refused', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* post(
        setup,
        toJson({
          ...crewSummary,
          party: { ...crewSummary.party, runKey: 'room-ABCD' },
        }),
      )
      expect(response.status).toBe(400)
      const value_11 = yield* rowCount(setup)
      expect(value_11).toBe(0)
    }),
  )

  it.effect(
    'a solo summary, and a version 1 one from a cached build, store as solo',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        expect((yield* post(setup, summaryJson)).status).toBe(202)
        expect((yield* post(setup, olderSummaryJson)).status).toBe(202)
        const value_12 = yield* query(
          setup,
          'SELECT summary_version, party, crew_size, seat_kills, seat_downs, seat_revives, crew_key FROM runs ORDER BY id',
        )
        expect(value_12).toEqual([
          {
            summary_version: 5,
            party: 'Solo',
            crew_size: 1,
            seat_kills: null,
            seat_downs: null,
            seat_revives: null,
            crew_key: null,
          },
          {
            summary_version: 1,
            party: 'Solo',
            crew_size: 1,
            seat_kills: null,
            seat_downs: null,
            seat_revives: null,
            crew_key: null,
          },
        ])
      }),
  )

  it.effect('no column holds the address or its hash', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      yield* post(setup, summaryJson, { 'cf-connecting-ip': '203.0.113.7' })
      const value_13 = yield* query(setup, 'SELECT * FROM runs')
      const row = toJson(value_13)
      expect(row).not.toContain('203.0.113.7')
      expect(row).not.toContain('test-salt')
    }),
  )

  it.effect('a broken summary answers 400 and stores nothing', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* post(setup, toJson({ ...summary, wave: -3 }))
      expect(response.status).toBe(400)
      const value_14 = yield* rowCount(setup)
      expect(value_14).toBe(0)
    }),
  )

  it.effect(
    'an oversized body answers 413, by its header or by its bytes',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const huge = String.repeat(MAX_SUMMARY_BYTES + 1)('x')
        expect((yield* post(setup, huge)).status).toBe(413)
        expect(
          (yield* post(setup, summaryJson, { 'content-length': '99999' }))
            .status,
        ).toBe(413)
        const value_15 = yield* rowCount(setup)
        expect(value_15).toBe(0)
      }),
  )

  it.effect('too many runs from one visit answers 429', () =>
    Effect.gen(function* () {
      const setup = yield* setUp(2)
      expect((yield* post(setup, summaryJson)).status).toBe(202)
      expect((yield* post(setup, summaryJson)).status).toBe(202)
      expect((yield* post(setup, summaryJson)).status).toBe(429)
      const value_16 = yield* rowCount(setup)
      expect(value_16).toBe(2)
    }),
  )

  it.effect('too many runs from one address answers 429 across visits', () =>
    Effect.gen(function* () {
      const setup = yield* setUp(5, 1)
      const other = encodeSummary({
        ...summary,
        visitId: 'fedcba9876543210',
      })
      const headers = { 'cf-connecting-ip': '198.51.100.2' }
      expect((yield* post(setup, summaryJson, headers)).status).toBe(202)
      expect((yield* post(setup, other, headers)).status).toBe(429)
    }),
  )
})

const shareEvent: ShareEvent = {
  version: 2,
  visitId: summary.visitId,
  build: summary.build,
  screen: 'CoopEscaped',
  mode: 'Campaign',
  difficulty: 'Hard',
  path: 'Sheet',
}

const shareJson = Result.getOrThrow(
  Schema.encodeResult(ShareEventJson)(shareEvent),
)

const postShare = (
  setup: Setup,
  body: string,
  headers: Record<string, string> = {},
) => post(setup, body, headers, '/api/shares')

const shareCount = (setup: Setup) => countOf(setup, 'shares')

describe('POST /api/shares', () => {
  it.effect(
    'a share is stored with its screen, mode, difficulty, and path, and answers 202',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const response = yield* postShare(setup, shareJson, {
          'cf-connecting-ip': '203.0.113.7',
        })
        expect(response.status).toBe(202)
        const rows = yield* query(
          setup,
          'SELECT visit_id, screen, mode, difficulty, event_version, path FROM shares',
        )
        expect(rows).toEqual([
          {
            visit_id: shareEvent.visitId,
            screen: 'CoopEscaped',
            mode: 'Campaign',
            difficulty: 'Hard',
            event_version: 2,
            path: 'Sheet',
          },
        ])
        const value_17 = yield* query(setup, 'SELECT * FROM shares')
        const stored = toJson(value_17)
        expect(stored).not.toContain('203.0.113.7')
        const value_18 = yield* rowCount(setup)
        expect(value_18).toBe(0)
      }),
  )

  it.effect(
    'a version 1 share from a cached build is still taken, as the link',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const { path: _path, ...older } = shareEvent
        const response = yield* postShare(
          setup,
          toJson({ ...older, version: 1 }),
        )
        expect(response.status).toBe(202)
        const value_19 = yield* query(
          setup,
          'SELECT event_version, path FROM shares',
        )
        expect(value_19).toEqual([{ event_version: 1, path: 'Link' }])
      }),
  )

  it.effect(
    'a Victory share from a build before the escape is still taken as it is',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const response = yield* postShare(
          setup,
          toJson({ ...shareEvent, screen: 'CoopVictory' }),
        )
        expect(response.status).toBe(202)
        const rows = yield* query(setup, 'SELECT screen FROM shares')
        expect(rows).toEqual([{ screen: 'CoopVictory' }])
      }),
  )

  it.effect('a broken share answers 400, and a run summary is no share', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      expect(
        (yield* postShare(setup, toJson({ ...shareEvent, screen: 'Lobby' })))
          .status,
      ).toBe(400)
      expect((yield* postShare(setup, summaryJson)).status).toBe(400)
      const value_20 = yield* shareCount(setup)
      expect(value_20).toBe(0)
    }),
  )

  it.effect('an oversized share answers 413', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      expect(
        (yield* postShare(setup, String.repeat(MAX_SUMMARY_BYTES + 1)('x')))
          .status,
      ).toBe(413)
      const value_21 = yield* shareCount(setup)
      expect(value_21).toBe(0)
    }),
  )

  it.effect('shares count against the same visit limit as runs', () =>
    Effect.gen(function* () {
      const setup = yield* setUp(2)
      expect((yield* post(setup, summaryJson)).status).toBe(202)
      expect((yield* postShare(setup, shareJson)).status).toBe(202)
      expect((yield* postShare(setup, shareJson)).status).toBe(429)
      const value_22 = yield* shareCount(setup)
      expect(value_22).toBe(1)
    }),
  )
})

describe('GET /api/health', () => {
  it.effect('answers Ok with the database checked', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* fetchFrom(
        setup,
        new Request('https://api.test/api/health'),
      )
      expect(response.status).toBe(200)
      const value_23 = yield* Effect.promise(() => response.json())
      expect(value_23).toEqual({
        status: 'Ok',
        database: 'Ok',
      })
    }),
  )

  it.effect('an unknown path answers 404', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* fetchFrom(
        setup,
        new Request('https://api.test/api/nothing'),
      )
      expect(response.status).toBe(404)
    }),
  )
})

// RETENTION

const DAY_MS = 24 * 60 * 60 * 1000

const insertRowAt = (setup: Setup, atMs: number) =>
  Effect.flatMap(rowOf(summary, atMs), row =>
    Effect.orDie(setup.sql`INSERT INTO runs ${setup.sql.insert(row)}`),
  )

const cleanUp = (setup: Setup, nowMs: number) =>
  Effect.orDie(
    Effect.provideService(
      deleteExpiredRuns(nowMs),
      SqlClient.SqlClient,
      setup.sql,
    ),
  )

describe('the 90 day retention', () => {
  it('the cutoff is the UTC day 90 days back', () => {
    expect(RETENTION_DAYS).toBe(90)
    expect(retentionCutoffDay(Date.UTC(2026, 9, 29, 4, 17))).toBe('2026-07-31')
    expect(retentionCutoffDay(Date.UTC(2026, 0, 15, 23, 59))).toBe('2025-10-17')
  })

  it.effect(
    'the cleanup deletes rows older than 90 days and keeps the rest',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const now = Date.UTC(2026, 9, 29, 4, 17)
        yield* insertRowAt(setup, now - 200 * DAY_MS)
        yield* insertRowAt(setup, now - 91 * DAY_MS)
        yield* insertRowAt(setup, now - 90 * DAY_MS)
        yield* insertRowAt(setup, now - 30 * DAY_MS)
        yield* insertRowAt(setup, now)
        const deleted = yield* cleanUp(setup, now)
        expect(deleted).toBe(2)
        const days = yield* query(
          setup,
          'SELECT received_day FROM runs ORDER BY received_day',
        )
        expect(days).toEqual([
          { received_day: '2026-07-31' },
          { received_day: '2026-09-29' },
          { received_day: '2026-10-29' },
        ])
      }),
  )

  it.effect('the cleanup deletes shares older than 90 days too', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const now = Date.UTC(2026, 9, 29, 4, 17)
      const shareAt = (atMs: number) =>
        Effect.orDie(
          setup.sql.unsafe(
            `INSERT INTO shares (received_at, received_day, event_version, visit_id, build, screen, mode, difficulty)
           VALUES ('${DateTime.formatIso(DateTime.makeUnsafe(atMs))}', '${utcDay(atMs)}', 1, '0123456789abcdef', 'test', 'Death', 'Campaign', 'Normal')`,
          ),
        )
      yield* shareAt(now - 91 * DAY_MS)
      yield* shareAt(now - 30 * DAY_MS)
      yield* cleanUp(setup, now)
      const value_24 = yield* query(setup, 'SELECT received_day FROM shares')
      expect(value_24).toEqual([{ received_day: '2026-09-29' }])
    }),
  )

  it.effect('a second cleanup on the same day deletes nothing', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const now = Date.UTC(2026, 9, 29, 4, 17)
      yield* insertRowAt(setup, now - 120 * DAY_MS)
      const value_25 = yield* cleanUp(setup, now)
      expect(value_25).toBe(1)
      const value_26 = yield* cleanUp(setup, now)
      expect(value_26).toBe(0)
      const value_27 = yield* rowCount(setup)
      expect(value_27).toBe(0)
    }),
  )
})

// THE REPORT

// NOTE: a co-op game is one row per player who shares, so the report's
// per game tables count one crew_key once (tools/analytics/queries.ts).
const crewRowJson = (
  runKey: string | null,
  outcome: RunSummary['outcome'],
  wave: number,
  seatKills: number,
): string =>
  runKey === null
    ? toJson({
        ...crewSummary,
        version: 2,
        outcome,
        wave,
        party: { ...crewPartyV2, seatKills },
      })
    : encodeSummary({
        ...crewSummary,
        outcome,
        wave,
        party: { ...crewPartyV2, seatKills, runKey },
      })

const BITTEN: RunSummary['outcome'] = { _tag: 'GameOver', killedBy: 'Tank' }

describe("the report's co-op counts", () => {
  it.effect(
    'count a game once by its key, a keyless row as its own, and players by row',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp(20, 20)
        const rows = [
          crewRowJson(CREW_KEY, BITTEN, 5, 10),
          crewRowJson(CREW_KEY, BITTEN, 5, 20),
          crewRowJson(CREW_KEY, { _tag: 'Quit' }, 3, 3),
          crewRowJson('aaaaaaaaaaaaaaaa', { _tag: 'Escaped' }, 10, 40),
          crewRowJson('aaaaaaaaaaaaaaaa', { _tag: 'Quit' }, 6, 7),
          crewRowJson(null, BITTEN, 4, 5),
          crewRowJson(null, BITTEN, 4, 15),
        ]
        yield* Effect.forEach(rows, row => post(setup, row))
        const value_28 = yield* rowCount(setup)
        expect(value_28).toBe(rows.length)
        const value_29 = yield* query(setup, COOP_GAMES)
        expect(value_29).toEqual([
          { crew_size: 3, runs: 4, wins: 1, losses: 3, quits: 0 },
        ])
        const value_30 = yield* query(setup, COOP_WIN_RATE)
        expect(value_30).toEqual([
          { difficulty: 'Hard', runs: 4, wins: 1, losses: 3, quits: 0 },
        ])
        const value_31 = yield* query(setup, COOP_DEATH_WAVES)
        expect(value_31).toEqual([
          { mode: 'Campaign', crew_size: 3, wave: 4, deaths: 2 },
          { mode: 'Campaign', crew_size: 3, wave: 5, deaths: 1 },
        ])
        const value_32 = yield* query(setup, COOP_PLAYERS)
        expect(value_32).toEqual([
          {
            crew_size: 3,
            players: 7,
            kills: 100 / 7,
            downs: 2,
            revives: 1,
          },
        ])
        const value_33 = yield* query(setup, `${ENDS} ORDER BY party, outcome`)
        expect(value_33).toEqual([
          { party: 'Crew', outcome: 'Escaped', runs: 1 },
          { party: 'Crew', outcome: 'GameOver', runs: 3 },
        ])
        const value_34 = yield* query(
          setup,
          `SELECT runs FROM (${RUNS_PER_DAY})`,
        )
        expect(value_34).toEqual([{ runs: 4 }])
        const value_35 = yield* query(
          setup,
          `SELECT mode, runs FROM (${MEDIAN_LENGTH})`,
        )
        expect(value_35).toEqual([{ mode: 'Campaign', runs: 4 }])
      }),
  )
})
