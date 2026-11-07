import {
  Array,
  Clock,
  Effect,
  Function,
  Option,
  Record,
  Result,
  Schema,
  pipe,
} from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  Actor,
  type AnyMutation,
  type DeviceActor,
  type Mutation,
  type MutationRejected,
  applyContext,
  decodeArgs,
  encodeArgs,
} from './Mutation'
import {
  ClientMessage,
  Delta,
  type Envelope,
  type FailCode,
  type HelloMessage,
  type HelloMode,
  PROTOCOL_VERSION,
  RejectCode,
  Row,
  ServerMessage,
  decodeClientMessage,
} from './Protocol'
import { decodeRows } from './Rows'
import {
  type Permission,
  type ScopeAddress,
  type ScopeDefinition,
  checkRead,
  checkWrite,
  findMutation,
  outOfScopeMutations,
  parseScopeId,
  runScopeMigrations,
} from './Scope'

// OPTIONS

// NOTE: the log keeps the last LOG_TAIL deltas; a client further behind
// than that, or more than SNAPSHOT_AFTER deltas behind, joins with a
// snapshot instead. Applied mutation ids are kept longer than the log, so a
// mutation retried after a long time offline is still recognized as done.
export const DEFAULT_LOG_TAIL = 500
export const DEFAULT_SNAPSHOT_AFTER = 200
export const DEFAULT_APPLIED_IDS_KEPT = 20_000

/** @stability unstable */
export interface ScopeServerOptions {
  readonly definition: ScopeDefinition
  readonly scope: string
  readonly logTail?: number | undefined
  readonly snapshotAfter?: number | undefined
  readonly appliedIdsKept?: number | undefined
}

export class ScopeServerError extends Schema.TaggedError<
  ScopeServerError,
  { readonly brand: unique symbol }
>()('ScopeServerError', {
  reason: Schema.String,
}) {}

// OUTCOMES

export const Outcome = Schema.TaggedUnion({
  Applied: { delta: Delta },
  Duplicate: { id: Schema.String, seq: Schema.Finite },
  Refused: { id: Schema.String, code: RejectCode, reason: Schema.String },
})
export type Outcome = typeof Outcome.Type

export interface PushResult {
  readonly deltas: ReadonlyArray<Delta>
  readonly replies: ReadonlyArray<ServerMessage>
}

export interface Hello {
  readonly lastSeq: number
  readonly mode: HelloMode
}

/** @stability unstable */
export interface ScopeServer {
  readonly scope: string
  readonly address: ScopeAddress
  readonly definition: ScopeDefinition
  readonly head: Effect.Effect<number, SqlError.SqlError>
  readonly join: (
    hello: Hello,
  ) => Effect.Effect<ServerMessage, SqlError.SqlError>
  readonly push: (
    actor: Actor,
    envelopes: ReadonlyArray<Envelope>,
  ) => Effect.Effect<PushResult, SqlError.SqlError>
  readonly runServer: <A, I>(
    mutation: Mutation<string, A, I>,
    args: NoInfer<A>,
    id: string,
  ) => Effect.Effect<Outcome, SqlError.SqlError | Schema.SchemaError>
  readonly addMember: (
    playerId: string,
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly removeMember: (
    playerId: string,
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly checkRead: (
    actor: Actor,
  ) => Effect.Effect<Permission, SqlError.SqlError>
  readonly snapshot: Effect.Effect<ServerMessage, SqlError.SqlError>
}

// TABLES

const createEngineTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS sync_log (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    args TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    origin TEXT NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS sync_applied (
    id TEXT PRIMARY KEY,
    seq INTEGER,
    code TEXT,
    reason TEXT
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS sync_head (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    seq INTEGER NOT NULL,
    trimmed_through INTEGER NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS sync_members (
    player_id TEXT PRIMARY KEY
  )`
  yield* sql`INSERT INTO sync_head (id, seq, trimmed_through) VALUES (1, 0, 0)
    ON CONFLICT (id) DO NOTHING`
})

const HeadRow = Schema.Struct({
  seq: Schema.Finite,
  trimmed_through: Schema.Finite,
})
type HeadRow = typeof HeadRow.Type

const LogRow = Schema.Struct({
  seq: Schema.Finite,
  id: Schema.String,
  name: Schema.String,
  version: Schema.Finite,
  args: Schema.String,
  timestamp_ms: Schema.Finite,
  origin: Schema.Literals(['Client', 'Server']),
})
type LogRow = typeof LogRow.Type

const AppliedRow = Schema.Struct({
  seq: Schema.NullOr(Schema.Finite),
  code: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
})

const isRejectCode = Schema.is(RejectCode)

const deltaOfRow = (row: LogRow): Delta => ({
  seq: row.seq,
  id: row.id,
  name: row.name,
  version: row.version,
  args: row.args,
  timestampMs: row.timestamp_ms,
  origin: row.origin,
})

const refused = (id: string, code: RejectCode, reason: string): Outcome =>
  Outcome.cases.Refused.make({ id, code, reason })

const emptyHead: HeadRow = { seq: 0, trimmed_through: 0 }

// SERVER

/** @stability unstable */
export const makeScopeServer = (
  options: ScopeServerOptions,
): Effect.Effect<
  ScopeServer,
  ScopeServerError | SqlError.SqlError,
  SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { definition, scope } = options
    const logTail = options.logTail ?? DEFAULT_LOG_TAIL
    const snapshotAfter = options.snapshotAfter ?? DEFAULT_SNAPSHOT_AFTER
    const appliedIdsKept = options.appliedIdsKept ?? DEFAULT_APPLIED_IDS_KEPT

    const address = yield* Option.match(parseScopeId(scope), {
      onNone: () =>
        Effect.fail(ScopeServerError.make({ reason: `Bad scope id ${scope}` })),
      onSome: parsed =>
        parsed.kind === definition.kind
          ? Effect.succeed(parsed)
          : Effect.fail(
              ScopeServerError.make({
                reason: `Scope ${scope} is not a ${definition.kind} scope`,
              }),
            ),
    })
    const strays = outOfScopeMutations(definition)
    if (Array.isReadonlyArrayNonEmpty(strays)) {
      return yield* ScopeServerError.make({
        reason: `Mutations ${Array.join(strays, ', ')} do not allow scope kind ${definition.kind}`,
      })
    }

    const provide = <A, E>(
      effect: Effect.Effect<A, E, SqlClient.SqlClient>,
    ): Effect.Effect<A, E> =>
      Effect.provideService(effect, SqlClient.SqlClient, sql)

    yield* provide(
      sql.withTransaction(
        Effect.andThen(
          createEngineTables,
          runScopeMigrations(definition, 'Server'),
        ),
      ),
    )

    const readHead = Effect.flatMap(
      sql`SELECT seq, trimmed_through FROM sync_head WHERE id = 1`,
      rows =>
        Effect.map(decodeRows(HeadRow, rows), decoded =>
          Option.getOrElse(Array.head(decoded), () => emptyHead),
        ),
    )

    const tableRows = (table: string) =>
      Effect.flatMap(sql`SELECT * FROM ${sql(table)}`, rows =>
        Effect.map(
          decodeRows(Row, rows),
          (decoded): readonly [string, ReadonlyArray<Row>] => [table, decoded],
        ),
      )

    const snapshot: Effect.Effect<ServerMessage, SqlError.SqlError> =
      sql.withTransaction(
        Effect.gen(function* () {
          const head = yield* readHead
          const tables = yield* Effect.forEach(definition.tables, tableRows)
          return ServerMessage.cases.Snapshot.make({
            scope,
            seq: head.seq,
            tables: Record.fromEntries(tables),
          })
        }),
      )

    const deltasAfter = (lastSeq: number) =>
      Effect.flatMap(
        sql`SELECT seq, id, name, version, args, timestamp_ms, origin
          FROM sync_log WHERE seq > ${lastSeq} ORDER BY seq`,
        rows => Effect.map(decodeRows(LogRow, rows), Array.map(deltaOfRow)),
      )

    // NOTE: a client joins with the deltas after its lastSeq while the log
    // still holds them all and they are few. Otherwise, or when it asks, or
    // when it claims a seq past the head (the scope was reset), it gets a
    // snapshot of every table at the head.
    const join = (
      hello: Hello,
    ): Effect.Effect<ServerMessage, SqlError.SqlError> =>
      Effect.gen(function* () {
        const head = yield* readHead
        const needsSnapshot =
          hello.mode === 'Snapshot' ||
          hello.lastSeq > head.seq ||
          hello.lastSeq < head.trimmed_through ||
          head.seq - hello.lastSeq > snapshotAfter
        if (needsSnapshot) {
          return yield* snapshot
        }
        const deltas = yield* deltasAfter(hello.lastSeq)
        return ServerMessage.cases.Deltas.make({
          scope,
          head: head.seq,
          deltas,
        })
      })

    const compact = (head: number) =>
      Effect.gen(function* () {
        const through = head - logTail
        if (through > 0) {
          yield* sql`DELETE FROM sync_log WHERE seq <= ${through}`
          yield* sql`UPDATE sync_head SET trimmed_through = MAX(trimmed_through, ${through}) WHERE id = 1`
        }
        const forget = head - appliedIdsKept
        if (forget > 0) {
          yield* sql`DELETE FROM sync_applied WHERE seq IS NOT NULL AND seq <= ${forget}`
        }
      })

    const previously = (
      id: string,
    ): Effect.Effect<Option.Option<Outcome>, SqlError.SqlError> =>
      Effect.flatMap(
        sql`SELECT seq, code, reason FROM sync_applied WHERE id = ${id}`,
        rows =>
          Effect.map(decodeRows(AppliedRow, rows), decoded =>
            Option.map(Array.head(decoded), row =>
              row.seq !== null
                ? Outcome.cases.Duplicate.make({ id, seq: row.seq })
                : refused(
                    id,
                    row.code !== null && isRejectCode(row.code)
                      ? row.code
                      : 'Precondition',
                    row.reason ?? 'Rejected before',
                  ),
            ),
          ),
      )

    const remember = (outcome: Outcome) =>
      outcome._tag === 'Refused' &&
      (outcome.code === 'Precondition' || outcome.code === 'InvalidArgs')
        ? Effect.asVoid(
            sql`INSERT INTO sync_applied ${sql.insert({
              id: outcome.id,
              seq: null,
              code: outcome.code,
              reason: outcome.reason,
            })} ON CONFLICT (id) DO NOTHING`,
          )
        : Effect.void

    const applyInTransaction = (
      mutation: AnyMutation,
      args: unknown,
      envelope: Envelope,
      origin: 'Client' | 'Server',
      timestampMs: number,
    ) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const head = yield* readHead
          const seq = head.seq + 1
          yield* provide(
            mutation.apply(args, applyContext(scope, timestampMs, 'Server')),
          )
          yield* sql`INSERT INTO sync_log ${sql.insert({
            seq,
            id: envelope.id,
            name: envelope.name,
            version: envelope.version,
            args: envelope.args,
            timestamp_ms: timestampMs,
            origin,
          })}`
          yield* sql`INSERT INTO sync_applied ${sql.insert({
            id: envelope.id,
            seq,
            code: null,
            reason: null,
          })}`
          yield* sql`UPDATE sync_head SET seq = ${seq} WHERE id = 1`
          yield* compact(seq)
          return Outcome.cases.Applied.make({
            delta: {
              seq,
              id: envelope.id,
              name: envelope.name,
              version: envelope.version,
              args: envelope.args,
              timestampMs,
              origin,
            },
          })
        }),
      )

    // NOTE: one mutation, in its own transaction: the apply, its log entry,
    // its applied id, and the new head commit together or not at all. A
    // rejection by the apply rolls all of it back and is remembered, so a
    // retry gets the same answer. Refusals for permission or version are not
    // remembered: they may succeed after an upgrade or a link.
    const applyOne = (
      actor: Actor,
      envelope: Envelope,
      origin: 'Client' | 'Server',
    ): Effect.Effect<Outcome, SqlError.SqlError> =>
      Effect.gen(function* () {
        const before = yield* previously(envelope.id)
        if (Option.isSome(before)) {
          return before.value
        }
        const maybeMutation = findMutation(definition, envelope.name)
        if (Option.isNone(maybeMutation)) {
          return refused(
            envelope.id,
            'UnknownMutation',
            `No mutation named ${envelope.name} in ${definition.kind} scopes`,
          )
        }
        const mutation = maybeMutation.value
        if (mutation.version !== envelope.version) {
          return refused(
            envelope.id,
            'Outdated',
            `${mutation.name} is at version ${mutation.version}, not ${envelope.version}`,
          )
        }
        const permission = yield* provide(checkWrite(mutation, actor, address))
        if (permission._tag === 'Forbidden') {
          return refused(envelope.id, 'Forbidden', permission.reason)
        }
        const decoded = yield* Effect.result(
          decodeArgs(mutation, envelope.args),
        )
        if (Result.isFailure(decoded)) {
          return refused(envelope.id, 'InvalidArgs', decoded.failure.message)
        }
        if (
          actor._tag === 'Device' &&
          mutation.authorize !== undefined &&
          !mutation.authorize(decoded.success, actor)
        ) {
          return refused(
            envelope.id,
            'Forbidden',
            `${mutation.name} is not yours to write`,
          )
        }
        const timestampMs = yield* Clock.currentTimeMillis
        const outcome = yield* pipe(
          applyInTransaction(
            mutation,
            decoded.success,
            envelope,
            origin,
            timestampMs,
          ),
          Effect.catchTag('MutationRejected', (error: MutationRejected) =>
            Effect.succeed(refused(envelope.id, 'Precondition', error.reason)),
          ),
        )
        yield* remember(outcome)
        return outcome
      })

    const replyOf = (outcome: Outcome): ServerMessage =>
      Outcome.match(outcome, {
        Applied: ({ delta }): ServerMessage =>
          ServerMessage.cases.Acked.make({ id: delta.id, seq: delta.seq }),
        Duplicate: ({ id, seq }): ServerMessage =>
          ServerMessage.cases.Acked.make({ id, seq }),
        Refused: ({ id, code, reason }): ServerMessage =>
          ServerMessage.cases.Rejected.make({ id, code, reason }),
      })

    const push = (
      actor: Actor,
      envelopes: ReadonlyArray<Envelope>,
    ): Effect.Effect<PushResult, SqlError.SqlError> =>
      Effect.map(
        Effect.forEach(envelopes, envelope =>
          applyOne(actor, envelope, 'Client'),
        ),
        outcomes => ({
          deltas: Array.filterMap(outcomes, outcome =>
            outcome._tag === 'Applied'
              ? Result.succeed(outcome.delta)
              : Result.failVoid,
          ),
          replies: Array.map(outcomes, replyOf),
        }),
      )

    // NOTE: a mutation the server makes itself, in this scope, such as the
    // count of linked devices. `id` is its idempotency key: running it again
    // with the same id does nothing. Mutations for another scope go through
    // that scope's own server; there is no cross-scope outbox yet, so the
    // caller retries until it is applied.
    const runServer = <A, I>(
      mutation: Mutation<string, A, I>,
      args: A,
      id: string,
    ): Effect.Effect<Outcome, SqlError.SqlError | Schema.SchemaError> =>
      Effect.flatMap(encodeArgs(mutation, args), json =>
        applyOne(
          Actor.cases.Server.make({}),
          { id, name: mutation.name, version: mutation.version, args: json },
          'Server',
        ),
      )

    return {
      scope,
      address,
      definition,
      head: Effect.map(readHead, head => head.seq),
      join,
      push,
      runServer,
      addMember: playerId =>
        Effect.asVoid(
          sql`INSERT INTO sync_members ${sql.insert({ player_id: playerId })}
            ON CONFLICT (player_id) DO NOTHING`,
        ),
      removeMember: playerId =>
        Effect.asVoid(
          sql`DELETE FROM sync_members WHERE player_id = ${playerId}`,
        ),
      checkRead: actor => provide(checkRead(definition, actor, address)),
      snapshot,
    }
  })

// HOST

// NOTE: one connection's state, small enough to keep in a hibernating
// WebSocket's attachment: Opened until a Hello is accepted, then Joined.
export const Connection = Schema.TaggedUnion({
  Opened: {},
  Joined: {
    playerId: Schema.String,
    deviceId: Schema.String,
    clientId: Schema.String,
  },
})
export type Connection = typeof Connection.Type
export type JoinedConnection = typeof Connection.cases.Joined.Type

export const OPENED: Connection = Connection.cases.Opened.make({})

export class Unauthorized extends Schema.TaggedError<
  Unauthorized,
  { readonly brand: unique symbol }
>()('Unauthorized', {
  reason: Schema.String,
}) {}

export type Authenticate = (
  token: string,
  address: ScopeAddress,
) => Effect.Effect<DeviceActor, Unauthorized>

export interface Handled {
  readonly connection: Connection
  readonly reply: ReadonlyArray<ServerMessage>
  readonly broadcast: ReadonlyArray<ServerMessage>
}

const handled = (
  connection: Connection,
  reply: ReadonlyArray<ServerMessage>,
  broadcast: ReadonlyArray<ServerMessage> = [],
): Handled => ({ connection, reply, broadcast })

const failed = (
  connection: Connection,
  code: FailCode,
  reason: string,
): Handled =>
  handled(connection, [ServerMessage.cases.Failed.make({ code, reason })])

const hello = (
  server: ScopeServer,
  authenticate: Authenticate,
  connection: Connection,
  message: HelloMessage,
): Effect.Effect<Handled, SqlError.SqlError> =>
  Effect.gen(function* () {
    if (message.protocol !== PROTOCOL_VERSION) {
      return failed(
        connection,
        'VersionMismatch',
        `This server speaks protocol ${PROTOCOL_VERSION}`,
      )
    }
    if (message.scope !== server.scope) {
      return failed(connection, 'BadMessage', 'Wrong scope for this server')
    }
    const authenticated = yield* Effect.result(
      authenticate(message.token, server.address),
    )
    if (Result.isFailure(authenticated)) {
      return failed(OPENED, 'Unauthorized', authenticated.failure.reason)
    }
    const actor = authenticated.success
    const permission = yield* server.checkRead(actor)
    if (permission._tag === 'Forbidden') {
      return failed(OPENED, 'Forbidden', permission.reason)
    }
    const welcome = yield* server.join(message)
    return handled(
      Connection.cases.Joined.make({
        playerId: actor.playerId,
        deviceId: actor.deviceId,
        clientId: message.clientId,
      }),
      [welcome],
    )
  })

const pushed = (
  server: ScopeServer,
  connection: JoinedConnection,
  envelopes: ReadonlyArray<Envelope>,
): Effect.Effect<Handled, SqlError.SqlError> =>
  Effect.gen(function* () {
    const result = yield* server.push(
      Actor.cases.Device.make({
        playerId: connection.playerId,
        deviceId: connection.deviceId,
      }),
      envelopes,
    )
    const head = yield* server.head
    return handled(
      connection,
      result.replies,
      Array.isReadonlyArrayNonEmpty(result.deltas)
        ? [
            ServerMessage.cases.Deltas.make({
              scope: server.scope,
              head,
              deltas: result.deltas,
            }),
          ]
        : [],
    )
  })

// NOTE: the protocol's server side, independent of the transport. A host (a
// Durable Object, or the in-process server in tests) keeps one Connection
// per socket, feeds each message through here, sends `broadcast` to every
// joined socket of the scope (this one included) and then `reply` to this
// one. Deltas go out before acks, so a client sees its own mutation
// confirmed before it hears it was accepted.
/** @stability unstable */
export const handleMessage: {
  (
    authenticate: Authenticate,
    connection: Connection,
    message: ClientMessage,
  ): (server: ScopeServer) => Effect.Effect<Handled>
  (
    server: ScopeServer,
    authenticate: Authenticate,
    connection: Connection,
    message: ClientMessage,
  ): Effect.Effect<Handled>
} = Function.dual(
  4,
  (
    server: ScopeServer,
    authenticate: Authenticate,
    connection: Connection,
    message: ClientMessage,
  ): Effect.Effect<Handled> => {
    const handling: Effect.Effect<Handled, SqlError.SqlError> =
      ClientMessage.match(message, {
        Ping: () =>
          Effect.succeed(
            handled(connection, [ServerMessage.cases.Pong.make({})]),
          ),
        Hello: helloMessage =>
          hello(server, authenticate, connection, helloMessage),
        Push: ({ mutations }) =>
          Connection.match(connection, {
            Opened: () =>
              Effect.succeed(failed(connection, 'NotReady', 'Say Hello first')),
            Joined: joined => pushed(server, joined, mutations),
          }),
      })
    return Effect.catchTag(handling, 'SqlError', error =>
      Effect.succeed(failed(connection, 'Unavailable', error.message)),
    )
  },
)

/** @stability unstable */
export const handleRaw: {
  (
    authenticate: Authenticate,
    connection: Connection,
    raw: string,
  ): (server: ScopeServer) => Effect.Effect<Handled>
  (
    server: ScopeServer,
    authenticate: Authenticate,
    connection: Connection,
    raw: string,
  ): Effect.Effect<Handled>
} = Function.dual(
  4,
  (
    server: ScopeServer,
    authenticate: Authenticate,
    connection: Connection,
    raw: string,
  ): Effect.Effect<Handled> =>
    Effect.matchEffect(decodeClientMessage(raw), {
      onFailure: error =>
        Effect.succeed(failed(connection, 'BadMessage', error.message)),
      onSuccess: message =>
        handleMessage(server, authenticate, connection, message),
    }),
)
