import {
  Array,
  type Duration,
  Effect,
  type Layer,
  Ref,
  type Schema,
  type Scope,
  pipe,
} from 'effect'
import type { SqlClient } from 'effect/sql'

import { openEngine } from './Engine'
import {
  Request,
  type Response,
  decodeRequest,
  decodeResponse,
  encodeRequest,
  encodeResponse,
} from './Protocol'
import { type Remote, makeRemote } from './Remote'
import { makeServer } from './Server'
import {
  type ClientOptions,
  DEFAULT_OPEN_TIMEOUT,
  SqliteClient,
  type SqliteOpenError,
  type Status,
  layerFromClient,
  makeClient,
  openThrough,
} from './SqliteClient'

export interface Hub {
  readonly layer: (
    options?: ClientOptions,
  ) => Layer.Layer<SqliteClient | SqlClient.SqlClient, SqliteOpenError>
  readonly crossings: Effect.Effect<number>
}

export interface HubOptions {
  readonly transactionIdleTimeout?: Duration.Input | undefined
}

const cross = <A>(
  encode: (value: A) => Effect.Effect<unknown, Schema.SchemaError>,
  decode: (value: unknown) => Effect.Effect<A, Schema.SchemaError>,
  value: A,
): Effect.Effect<A> =>
  pipe(
    encode(value),
    Effect.map(encoded => structuredClone(encoded)),
    Effect.flatMap(decode),
    Effect.orDie,
  )

export const makeHub = (
  options: HubOptions = {},
): Effect.Effect<Hub, never, Scope.Scope> =>
  Effect.gen(function* () {
    const remotes = yield* Ref.make<ReadonlyArray<Remote>>([])
    const crossings = yield* Ref.make(0)
    const count = Ref.update(crossings, n => n + 1)

    const server = yield* makeServer({
      open: openEngine,
      transactionIdleTimeout: options.transactionIdleTimeout,
      respond: (response: Response) =>
        Effect.gen(function* () {
          yield* count
          const delivered = yield* cross(
            encodeResponse,
            decodeResponse,
            response,
          )
          const all = yield* Ref.get(remotes)
          yield* Effect.forEach(all, remote => remote.receive(delivered), {
            discard: true,
          })
        }),
    })

    const send = (request: Request): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* count
        const delivered = yield* cross(encodeRequest, decodeRequest, request)
        yield* server.offer(delivered)
      })

    const layer = (
      clientOptions: ClientOptions = {},
    ): Layer.Layer<SqliteClient | SqlClient.SqlClient, SqliteOpenError> =>
      layerFromClient(
        Effect.gen(function* () {
          const known = yield* Ref.get(remotes)
          const session = `session-${known.length + 1}`
          const remote = yield* makeRemote(session, { send })
          yield* Ref.update(remotes, all => Array.append(all, remote))
          yield* Effect.addFinalizer(() =>
            send(Request.cases.Release.make({ session })),
          )
          const persistence = yield* openThrough(
            remote,
            { file: '/test.sqlite3', directory: '.test' },
            DEFAULT_OPEN_TIMEOUT,
          )
          const status = yield* Ref.make<Status>({
            role: 'Leader',
            persistence,
          })
          return yield* makeClient(remote, status, clientOptions)
        }),
      )

    return { layer, crossings: Ref.get(crossings) }
  })

export { SqliteClient }
