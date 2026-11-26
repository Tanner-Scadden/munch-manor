import { Array, Effect, Record, Schema } from 'effect'
import { EventGroup, EventLog } from 'effect/eventlog'
import { SqlClient } from 'effect/sql'

const Counts = Schema.Record(Schema.String, Schema.Finite)

export const MasteryEvents = EventGroup.empty.add({
  tag: 'GainedMastery',
  primaryKey: payload => payload.runId,
  payload: Schema.Struct({
    runId: Schema.String,
    heroes: Counts,
    guns: Counts,
  }),
})

export const masterySchema = EventLog.schema(MasteryEvents)

export const createMasteryTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS hero_mastery (hero TEXT PRIMARY KEY, points REAL NOT NULL)`
  yield* sql`CREATE TABLE IF NOT EXISTS kills_by_gun (gun TEXT PRIMARY KEY, kills REAL NOT NULL)`
})

const rowsOf = (counts: Readonly<Record<string, number>>) =>
  Array.filter(Record.toEntries(counts), ([, count]) => count > 0)

export const MasteryHandlers = EventLog.group(MasteryEvents, handlers =>
  handlers.handle('GainedMastery', ({ payload }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* Effect.forEach(
        rowsOf(payload.heroes),
        ([hero, points]) =>
          sql`INSERT INTO hero_mastery (hero, points) VALUES (${hero}, ${points})
            ON CONFLICT (hero) DO UPDATE SET points = points + excluded.points`,
        { discard: true },
      )
      yield* Effect.forEach(
        rowsOf(payload.guns),
        ([gun, kills]) =>
          sql`INSERT INTO kills_by_gun (gun, kills) VALUES (${gun}, ${kills})
            ON CONFLICT (gun) DO UPDATE SET kills = kills + excluded.kills`,
        { discard: true },
      )
    }).pipe(Effect.orDie),
  ),
)

export const readMastery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const heroes = yield* sql<{
    hero: string
    points: number
  }>`SELECT hero, points FROM hero_mastery ORDER BY hero`
  const guns = yield* sql<{
    gun: string
    kills: number
  }>`SELECT gun, kills FROM kills_by_gun ORDER BY gun`
  return {
    heroes: Record.fromEntries(Array.map(heroes, r => [r.hero, r.points])),
    guns: Record.fromEntries(Array.map(guns, r => [r.gun, r.kills])),
  }
})
