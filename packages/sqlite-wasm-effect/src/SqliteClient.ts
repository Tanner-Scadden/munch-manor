import type { Duration } from 'effect'
import {
  Array,
  Context,
  Effect,
  Function,
  Layer,
  Predicate,
  Record,
  Ref,
  Result,
  Schema,
  type Scope,
  Semaphore,
  Stream,
  pipe,
} from 'effect'
import { Reactivity } from 'effect/reactivity'
import {
  Migrator,
  SqlClient,
  type SqlConnection,
  SqlError,
  Statement,
} from 'effect/sql'

import {
  type Persistence,
  Request,
  Response,
  type SqlValue,
  type TableChange,
} from './Protocol'
import { type Remote, connectionError, databaseError } from './Remote'

// STATUS

// NOTE: the leader tab owns the database file; a follower sends its
// statements through the leader. See the README.
export const Role = Schema.Literals(['Leader', 'Follower'])
export type Role = typeof Role.Type

export interface Status {
  readonly role: Role
  readonly persistence: Persistence
}

export class SqliteOpenError extends Schema.TaggedError<
  SqliteOpenError,
  { readonly brand: unique symbol }
>()('SqliteOpenError', {
  reason: Schema.String,
}) {}

/** @stability unstable */
export type Migrations = Record<
  string,
  Effect.Effect<void, unknown, SqlClient.SqlClient>
>

// SERVICE

/** @stability unstable */
export interface SqliteClientService {
  readonly sql: SqlClient.SqlClient
  readonly status: Effect.Effect<Status>
  readonly changes: Stream.Stream<ReadonlyArray<TableChange>>
  readonly execute: (
    statement: Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>,
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly query: <S extends Schema.Constraint>(
    schema: S,
    statement: Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>,
  ) => Effect.Effect<
    ReadonlyArray<S['Type']>,
    SqlError.SqlError | Schema.SchemaError,
    S['DecodingServices']
  >
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqlError.SqlError, R>
  readonly migrate: (
    migrations: Migrations,
  ) => Effect.Effect<
    ReadonlyArray<readonly [id: number, name: string]>,
    Migrator.MigrationError | SqlError.SqlError
  >
}

/** @stability unstable */
export class SqliteClient extends Context.Service<
  SqliteClient,
  SqliteClientService
>()('@munch/sqlite-wasm-effect/SqliteClient') {}

export const MIGRATIONS_TABLE = 'effect_sql_migrations'

const DEFAULT_REQUEST_TIMEOUT: Duration.Input = '30 seconds'

// PARAMETERS

const toSqlValue = (value: unknown): Result.Result<SqlValue, string> => {
  if (Predicate.isNullish(value)) {
    return Result.succeed(null)
  } else if (Predicate.isBoolean(value)) {
    return Result.succeed(value ? 1 : 0)
  } else if (
    Predicate.isNumber(value) ||
    Predicate.isString(value) ||
    Predicate.isBigInt(value) ||
    Predicate.isUint8Array(value)
  ) {
    return Result.succeed(value)
  } else if (Predicate.isDate(value)) {
    return Result.succeed(value.toISOString())
  } else {
    return Result.fail(`SQLite cannot bind a ${typeof value} parameter`)
  }
}

const toSqlValues = (
  params: ReadonlyArray<unknown>,
): Effect.Effect<ReadonlyArray<SqlValue>, SqlError.SqlError> =>
  pipe(
    Result.all(Array.map(params, toSqlValue)),
    Result.match({
      onSuccess: values => Effect.succeed(values),
      onFailure: message =>
        Effect.fail(
          SqlError.SqlError.make({
            reason: SqlError.UnknownError.make({
              message,
              operation: 'bind',
              cause: message,
            }),
          }),
        ),
    }),
  )

// CONNECTION

interface Rows {
  readonly columns: ReadonlyArray<string>
  readonly values: ReadonlyArray<ReadonlyArray<SqlValue>>
}

const toObjects = (rows: Rows): ReadonlyArray<Record<string, SqlValue>> =>
  Array.map(rows.values, row =>
    Record.fromEntries(Array.zip(rows.columns, row)),
  )

const makeConnection = (
  remote: Remote,
  timeout: Duration.Input,
): SqlConnection.Connection => {
  const run = (
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Effect.Effect<Rows, SqlError.SqlError> =>
    pipe(
      toSqlValues(params),
      Effect.flatMap(values =>
        remote.call(
          id =>
            Request.cases.Execute.make({
              id,
              session: remote.session,
              sql,
              params: values,
            }),
          timeout,
          'execute',
        ),
      ),
      Effect.flatMap(
        Response.matchOrElse(
          {
            Rows: (rows): Effect.Effect<Rows, SqlError.SqlError> =>
              Effect.succeed(rows),
            Failed: ({ failure }) =>
              Effect.fail(databaseError(failure, 'execute')),
          },
          ({ _tag }) =>
            Effect.fail(
              connectionError(`Unexpected ${_tag} response`, 'execute'),
            ),
        ),
      ),
    )

  const objects = (
    sql: string,
    params: ReadonlyArray<unknown>,
    transformRows:
      | (<A extends object>(row: ReadonlyArray<A>) => ReadonlyArray<A>)
      | undefined,
  ): Effect.Effect<
    ReadonlyArray<Record<string, SqlValue>>,
    SqlError.SqlError
  > =>
    Effect.map(run(sql, params), rows =>
      transformRows === undefined
        ? toObjects(rows)
        : transformRows(toObjects(rows)),
    )

  const values = (
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Effect.Effect<ReadonlyArray<ReadonlyArray<SqlValue>>, SqlError.SqlError> =>
    Effect.map(run(sql, params), rows => rows.values)

  return {
    execute: objects,
    executeUnprepared: objects,
    executeRaw: (sql, params) => objects(sql, params, undefined),
    executeStream: (sql, params, transformRows) =>
      Stream.fromIterableEffect(objects(sql, params, transformRows)),
    executeValues: values,
    executeValuesUnprepared: values,
  }
}

// CLIENT

export interface ClientOptions {
  readonly requestTimeout?: Duration.Input | undefined
}

// NOTE: builds both services over any Remote, so the worker layer and the
// in-process layer share everything above the transport.
/** @stability unstable */
export const makeClient: {
  (
    status: Ref.Ref<Status>,
    options: ClientOptions,
  ): (
    remote: Remote,
  ) => Effect.Effect<
    SqliteClientService,
    never,
    Reactivity.Reactivity | Scope.Scope
  >
  (
    remote: Remote,
    status: Ref.Ref<Status>,
    options: ClientOptions,
  ): Effect.Effect<
    SqliteClientService,
    never,
    Reactivity.Reactivity | Scope.Scope
  >
} = Function.dual(
  3,
  (
    remote: Remote,
    status: Ref.Ref<Status>,
    options: ClientOptions,
  ): Effect.Effect<
    SqliteClientService,
    never,
    Reactivity.Reactivity | Scope.Scope
  > =>
    Effect.gen(function* () {
      const reactivity = yield* Reactivity.Reactivity
      const semaphore = yield* Semaphore.make(1)
      const connection = makeConnection(
        remote,
        options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
      )
      const acquirers = SqlClient.makeSqliteAcquirers({
        connection: Effect.succeed(connection),
        semaphore,
      })
      const sql = yield* SqlClient.make({
        acquirer: acquirers.acquirer,
        transactionAcquirer: acquirers.transactionAcquirer,
        onCommitFailure: acquirers.onCommitFailure,
        compiler: Statement.makeCompilerSqlite(),
        driver: '@munch/sqlite-wasm-effect',
        spanAttributes: [['db.system.name', 'sqlite']],
      })

      yield* pipe(
        Stream.fromPubSub(remote.changes),
        Stream.runForEach(changes =>
          reactivity.invalidate(
            Array.dedupe(Array.map(changes, change => change.table)),
          ),
        ),
        Effect.forkScoped,
      )

      const runMigrations = Migrator.make({})

      return {
        sql,
        status: Ref.get(status),
        changes: Stream.fromPubSub(remote.changes),
        execute: statement => Effect.asVoid(statement),
        query: (schema, statement) =>
          Effect.flatMap(
            statement,
            Schema.decodeUnknownEffect(Schema.Array(schema)),
          ),
        transaction: sql.withTransaction,
        migrate: migrations =>
          Effect.provideService(
            runMigrations({
              loader: Migrator.fromRecord(migrations),
              table: MIGRATIONS_TABLE,
            }),
            SqlClient.SqlClient,
            sql,
          ),
      }
    }),
)

// OPEN

export const DEFAULT_OPEN_TIMEOUT: Duration.Input = '60 seconds'

export interface DatabaseFile {
  readonly file: string
  readonly directory: string
}

/** @stability unstable */
export const openThrough: {
  (
    database: DatabaseFile,
    timeout: Duration.Input,
  ): (remote: Remote) => Effect.Effect<Persistence, SqliteOpenError>
  (
    remote: Remote,
    database: DatabaseFile,
    timeout: Duration.Input,
  ): Effect.Effect<Persistence, SqliteOpenError>
} = Function.dual(
  3,
  (
    remote: Remote,
    database: DatabaseFile,
    timeout: Duration.Input,
  ): Effect.Effect<Persistence, SqliteOpenError> =>
    pipe(
      remote.call(
        id =>
          Request.cases.Open.make({
            id,
            session: remote.session,
            file: database.file,
            directory: database.directory,
          }),
        timeout,
        'open',
      ),
      Effect.mapError(error => SqliteOpenError.make({ reason: error.message })),
      Effect.flatMap(response =>
        response._tag === 'Opened'
          ? Effect.succeed(response.persistence)
          : Effect.fail(
              SqliteOpenError.make({
                reason:
                  response._tag === 'OpenFailed'
                    ? response.failure.message
                    : `Unexpected ${response._tag} response to Open`,
              }),
            ),
      ),
    ),
)

/** @stability unstable */
export const layerFromClient = (
  build: Effect.Effect<
    SqliteClientService,
    SqliteOpenError,
    Reactivity.Reactivity | Scope.Scope
  >,
): Layer.Layer<SqliteClient | SqlClient.SqlClient, SqliteOpenError> =>
  pipe(
    Layer.effectContext(
      Effect.map(build, client =>
        pipe(
          Context.make(SqliteClient, client),
          Context.add(SqlClient.SqlClient, client.sql),
        ),
      ),
    ),
    Layer.provide(Reactivity.layer),
  )
