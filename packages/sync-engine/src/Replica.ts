import type { Duration } from 'effect'
import {
  Array,
  Clock,
  Effect,
  Function,
  Option,
  Order,
  Record,
  Result,
  Schema,
  Stream,
  SubscriptionRef,
  pipe,
} from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type AnyMutation,
  type Mutation,
  MutationRejected,
  type Target,
  applyContext,
  decodeArgs,
  encodeArgs,
  tableName,
} from './Mutation'
import {
  type AckedMessage,
  type Delta,
  type DeltasMessage,
  type Envelope,
  FailCode,
  HelloMode,
  RejectCode,
  type RejectedMessage,
  type Row,
  ServerMessage,
  type SnapshotMessage,
} from './Protocol'
import { decodeRows, randomId } from './Rows'
import { type ScopeDefinition, findMutation, runScopeMigrations } from './Scope'

// DATABASE

// NOTE: what a replica needs from the local database. The SqliteClient from
// @munch/sqlite-wasm-effect fits it as is: `changes` carries every commit's
// tables on every tab, and `role` says whether this tab leads.
export const Role = Schema.Literals(['Leader', 'Follower'])
export type Role = typeof Role.Type

/** @stability unstable */
export interface LocalDatabase {
  readonly sql: SqlClient.SqlClient
  readonly changes: Stream.Stream<ReadonlyArray<{ readonly table: string }>>
  readonly role: Effect.Effect<Role>
}

// RECEIPTS

export const Receipt = Schema.TaggedUnion({
  Applied: { seq: Schema.Finite },
  Resync: { mode: HelloMode },
  Confirmed: { id: Schema.String, seq: Schema.Finite },
  Rejected: {
    id: Schema.String,
    code: RejectCode,
    reason: Schema.String,
  },
  Failed: { code: FailCode, reason: Schema.String },
  Ignored: {},
})
export type Receipt = typeof Receipt.Type

const applied = (seq: number): Receipt => Receipt.cases.Applied.make({ seq })
const resync = (mode: HelloMode): Receipt => Receipt.cases.Resync.make({ mode })
const ignored: Receipt = Receipt.cases.Ignored.make({})

// STATUS

// NOTE: how far a replica has got with its scope, apart from how the
// connection is doing (that is SyncStatus). Idle has nothing from the server
// and is not loading; Loading is joining for the first time; Ready holds
// confirmed rows up to `seq`, `fresh` once this session has applied a
// snapshot or deltas from the server, and not fresh when the rows are cached
// from an earlier session. Failed is a scope the server refused before it
// was ever ready. Once ready, a replica stays ready: a dropped connection or
// a refusal shows in SyncStatus, not here.
export const ScopeStatus = Schema.TaggedUnion({
  Idle: {},
  Loading: {},
  Ready: { seq: Schema.Finite, fresh: Schema.Boolean },
  Failed: { reason: Schema.String },
})
export type ScopeStatus = typeof ScopeStatus.Type

// NOTE: Leading is the first session since this tab took the lead, and
// Reconnecting every later one.
export const SessionStart = Schema.Literals(['Leading', 'Reconnecting'])
export type SessionStart = typeof SessionStart.Type

const idle: ScopeStatus = ScopeStatus.cases.Idle.make({})
const loading: ScopeStatus = ScopeStatus.cases.Loading.make({})

const sameStatus = Schema.toEquivalence(ScopeStatus)

// NOTE: these refusals do not go away by retrying with the same device.
// Unauthorized refreshes the token, and NotReady and Unavailable pass.
const TERMINAL_FAILURES: ReadonlyArray<FailCode> = [
  'Forbidden',
  'VersionMismatch',
  'BadMessage',
]

export const statusAfterReceipt: {
  (receipt: Receipt): (status: ScopeStatus) => ScopeStatus
  (status: ScopeStatus, receipt: Receipt): ScopeStatus
} = Function.dual(2, (status: ScopeStatus, receipt: Receipt): ScopeStatus =>
  Receipt.matchOrElse(
    receipt,
    {
      Applied: ({ seq }) => ScopeStatus.cases.Ready.make({ seq, fresh: true }),
      Failed: ({ code, reason }) =>
        Array.contains(TERMINAL_FAILURES, code) &&
        ScopeStatus.isAnyOf(['Idle', 'Loading'])(status)
          ? ScopeStatus.cases.Failed.make({ reason: `${code}: ${reason}` })
          : status,
    },
    () => status,
  ),
)

export const statusAtSessionStart: {
  (start: SessionStart): (status: ScopeStatus) => ScopeStatus
  (status: ScopeStatus, start: SessionStart): ScopeStatus
} = Function.dual(2, (status: ScopeStatus, start: SessionStart): ScopeStatus =>
  ScopeStatus.match(status, {
    Idle: () => loading,
    Loading: () => loading,
    Failed: () => (start === 'Leading' ? loading : status),
    Ready: ({ seq }) =>
      start === 'Leading'
        ? ScopeStatus.cases.Ready.make({ seq, fresh: false })
        : status,
  }),
)

// NOTE: what a tab that opens the replica starts from. Rows the confirmed
// tables already hold are ready, though not fresh, before any connection.
// A receipt commits the confirmed seq before the status moves, so a tab
// closed between the two left a stored seq behind: the larger one wins.
const statusOnOpen = (
  stored: Option.Option<ScopeStatus>,
  confirmed: number,
): ScopeStatus =>
  Option.isSome(stored) && stored.value._tag === 'Ready'
    ? ScopeStatus.cases.Ready.make({
        seq: Math.max(stored.value.seq, confirmed),
        fresh: false,
      })
    : confirmed > 0
      ? ScopeStatus.cases.Ready.make({ seq: confirmed, fresh: false })
      : idle

// SETTLED

// NOTE: how a mutation this device made ended: confirmed at a seq of the
// scope's log, or rejected by the server.
export const Settled = Schema.TaggedUnion({
  Confirmed: { seq: Schema.Finite },
  Rejected: { code: RejectCode, reason: Schema.String },
})
export type Settled = typeof Settled.Type

// NOTE: how many settled ids a kind remembers, so a tab that asks after the
// fact still hears a rejection. An id older than these reads as confirmed.
const SETTLED_KEPT = 200

// NOTE: a tab that waits on a settlement also checks this often, in case
// the outbox changed between its first look and its subscription.
const SETTLED_RECHECK: Duration.Input = '5 seconds'

export class ReplicaError extends Schema.TaggedError<
  ReplicaError,
  { readonly brand: unique symbol }
>()('ReplicaError', {
  reason: Schema.String,
}) {}

// REPLICA

/** @stability unstable */
export interface Replica {
  readonly definition: ScopeDefinition
  readonly scope: Effect.Effect<string, SqlError.SqlError>
  readonly confirmedSeq: Effect.Effect<number, SqlError.SqlError>
  readonly run: <A, I>(
    mutation: Mutation<string, A, I>,
    args: NoInfer<A>,
  ) => Effect.Effect<
    string,
    MutationRejected | ReplicaError | SqlError.SqlError | Schema.SchemaError
  >
  readonly pending: Effect.Effect<ReadonlyArray<Envelope>, SqlError.SqlError>
  readonly receive: (
    message: ServerMessage,
  ) => Effect.Effect<Receipt, SqlError.SqlError>
  readonly switchScope: (
    scope: string,
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly remoteChanges: Stream.Stream<void>
  readonly localChanges: Stream.Stream<void>
  readonly role: Effect.Effect<Role>
  readonly status: Stream.Stream<ScopeStatus>
  readonly currentStatus: Effect.Effect<ScopeStatus, SqlError.SqlError>
  readonly startSession: (
    start: SessionStart,
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly awaitSettled: (
    id: string,
  ) => Effect.Effect<Settled, SqlError.SqlError>
}

export const REPLICAS_TABLE = 'sync_replicas'
export const OUTBOX_TABLE = 'sync_outbox'
export const STATUS_TABLE = 'sync_status'
export const SETTLED_TABLE = 'sync_settled'

const createEngineTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS sync_replicas (
    kind TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    confirmed_seq INTEGER NOT NULL,
    revision INTEGER NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS sync_outbox (
    local_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    args TEXT NOT NULL,
    created_ms INTEGER NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS sync_status (
    kind TEXT PRIMARY KEY,
    status TEXT NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS sync_settled (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    outcome TEXT NOT NULL
  )`
})

const ReplicaRow = Schema.Struct({
  scope: Schema.String,
  confirmed_seq: Schema.Finite,
})

const OutboxRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.Finite,
  args: Schema.String,
  created_ms: Schema.Finite,
})
type OutboxRow = typeof OutboxRow.Type

const StatusRow = Schema.Struct({
  status: Schema.fromJsonString(ScopeStatus),
})

const SettledRow = Schema.Struct({
  outcome: Schema.fromJsonString(Settled),
})

// NOTE: a status and an outcome always encode; a failure is a bug, so it
// dies.
const encodeStatus = (status: ScopeStatus): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(Schema.fromJsonString(ScopeStatus))(status))
const encodeSettled = (settled: Settled): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(Schema.fromJsonString(Settled))(settled))

// NOTE: 16 random bytes from the platform's cryptographic source, so ids
// made on two devices never meet. Only the replica draws them, never an
// apply function.
export const makeMutationId: Effect.Effect<string> = randomId(16)

/** @stability unstable */
export interface ReplicaOptions {
  readonly definition: ScopeDefinition
  readonly database: LocalDatabase
  readonly scope: string
}

type DeltaStep = Readonly<{
  confirmed: number
  receipt: Option.Option<Receipt>
}>

/** @stability unstable */
export const makeReplica = (
  options: ReplicaOptions,
): Effect.Effect<Replica, SqlError.SqlError> => {
  const { definition, database } = options
  const sql = database.sql
  const provide = <A, E>(
    effect: Effect.Effect<A, E, SqlClient.SqlClient>,
  ): Effect.Effect<A, E> =>
    Effect.provideService(effect, SqlClient.SqlClient, sql)
  const isReadOnly = definition.replica === 'ReadOnly'
  const deltaTarget: Target = isReadOnly ? 'View' : 'Confirmed'

  const readReplica = Effect.flatMap(
    sql`SELECT scope, confirmed_seq FROM sync_replicas WHERE kind = ${definition.kind}`,
    rows =>
      Effect.map(decodeRows(ReplicaRow, rows), decoded =>
        Option.getOrElse(Array.head(decoded), () => ({
          scope: options.scope,
          confirmed_seq: 0,
        })),
      ),
  )

  const touch = (confirmed: number) =>
    sql`UPDATE sync_replicas SET confirmed_seq = ${confirmed},
      revision = revision + 1 WHERE kind = ${definition.kind}`

  const pendingRows = Effect.flatMap(
    sql`SELECT id, name, version, args, created_ms FROM sync_outbox
      WHERE kind = ${definition.kind} ORDER BY local_seq`,
    rows => decodeRows(OutboxRow, rows),
  )

  // NOTE: a mutation leaving the outbox is remembered with how it ended, so
  // awaitSettled can answer in any tab, and even after the fact. Only the
  // newest SETTLED_KEPT per kind are kept.
  const recordSettled = (id: string, settled: Settled) =>
    Effect.andThen(
      Effect.flatMap(
        encodeSettled(settled),
        outcome =>
          sql`INSERT INTO sync_settled ${sql.insert({
            id,
            kind: definition.kind,
            outcome,
          })} ON CONFLICT (id) DO NOTHING`,
      ),
      sql`DELETE FROM sync_settled WHERE kind = ${definition.kind}
        AND rowid NOT IN (SELECT rowid FROM sync_settled
          WHERE kind = ${definition.kind} ORDER BY rowid DESC LIMIT ${SETTLED_KEPT})`,
    )

  const removeFromOutbox = (id: string, settled: Settled) =>
    Effect.flatMap(
      sql<{
        readonly id: string
      }>`DELETE FROM sync_outbox WHERE id = ${id} RETURNING id`,
      removed =>
        Array.isReadonlyArrayNonEmpty(removed)
          ? Effect.as(recordSettled(id, settled), true)
          : Effect.succeed(false),
    )

  const applyRow = (
    scope: string,
    row: { readonly name: string; readonly args: string },
    timestampMs: number,
    target: Target,
  ): Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError | Schema.SchemaError
  > =>
    Option.match(findMutation(definition, row.name), {
      onNone: () =>
        Effect.fail(
          MutationRejected.make({ reason: `Unknown mutation ${row.name}` }),
        ),
      onSome: (mutation: AnyMutation) =>
        Effect.flatMap(decodeArgs(mutation, row.args), args =>
          provide(
            mutation.apply(args, applyContext(scope, timestampMs, target)),
          ),
        ),
    })

  // NOTE: rebuild plus replay. The view is thrown away and copied from the
  // confirmed tables, then every pending mutation is applied on top in the
  // order it was made, each in its own savepoint. One that no longer applies
  // is skipped in the view but kept in the outbox: the server decides.
  const rebuild = (scope: string) =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        definition.tables,
        table =>
          Effect.andThen(
            sql`DELETE FROM ${sql(tableName('View', table))}`,
            sql`INSERT INTO ${sql(tableName('View', table))}
              SELECT * FROM ${sql(tableName('Confirmed', table))}`,
          ),
        { discard: true },
      )
      const pending = yield* pendingRows
      yield* Effect.forEach(
        pending,
        row =>
          Effect.ignore(
            sql.withTransaction(applyRow(scope, row, row.created_ms, 'View')),
          ),
        { discard: true },
      )
    })

  const settle = (scope: string, confirmed: number) =>
    Effect.andThen(isReadOnly ? Effect.void : rebuild(scope), touch(confirmed))

  const replaceTables = (
    target: Target,
    tables: Record<string, ReadonlyArray<Row>>,
  ) =>
    Effect.forEach(
      definition.tables,
      table =>
        Effect.andThen(
          sql`DELETE FROM ${sql(tableName(target, table))}`,
          Option.match(Record.get(tables, table), {
            onNone: () => Effect.void,
            onSome: rows =>
              Array.match(rows, {
                onEmpty: () => Effect.void,
                onNonEmpty: nonEmpty =>
                  Effect.asVoid(
                    sql`INSERT INTO ${sql(tableName(target, table))} ${sql.insert(nonEmpty)}`,
                  ),
              }),
          }),
        ),
      { discard: true },
    )

  const receiveSnapshot = (message: SnapshotMessage) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        if (message.scope !== replica.scope) {
          return ignored
        }
        yield* replaceTables(deltaTarget, message.tables)
        yield* settle(replica.scope, message.seq)
        return applied(message.seq)
      }),
    )

  const stepDelta =
    (scope: string) =>
    (
      step: DeltaStep,
      delta: Delta,
    ): Effect.Effect<DeltaStep, SqlError.SqlError> => {
      if (Option.isSome(step.receipt) || delta.seq <= step.confirmed) {
        return Effect.succeed(step)
      }
      if (delta.seq > step.confirmed + 1) {
        return Effect.succeed({
          confirmed: step.confirmed,
          receipt: Option.some(resync('Catchup')),
        })
      }
      const known = Option.exists(
        findMutation(definition, delta.name),
        mutation => mutation.version === delta.version,
      )
      if (!known) {
        return Effect.succeed({
          confirmed: step.confirmed,
          receipt: Option.some(resync('Snapshot')),
        })
      }
      return pipe(
        sql.withTransaction(
          applyRow(scope, delta, delta.timestampMs, deltaTarget),
        ),
        Effect.andThen(
          removeFromOutbox(
            delta.id,
            Settled.cases.Confirmed.make({ seq: delta.seq }),
          ),
        ),
        Effect.as<DeltaStep>({ confirmed: delta.seq, receipt: Option.none() }),
        Effect.catchTags({
          MutationRejected: () =>
            Effect.succeed<DeltaStep>({
              confirmed: step.confirmed,
              receipt: Option.some(resync('Snapshot')),
            }),
          SchemaError: () =>
            Effect.succeed<DeltaStep>({
              confirmed: step.confirmed,
              receipt: Option.some(resync('Snapshot')),
            }),
        }),
      )
    }

  // NOTE: deltas apply to the confirmed tables strictly in seq order. One
  // already applied is skipped, so duplicates do nothing. A gap stops the
  // batch and asks for a catch-up, and a delta this client cannot apply
  // (a newer mutation version, or one that fails here) asks for a snapshot.
  const receiveDeltas = (message: DeltasMessage) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        if (message.scope !== replica.scope) {
          return ignored
        }
        const ordered = Array.sort(
          message.deltas,
          Order.mapInput(Order.Number, (delta: Delta) => delta.seq),
        )
        const result = yield* Effect.reduce(
          ordered,
          (): DeltaStep => ({
            confirmed: replica.confirmed_seq,
            receipt: Option.none(),
          }),
          stepDelta(replica.scope),
        )
        if (result.confirmed !== replica.confirmed_seq) {
          yield* settle(replica.scope, result.confirmed)
        }
        return Option.getOrElse(result.receipt, () =>
          message.head > result.confirmed
            ? resync('Catchup')
            : applied(result.confirmed),
        )
      }),
    )

  // NOTE: an ack whose seq the confirmed tables already hold settles the
  // mutation now, as when its delta was folded into a snapshot. An ack ahead
  // of them keeps the mutation pending and asks for the missing deltas, so
  // the view never loses a change it has not yet seen confirmed.
  const receiveAcked = (message: AckedMessage) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        if (message.seq > replica.confirmed_seq) {
          return resync('Catchup')
        }
        const removed = yield* removeFromOutbox(
          message.id,
          Settled.cases.Confirmed.make({ seq: message.seq }),
        )
        if (removed) {
          yield* settle(replica.scope, replica.confirmed_seq)
        }
        return Receipt.cases.Confirmed.make({
          id: message.id,
          seq: message.seq,
        })
      }),
    )

  const receiveRejected = (message: RejectedMessage) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        const removed = yield* removeFromOutbox(
          message.id,
          Settled.cases.Rejected.make({
            code: message.code,
            reason: message.reason,
          }),
        )
        if (removed) {
          yield* settle(replica.scope, replica.confirmed_seq)
        }
        return Receipt.cases.Rejected.make({
          id: message.id,
          code: message.code,
          reason: message.reason,
        })
      }),
    )

  const receiveMessage = (
    message: ServerMessage,
  ): Effect.Effect<Receipt, SqlError.SqlError> =>
    ServerMessage.match(message, {
      Snapshot: receiveSnapshot,
      Deltas: receiveDeltas,
      Acked: receiveAcked,
      Rejected: receiveRejected,
      Failed: ({ code, reason }) =>
        Effect.succeed(Receipt.cases.Failed.make({ code, reason })),
      Pong: () => Effect.succeed(ignored),
    })

  const run = <A, I>(
    mutation: Mutation<string, A, I>,
    args: A,
  ): Effect.Effect<
    string,
    MutationRejected | ReplicaError | SqlError.SqlError | Schema.SchemaError
  > =>
    Effect.gen(function* () {
      if (isReadOnly) {
        return yield* ReplicaError.make({
          reason: `${definition.kind} scopes are read only on clients`,
        })
      }
      if (Option.isNone(findMutation(definition, mutation.name))) {
        return yield* ReplicaError.make({
          reason: `${mutation.name} is not a ${definition.kind} mutation`,
        })
      }
      if (mutation.writer === 'ServerOnly') {
        return yield* ReplicaError.make({
          reason: `${mutation.name} is written only by the server`,
        })
      }
      const id = yield* makeMutationId
      const createdMs = yield* Clock.currentTimeMillis
      const json = yield* encodeArgs(mutation, args)
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const replica = yield* readReplica
          yield* sql`INSERT INTO sync_outbox ${sql.insert({
            kind: definition.kind,
            id,
            name: mutation.name,
            version: mutation.version,
            args: json,
            created_ms: createdMs,
          })}`
          yield* provide(
            mutation.apply(
              args,
              applyContext(replica.scope, createdMs, 'View'),
            ),
          )
        }),
      )
      return id
    })

  // NOTE: switching scopes, as a device does when it links to another
  // device's player, drops this kind's tables, confirmed seq, and pending
  // mutations. The next sync joins the new scope with a snapshot.
  const switchScope = (scope: string) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const dropped = yield* sql<{
          readonly id: string
        }>`DELETE FROM sync_outbox WHERE kind = ${definition.kind} RETURNING id`
        yield* Effect.forEach(
          dropped,
          row =>
            recordSettled(
              row.id,
              Settled.cases.Rejected.make({
                code: 'Unavailable',
                reason: 'Dropped when this device switched scopes',
              }),
            ),
          { discard: true },
        )
        yield* replaceTables(deltaTarget, {})
        if (!isReadOnly) {
          yield* replaceTables('View', {})
        }
        yield* sql`UPDATE sync_replicas SET scope = ${scope}, confirmed_seq = 0,
          revision = revision + 1 WHERE kind = ${definition.kind}`
        yield* storeStatus(idle)
      }),
    )

  const touchedTable = (table: string) =>
    pipe(
      database.changes,
      Stream.filter(changes =>
        Array.some(changes, change => change.table === table),
      ),
      Stream.as<void>(undefined),
    )

  // STATUS

  // NOTE: the status lives in sync_status, so every tab reads the one the
  // leader writes. The leader also holds it in a SubscriptionRef, so its own
  // stream moves without waiting for the commit to come back.
  const readStatus = Effect.flatMap(
    sql`SELECT status FROM sync_status WHERE kind = ${definition.kind}`,
    rows =>
      Effect.map(decodeRows(StatusRow, rows), decoded =>
        Option.map(Array.head(decoded), row => row.status),
      ),
  )

  const storeStatus = (status: ScopeStatus) =>
    Effect.flatMap(
      encodeStatus(status),
      encoded =>
        sql`INSERT INTO sync_status ${sql.insert({
          kind: definition.kind,
          status: encoded,
        })} ON CONFLICT (kind) DO UPDATE SET status = excluded.status`,
    )

  // NOTE: settled ids and the outbox, read together: still pending is none.
  // An id the outbox and the record have both forgotten was confirmed long
  // ago, so it reads as confirmed at the seq the confirmed tables hold.
  const settledOf = (id: string) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const waiting = yield* sql`SELECT id FROM sync_outbox WHERE id = ${id}`
        if (Array.isReadonlyArrayNonEmpty(waiting)) {
          return Option.none<Settled>()
        }
        const rows = yield* Effect.flatMap(
          sql`SELECT outcome FROM sync_settled WHERE id = ${id}`,
          found => decodeRows(SettledRow, found),
        )
        return yield* Option.match(Array.head(rows), {
          onSome: row => Effect.succeedSome(row.outcome),
          onNone: () =>
            Effect.map(readReplica, replica =>
              Option.some<Settled>(
                Settled.cases.Confirmed.make({ seq: replica.confirmed_seq }),
              ),
            ),
        })
      }),
    )

  return Effect.gen(function* () {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* provide(createEngineTables)
        if (!isReadOnly) {
          yield* provide(runScopeMigrations(definition, 'Confirmed'))
        }
        yield* provide(runScopeMigrations(definition, 'View'))
        yield* sql`INSERT INTO sync_replicas ${sql.insert({
          kind: definition.kind,
          scope: options.scope,
          confirmed_seq: 0,
          revision: 0,
        })} ON CONFLICT (kind) DO NOTHING`
      }),
    )
    const role = yield* database.role
    const readStatus_1 = yield* readStatus
    const opened = statusOnOpen(
      readStatus_1,
      (yield* readReplica).confirmed_seq,
    )
    const initialStatus = yield* role === 'Leader'
      ? Effect.succeed(opened)
      : Effect.map(
          readStatus,
          Option.getOrElse(() => opened),
        )
    const statusRef = yield* SubscriptionRef.make(initialStatus)
    if (role === 'Leader') {
      yield* storeStatus(opened)
    }

    const currentStatus = Effect.flatMap(readStatus, stored =>
      Option.match(stored, {
        onSome: Effect.succeed,
        onNone: () => SubscriptionRef.get(statusRef),
      }),
    )

    const moveStatus = (next: (status: ScopeStatus) => ScopeStatus) =>
      Effect.gen(function* () {
        const current = yield* currentStatus
        const moved = next(current)
        if (!sameStatus(current, moved)) {
          yield* storeStatus(moved)
        }
        yield* SubscriptionRef.set(statusRef, moved)
      })

    const status: Stream.Stream<ScopeStatus> = pipe(
      Stream.merge(
        SubscriptionRef.changes(statusRef),
        Stream.mapEffect(touchedTable(STATUS_TABLE), () =>
          Effect.orElseSucceed(currentStatus, () => idle),
        ),
      ),
      Stream.changesWith(sameStatus),
    )

    const receive = (message: ServerMessage) =>
      Effect.tap(receiveMessage(message), receipt =>
        moveStatus(current => statusAfterReceipt(current, receipt)),
      )

    const awaitSettled = (id: string) =>
      pipe(
        Stream.merge(touchedTable(OUTBOX_TABLE), Stream.tick(SETTLED_RECHECK)),
        Stream.mapEffect(() => settledOf(id)),
        Stream.filterMap(maybeSettled =>
          Option.match(maybeSettled, {
            onNone: () => Result.failVoid,
            onSome: settled => Result.succeed(settled),
          }),
        ),
        Stream.runHead,
        Effect.flatMap(maybeSettled =>
          Option.match(maybeSettled, {
            onSome: Effect.succeed,
            onNone: () => Effect.never,
          }),
        ),
      )

    return {
      definition,
      scope: Effect.map(readReplica, replica => replica.scope),
      confirmedSeq: Effect.map(readReplica, replica => replica.confirmed_seq),
      run,
      pending: Effect.map(pendingRows, rows =>
        Array.map(rows, (row: OutboxRow): Envelope => ({
          id: row.id,
          name: row.name,
          version: row.version,
          args: row.args,
        })),
      ),
      receive,
      switchScope: scope =>
        Effect.andThen(
          switchScope(scope),
          SubscriptionRef.set(statusRef, idle),
        ),
      remoteChanges: touchedTable(REPLICAS_TABLE),
      localChanges: touchedTable(OUTBOX_TABLE),
      role: database.role,
      status,
      currentStatus,
      startSession: start =>
        moveStatus(current => statusAtSessionStart(current, start)),
      awaitSettled,
    }
  })
}
