import {
  Data,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schema,
  type Scope,
  Stream,
  pipe,
} from 'effect'
import { SqlClient } from 'effect/sql'

import { describe, expect, it } from '@effect/vitest'

import { type Hub, makeHub } from '../src/inProcess'
import { SqliteClient } from '../src/index'

const withHub = <A, E>(
  program: (hub: Hub) => Effect.Effect<A, E, Scope.Scope>,
  options: Parameters<typeof makeHub>[0] = {},
): Effect.Effect<A, E, Scope.Scope> => Effect.flatMap(makeHub(options), program)

const withClient = <A, E>(
  hub: Hub,
  effect: Effect.Effect<A, E, SqliteClient | SqlClient.SqlClient>,
) => Effect.provide(effect, hub.layer())

class Boom extends Data.TaggedError('Boom')<{}> {}

const Person = Schema.Struct({ id: Schema.Number, name: Schema.String })

const createPeople = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`
})

describe('SqliteClient over the in-process hub', () => {
  it.effect('opens in memory in Node and says why', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const status = yield* client.status
          expect(status.role).toBe('Leader')
          expect(status.persistence._tag).toBe('Memory')
        }),
      ),
    ),
  )

  it.effect('runs the sql tagged template and decodes rows with a Schema', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          yield* sql`INSERT INTO people ${sql.insert([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Bo' },
          ])}`
          const people = yield* client.query(
            Person,
            sql`SELECT id, name FROM people ORDER BY id`,
          )
          expect(people).toEqual([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Bo' },
          ])
          const wrongShape = yield* Effect.exit(
            client.query(
              Schema.Struct({ id: Schema.String }),
              sql`SELECT id FROM people`,
            ),
          )
          expect(Exit.isFailure(wrongShape)).toBe(true)
          const values = yield* sql`SELECT name FROM people WHERE id = ${2}`
            .values
          expect(values).toEqual([['Bo']])
        }),
      ),
    ),
  )

  it.effect('binds booleans, nulls, bigints, and bytes', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows =
            yield* sql`SELECT ${true} AS yes, ${null} AS empty, ${9007199254740993n} AS big, ${new Uint8Array([1, 2])} AS bytes`
          expect(rows[0]).toEqual({
            yes: 1,
            empty: null,
            big: 9007199254740993n,
            bytes: new Uint8Array([1, 2]),
          })
        }),
      ),
    ),
  )

  it.effect('a failing transaction rolls back and a passing one commits', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          const failed = yield* Effect.exit(
            client.transaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
                return yield* new Boom()
              }),
            ),
          )
          expect(Exit.isFailure(failed)).toBe(true)
          const afterRollback = yield* sql`SELECT COUNT(*) AS n FROM people`
          expect(afterRollback).toEqual([{ n: 0 }])
          yield* client.transaction(
            sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`,
          )
          const afterCommit = yield* sql`SELECT COUNT(*) AS n FROM people`
          expect(afterCommit).toEqual([{ n: 1 }])
        }),
      ),
    ),
  )

  it.effect('a constraint failure is a typed SqlError', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
          const error = yield* Effect.flip(
            sql`INSERT INTO people (id, name) VALUES (2, 'Ada')`,
          )
          expect(error._tag).toBe('SqlError')
          expect(error.reason._tag).toBe('UniqueViolation')
          const syntax = yield* Effect.flip(sql`SELEC nope`)
          expect(syntax.reason.message).toMatch(/syntax error/)
        }),
      ),
    ),
  )

  it.effect('migrations run in id order, once, whatever the key order', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          const migrations = {
            '0002_add_pets': Effect.asVoid(
              sql`CREATE TABLE pets (owner INTEGER NOT NULL REFERENCES people (id))`,
            ),
            '0001_add_people': createPeople,
          }
          const first = yield* client.migrate(migrations)
          expect(first).toEqual([
            [1, 'add_people'],
            [2, 'add_pets'],
          ])
          const again = yield* client.migrate(migrations)
          expect(again).toEqual([])
          const later = yield* client.migrate({
            ...migrations,
            '0003_add_toys': Effect.asVoid(sql`CREATE TABLE toys (id INTEGER)`),
          })
          expect(later).toEqual([[3, 'add_toys']])
        }),
      ),
    ),
  )

  it.effect('a failing migration leaves nothing behind', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          const exit = yield* Effect.exit(
            client.migrate({
              '0001_add_people': createPeople,
              '0002_broken': Effect.asVoid(sql`CREATE TABLE broken (`),
            }),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          const tables =
            yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'people'`
          expect(tables).toEqual([])
        }),
      ),
    ),
  )

  it.effect('changes arrive after a commit and never after a rollback', () =>
    withHub(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
          const seen = yield* pipe(
            client.changes,
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          )
          yield* Effect.yieldNow
          yield* Effect.exit(
            client.transaction(
              Effect.andThen(
                sql`INSERT INTO people (id, name) VALUES (9, 'Gone')`,
                Effect.fail(new Boom()),
              ),
            ),
          )
          yield* sql`UPDATE people SET name = 'none' WHERE id = 0`
          yield* sql`UPDATE people SET name = 'Ada B' WHERE id = 1`
          const changes = yield* Fiber.join(seen)
          expect(changes).toEqual([[{ table: 'people', operation: 'Update' }]])
        }),
      ),
    ),
  )

  it.effect('every message crosses the protocol', () =>
    withHub(hub =>
      Effect.gen(function* () {
        yield* withClient(
          hub,
          Effect.flatMap(SqlClient.SqlClient, sql => sql`SELECT 1`),
        )
        const crossings = yield* hub.crossings
        expect(crossings).toBeGreaterThanOrEqual(4)
      }),
    ),
  )
})

describe('two sessions on one database, like two tabs', () => {
  // NOTE: it.live where sessions race on real time: one sleeps inside a
  // transaction while another waits, or the idle timeout rolls one back.
  it.live('a write from another session waits for an open transaction', () =>
    withHub(hub =>
      Effect.gen(function* () {
        const shared = yield* Layer.build(hub.layer())
        const other = yield* Layer.build(hub.layer())
        const order: Array<string> = []
        yield* Effect.provide(createPeople, shared)
        const first = Effect.provide(
          Effect.gen(function* () {
            const client = yield* SqliteClient
            const sql = yield* SqlClient.SqlClient
            yield* client.transaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
                order.push('first wrote')
                yield* Effect.sleep('50 millis')
                yield* sql`INSERT INTO people (id, name) VALUES (2, 'Bo')`
                order.push('first committing')
              }),
            )
          }),
          shared,
        )
        const second = Effect.provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            yield* Effect.sleep('10 millis')
            const rows = yield* sql`SELECT COUNT(*) AS n FROM people`
            order.push(`second saw ${String(rows[0]?.['n'])}`)
          }),
          other,
        )
        yield* Effect.all([first, second], { concurrency: 'unbounded' })
        expect(order).toEqual([
          'first wrote',
          'first committing',
          'second saw 2',
        ])
      }),
    ),
  )

  // NOTE: real time: the idle timeout rolls the open transaction back.
  it.live('a transaction left idle is rolled back so others can go on', () =>
    withHub(
      hub =>
        Effect.gen(function* () {
          const stuck = yield* Layer.build(hub.layer())
          const other = yield* Layer.build(hub.layer())
          yield* Effect.provide(createPeople, other)
          yield* Effect.provide(
            Effect.flatMap(SqlClient.SqlClient, sql =>
              Effect.andThen(
                sql`BEGIN`,
                sql`INSERT INTO people (id, name) VALUES (1, 'Left')`,
              ),
            ),
            stuck,
          )
          const rows = yield* Effect.provide(
            Effect.flatMap(
              SqlClient.SqlClient,
              sql => sql`SELECT COUNT(*) AS n FROM people`,
            ),
            other,
          )
          expect(rows).toEqual([{ n: 0 }])
        }),
      { transactionIdleTimeout: '100 millis' },
    ),
  )

  it.effect(
    'a session that closes mid-transaction is rolled back at once',
    () =>
      withHub(
        hub =>
          Effect.gen(function* () {
            const other = yield* Layer.build(hub.layer())
            yield* Effect.provide(createPeople, other)
            yield* Effect.scoped(
              Effect.provide(
                Effect.flatMap(SqlClient.SqlClient, sql =>
                  Effect.andThen(
                    sql`BEGIN`,
                    sql`INSERT INTO people (id, name) VALUES (1, 'Closed')`,
                  ),
                ),
                hub.layer(),
              ),
            )
            const rows = yield* Effect.provide(
              Effect.flatMap(
                SqlClient.SqlClient,
                sql => sql`SELECT COUNT(*) AS n FROM people`,
              ),
              other,
            )
            expect(rows).toEqual([{ n: 0 }])
          }),
        { transactionIdleTimeout: '1 minute' },
      ),
  )

  // NOTE: real time: the call waits in line behind a transaction that sleeps.
  it.live('an interrupted call waiting in line is cancelled', () =>
    withHub(
      hub =>
        Effect.gen(function* () {
          const holder = yield* Layer.build(hub.layer())
          const waiter = yield* Layer.build(hub.layer())
          yield* Effect.provide(createPeople, holder)
          yield* Effect.provide(
            Effect.flatMap(SqlClient.SqlClient, sql => sql`BEGIN`),
            holder,
          )
          const waiting = yield* pipe(
            Effect.provide(
              Effect.flatMap(
                SqlClient.SqlClient,
                sql => sql`INSERT INTO people (id, name) VALUES (5, 'Late')`,
              ),
              waiter,
            ),
            Effect.forkChild,
          )
          yield* Effect.sleep('30 millis')
          yield* Fiber.interrupt(waiting)
          yield* Effect.provide(
            Effect.flatMap(SqlClient.SqlClient, sql => sql`COMMIT`),
            holder,
          )
          yield* Effect.sleep('30 millis')
          const rows = yield* Effect.provide(
            Effect.flatMap(
              SqlClient.SqlClient,
              sql => sql`SELECT COUNT(*) AS n FROM people`,
            ),
            holder,
          )
          expect(rows).toEqual([{ n: 0 }])
        }),
      { transactionIdleTimeout: '5 seconds' },
    ),
  )
})
