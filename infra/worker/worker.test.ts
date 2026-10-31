import * as Array from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import * as FileSystem from 'node:fs'
import * as Path from 'node:path'

import { describe, expect, it } from '@effect/vitest'

import {
  MAX_SUMMARY_BYTES,
  RUN_SUMMARY_VERSION,
  type RunSummary,
  RunSummaryJson,
  SOLO_PARTY,
  type ShareEvent,
  ShareEventJson,
} from '../../src/analytics.ts'
import {
  COOP_DEATH_WAVES,
  COOP_GAMES,
  COOP_PLAYERS,
  COOP_WIN_RATE,
  ENDS,
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

const crewV2SummaryJson = toJson({
  ...crewSummary,
  version: 2,
  party: crewPartyV2,
})

// NOTE: a summary from a build before co-op summaries: no party.
const { party: _party, ...olderFields } = summary
const olderSummaryJson = toJson({ ...olderFields, version: 1 })

const encodeSummary = Schema.encodeSync(RunSummaryJson)

const summaryJson = encodeSummary(summary)

// FAKES

// NOTE: every D1 migration, in the order D1 applies them.
const MIGRATIONS_DIR = Path.resolve(import.meta.dirname, '../migrations')

const MIGRATIONS = Array.map(
  Array.sort(
    Array.filter(FileSystem.readdirSync(MIGRATIONS_DIR), name =>
      name.endsWith('.sql'),
    ),
    Order.String,
  ),
  name => Path.join(MIGRATIONS_DIR, name),
)

const isComment = (line: string): boolean => line.trim().startsWith('--')

const migrationStatements = (sql: string): ReadonlyArray<string> => {
  const code = Array.join(
    Array.filter(sql.split('\n'), line => !isComment(line)),
    '\n',
  )
  return Array.filter(
    Array.map(code.split(';'), statement => statement.trim()),
    statement => statement !== '',
  )
}

// NOTE: D1 is SQLite, so an in-memory SQLite database with the real
// migration stands in for it, through Effect SQL like the Worker's own.
const memoryDatabase = Effect.gen(function* () {
  const sql = yield* memory
  yield* Effect.forEach(
    Array.flatMap(MIGRATIONS, file =>
      migrationStatements(FileSystem.readFileSync(file, 'utf8')),
    ),
    statement => Effect.orDie(sql.unsafe(statement)),
  )
  return sql
})

const countingLimiter = (limit: number): RateLimiter => {
  const counts = new Map<string, number>()
  return {
    limit: async ({ key }) => {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limit }
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
    expect(declaredSize(String(MAX_SUMMARY_BYTES))).toBe('Fits')
    expect(declaredSize(String(MAX_SUMMARY_BYTES + 1))).toBe('TooLarge')
    expect(bodySize('x'.repeat(MAX_SUMMARY_BYTES))).toBe('Fits')
    expect(bodySize('x'.repeat(MAX_SUMMARY_BYTES + 1))).toBe('TooLarge')
    expect(bodySize('é'.repeat(MAX_SUMMARY_BYTES / 2 + 1))).toBe('TooLarge')
  })

  it.effect('a summary decodes, and a broken one does not', () =>
    Effect.gen(function* () {
      expect(yield* decodeSummary(summaryJson)).toEqual(summary)
      const broken = toJson({ ...summary, mode: 'Speedrun' })
      expect(Exit.isFailure(yield* Effect.exit(decodeSummary(broken)))).toBe(
        true,
      )
      expect(Exit.isFailure(yield* Effect.exit(decodeSummary('{')))).toBe(true)
      expect(yield* decodeSummary(encodeSummary(crewSummary))).toEqual(
        crewSummary,
      )
      const crewOfFive = toJson({
        ...crewSummary,
        party: { ...crewSummary.party, size: 5 },
      })
      expect(
        Exit.isFailure(yield* Effect.exit(decodeSummary(crewOfFive))),
      ).toBe(true)
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

  it('a row keeps the cause only for Game Over and stores kills as JSON', () => {
    const at = Date.UTC(2026, 9, 29, 23, 59)
    const row = rowOf(summary, at)
    expect(row.received_day).toBe('2026-10-29')
    expect(row.killed_by).toBe('Runner')
    expect(fromJson(row.kills)).toEqual(summary.kills)
    expect(rowOf({ ...summary, outcome: { _tag: 'Quit' } }, at).killed_by).toBe(
      null,
    )
    expect(utcDay(Date.UTC(2026, 9, 30, 0, 0))).toBe('2026-10-30')
  })
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
      expect(yield* rowCount(setup)).toBe(1)
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
        expect(
          yield* query(
            setup,
            'SELECT summary_version, difficulty, party, crew_size, seat_kills, seat_downs, seat_revives, crew_key FROM runs',
          ),
        ).toEqual([
          {
            summary_version: 3,
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

  it.effect(
    'a version 2 co-op summary from a cached build stores with no crew key',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        expect((yield* post(setup, crewV2SummaryJson)).status).toBe(202)
        expect(
          yield* query(
            setup,
            'SELECT summary_version, party, crew_size, seat_kills, crew_key FROM runs',
          ),
        ).toEqual([
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
      expect(yield* rowCount(setup)).toBe(0)
    }),
  )

  it.effect(
    'a solo summary, and a version 1 one from a cached build, store as solo',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        expect((yield* post(setup, summaryJson)).status).toBe(202)
        expect((yield* post(setup, olderSummaryJson)).status).toBe(202)
        expect(
          yield* query(
            setup,
            'SELECT summary_version, party, crew_size, seat_kills, seat_downs, seat_revives, crew_key FROM runs ORDER BY id',
          ),
        ).toEqual([
          {
            summary_version: 3,
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
      const row = toJson(yield* query(setup, 'SELECT * FROM runs'))
      expect(row).not.toContain('203.0.113.7')
      expect(row).not.toContain('test-salt')
    }),
  )

  it.effect('a broken summary answers 400 and stores nothing', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const response = yield* post(setup, toJson({ ...summary, wave: -3 }))
      expect(response.status).toBe(400)
      expect(yield* rowCount(setup)).toBe(0)
    }),
  )

  it.effect(
    'an oversized body answers 413, by its header or by its bytes',
    () =>
      Effect.gen(function* () {
        const setup = yield* setUp()
        const huge = 'x'.repeat(MAX_SUMMARY_BYTES + 1)
        expect((yield* post(setup, huge)).status).toBe(413)
        expect(
          (yield* post(setup, summaryJson, { 'content-length': '99999' }))
            .status,
        ).toBe(413)
        expect(yield* rowCount(setup)).toBe(0)
      }),
  )

  it.effect('too many runs from one visit answers 429', () =>
    Effect.gen(function* () {
      const setup = yield* setUp(2)
      expect((yield* post(setup, summaryJson)).status).toBe(202)
      expect((yield* post(setup, summaryJson)).status).toBe(202)
      expect((yield* post(setup, summaryJson)).status).toBe(429)
      expect(yield* rowCount(setup)).toBe(2)
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
  screen: 'CoopVictory',
  mode: 'Campaign',
  difficulty: 'Hard',
  path: 'Sheet',
}

const shareJson = Schema.encodeSync(ShareEventJson)(shareEvent)

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
            screen: 'CoopVictory',
            mode: 'Campaign',
            difficulty: 'Hard',
            event_version: 2,
            path: 'Sheet',
          },
        ])
        const stored = toJson(yield* query(setup, 'SELECT * FROM shares'))
        expect(stored).not.toContain('203.0.113.7')
        expect(yield* rowCount(setup)).toBe(0)
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
        expect(
          yield* query(setup, 'SELECT event_version, path FROM shares'),
        ).toEqual([{ event_version: 1, path: 'Link' }])
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
      expect(yield* shareCount(setup)).toBe(0)
    }),
  )

  it.effect('an oversized share answers 413', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      expect(
        (yield* postShare(setup, 'x'.repeat(MAX_SUMMARY_BYTES + 1))).status,
      ).toBe(413)
      expect(yield* shareCount(setup)).toBe(0)
    }),
  )

  it.effect('shares count against the same visit limit as runs', () =>
    Effect.gen(function* () {
      const setup = yield* setUp(2)
      expect((yield* post(setup, summaryJson)).status).toBe(202)
      expect((yield* postShare(setup, shareJson)).status).toBe(202)
      expect((yield* postShare(setup, shareJson)).status).toBe(429)
      expect(yield* shareCount(setup)).toBe(1)
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
      expect(yield* Effect.promise(() => response.json())).toEqual({
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
  Effect.orDie(
    setup.sql`INSERT INTO runs ${setup.sql.insert(rowOf(summary, atMs))}`,
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
           VALUES ('${new Date(atMs).toISOString()}', '${utcDay(atMs)}', 1, '0123456789abcdef', 'test', 'Death', 'Campaign', 'Normal')`,
          ),
        )
      yield* shareAt(now - 91 * DAY_MS)
      yield* shareAt(now - 30 * DAY_MS)
      yield* cleanUp(setup, now)
      expect(yield* query(setup, 'SELECT received_day FROM shares')).toEqual([
        { received_day: '2026-09-29' },
      ])
    }),
  )

  it.effect('a second cleanup on the same day deletes nothing', () =>
    Effect.gen(function* () {
      const setup = yield* setUp()
      const now = Date.UTC(2026, 9, 29, 4, 17)
      yield* insertRowAt(setup, now - 120 * DAY_MS)
      expect(yield* cleanUp(setup, now)).toBe(1)
      expect(yield* cleanUp(setup, now)).toBe(0)
      expect(yield* rowCount(setup)).toBe(0)
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
          crewRowJson('aaaaaaaaaaaaaaaa', { _tag: 'Victory' }, 10, 40),
          crewRowJson('aaaaaaaaaaaaaaaa', { _tag: 'Quit' }, 6, 7),
          crewRowJson(null, BITTEN, 4, 5),
          crewRowJson(null, BITTEN, 4, 15),
        ]
        yield* Effect.forEach(rows, row => post(setup, row))
        expect(yield* rowCount(setup)).toBe(rows.length)
        expect(yield* query(setup, COOP_GAMES)).toEqual([
          { crew_size: 3, runs: 4, wins: 1, losses: 3, quits: 0 },
        ])
        expect(yield* query(setup, COOP_WIN_RATE)).toEqual([
          { difficulty: 'Hard', runs: 4, wins: 1, losses: 3, quits: 0 },
        ])
        expect(yield* query(setup, COOP_DEATH_WAVES)).toEqual([
          { mode: 'Campaign', crew_size: 3, wave: 4, deaths: 2 },
          { mode: 'Campaign', crew_size: 3, wave: 5, deaths: 1 },
        ])
        expect(yield* query(setup, COOP_PLAYERS)).toEqual([
          {
            crew_size: 3,
            players: 7,
            kills: 100 / 7,
            downs: 2,
            revives: 1,
          },
        ])
        expect(yield* query(setup, `${ENDS} ORDER BY party, outcome`)).toEqual([
          { party: 'Crew', outcome: 'GameOver', runs: 3 },
          { party: 'Crew', outcome: 'Victory', runs: 1 },
        ])
      }),
  )
})
