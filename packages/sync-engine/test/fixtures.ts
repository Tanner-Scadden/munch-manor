import {
  Array,
  Context,
  Effect,
  Layer,
  Schedule,
  Schema,
  type Scope,
} from 'effect'
import { SqlClient } from 'effect/sql'

import { SqliteClient } from '@munch/sqlite-wasm-effect'
import { makeHub } from '@munch/sqlite-wasm-effect/in-process'

import type { Authenticate } from '../src/Server'
import {
  Actor,
  type LocalDatabase,
  MutationRejected,
  Unauthorized,
  defineMutation,
  defineScope,
} from '../src/index'

// A small scope for the tests: a profile row, a tally per kind, and slots
// that only one player can claim, so the server has something to refuse.

export const Renamed = defineMutation({
  name: 'Renamed',
  version: 1,
  args: Schema.Struct({ name: Schema.String }),
  scopes: ['notes'],
  writer: 'Owner',
  apply: ({ name }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO ${context.table('profile')} (id, name, stamped_ms)
        VALUES (1, ${name}, 0)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name`
    }),
})

const MAX_COUNT = 100

export const Counted = defineMutation({
  name: 'Counted',
  version: 1,
  args: Schema.Struct({ kind: Schema.String, count: Schema.Number }),
  scopes: ['notes'],
  writer: 'Owner',
  apply: ({ kind, count }, context) =>
    Effect.gen(function* () {
      if (count > MAX_COUNT) {
        return yield* new MutationRejected({ reason: 'Too many at once' })
      }
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO ${context.table('tally')} (kind, count)
        VALUES (${kind}, ${count})
        ON CONFLICT (kind) DO UPDATE SET count = count + excluded.count`
    }),
})

export const Claimed = defineMutation({
  name: 'Claimed',
  version: 1,
  args: Schema.Struct({ slot: Schema.String, by: Schema.String }),
  scopes: ['notes'],
  writer: 'Owner',
  apply: ({ slot, by }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const taken =
        yield* sql`SELECT slot FROM ${context.table('slots')} WHERE slot = ${slot}`
      if (Array.isReadonlyArrayNonEmpty(taken)) {
        return yield* new MutationRejected({ reason: `${slot} is taken` })
      }
      yield* sql`INSERT INTO ${context.table('slots')} (slot, by) VALUES (${slot}, ${by})`
    }),
})

export const Stamped = defineMutation({
  name: 'Stamped',
  version: 1,
  args: Schema.Struct({}),
  scopes: ['notes'],
  writer: 'ServerOnly',
  apply: (_, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO ${context.table('profile')} (id, name, stamped_ms)
        VALUES (1, '', ${context.timestampMs})
        ON CONFLICT (id) DO UPDATE SET stamped_ms = excluded.stamped_ms`
    }),
})

export const Notes = defineScope({
  kind: 'notes',
  tables: ['profile', 'tally', 'slots'],
  readers: 'Owner',
  replica: 'ReadWrite',
  mutations: [Renamed, Counted, Claimed, Stamped],
  migrations: {
    '0001_create': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE ${sql(table('profile'))} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          name TEXT NOT NULL,
          stamped_ms INTEGER NOT NULL
        )`
        yield* sql`CREATE TABLE ${sql(table('tally'))} (
          kind TEXT PRIMARY KEY,
          count INTEGER NOT NULL
        )`
        yield* sql`CREATE TABLE ${sql(table('slots'))} (
          slot TEXT PRIMARY KEY,
          by TEXT NOT NULL
        )`
      }),
  },
})

export const PLAYER = 'ada'
export const SCOPE = `notes:${PLAYER}`

// NOTE: the tests' tokens are `<deviceId>:<playerId>`; real hosts verify a
// signed token instead.
export const authenticate: Authenticate = token => {
  const [deviceId, playerId] = token.split(':')
  return deviceId !== undefined && playerId !== undefined
    ? Effect.succeed(Actor.cases.Device.make({ deviceId, playerId }))
    : Effect.fail(new Unauthorized({ reason: 'Bad token' }))
}

export const openServerDatabase: Effect.Effect<
  SqlClient.SqlClient,
  never,
  Scope.Scope
> = Effect.gen(function* () {
  const hub = yield* makeHub()
  const context = yield* Effect.orDie(Layer.build(hub.layer()))
  return Context.get(context, SqlClient.SqlClient)
})

export const openClientDatabase: Effect.Effect<
  LocalDatabase,
  never,
  Scope.Scope
> = Effect.gen(function* () {
  const hub = yield* makeHub()
  const context = yield* Effect.orDie(Layer.build(hub.layer()))
  const client = Context.get(context, SqliteClient)
  return {
    sql: client.sql,
    changes: client.changes,
    role: Effect.succeed('Leader'),
  }
})

// NOTE: a sync engine's clocks sped up for tests.
export const FAST_TIMING = {
  heartbeat: '40 millis',
  silence: '250 millis',
  resendEvery: '60 millis',
  followerPoll: '20 millis',
  backoff: Schedule.spaced('15 millis'),
} as const
