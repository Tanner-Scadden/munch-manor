import {
  Array,
  Effect,
  MutableRef,
  Predicate,
  Result,
  Schedule,
  Schema,
  pipe,
} from 'effect'

import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

import {
  type ChangeOperation,
  DatabaseFailure,
  Persistence,
  type SqlValue,
  type TableChange,
} from './Protocol'
import { describeError } from './describeError'

export interface Engine {
  readonly persistence: Persistence
  readonly execute: (
    sql: string,
    params: ReadonlyArray<SqlValue>,
  ) => Result.Result<EngineRows, DatabaseFailure>
  readonly isInTransaction: () => boolean
  readonly rollback: () => void
  readonly takeChanges: () => ReadonlyArray<TableChange>
  readonly close: () => void
}

interface EngineRows {
  readonly columns: ReadonlyArray<string>
  readonly values: ReadonlyArray<ReadonlyArray<SqlValue>>
}

export class EngineOpenError extends Schema.TaggedError<
  EngineOpenError,
  { readonly brand: unique symbol }
>()('EngineOpenError', {
  failure: DatabaseFailure,
}) {}

export interface OpenOptions {
  readonly file: string
  readonly directory: string
}

const errorName = (error: unknown): string =>
  Predicate.hasProperty(error, 'name') && Predicate.isString(error.name)
    ? error.name
    : ''

const failureOf = (sqlite3: Sqlite3Static, error: unknown): DatabaseFailure =>
  Predicate.hasProperty(error, 'resultCode') &&
  Predicate.isNumber(error.resultCode)
    ? {
        code: sqlite3.capi.sqlite3_js_rc_str(error.resultCode),
        message: describeError(error),
      }
    : { code: 'SQLITE_ERROR', message: describeError(error) }

const OPFS_INSTALL_ATTEMPTS = 8
const OPFS_INSTALL_SPACING = '250 millis'

const HANDLE_BUSY_ERRORS: ReadonlyArray<string> = [
  'NoModificationAllowedError',
  'InvalidStateError',
]

const isHandleBusy = (error: unknown): boolean =>
  Array.contains(HANDLE_BUSY_ERRORS, errorName(error)) ||
  /access handle/i.test(describeError(error))

const hasSyncAccessHandles = (): boolean =>
  Predicate.hasProperty(globalThis, 'FileSystemFileHandle') &&
  Predicate.hasProperty(globalThis, 'navigator') &&
  Predicate.hasProperty(globalThis.navigator, 'storage') &&
  Reflect.has(globalThis.navigator.storage, 'getDirectory') &&
  Reflect.has(
    Reflect.get(globalThis, 'FileSystemFileHandle').prototype,
    'createSyncAccessHandle',
  )

class OpfsUnavailable extends Schema.TaggedError<
  OpfsUnavailable,
  { readonly brand: unique symbol }
>()('OpfsUnavailable', {
  reason: Schema.String,
}) {}

class OpfsAttemptError extends Schema.TaggedError<
  OpfsAttemptError,
  { readonly brand: unique symbol }
>()('OpfsAttemptError', {
  cause: Schema.Unknown,
}) {}

const attemptFailed = (cause: unknown): OpfsAttemptError =>
  OpfsAttemptError.make({ cause })

const poolOptions = (options: OpenOptions) => {
  const pool = {
    directory: options.directory,
    preserveOnInitFailure: true,
    forceReinitIfPreviouslyFailed: true,
  }
  return pool
}

const openOpfs = (
  sqlite3: Sqlite3Static,
  options: OpenOptions,
): Effect.Effect<Database, OpfsUnavailable> =>
  hasSyncAccessHandles()
    ? pipe(
        Effect.tryPromise({
          try: () => sqlite3.installOpfsSAHPoolVfs(poolOptions(options)),
          catch: attemptFailed,
        }),
        Effect.retry({
          while: error => isHandleBusy(error.cause),
          schedule: Schedule.spaced(OPFS_INSTALL_SPACING),
          times: OPFS_INSTALL_ATTEMPTS,
        }),
        Effect.flatMap(pool =>
          Effect.try({
            try: (): Database => new pool.OpfsSAHPoolDb(options.file),
            catch: attemptFailed,
          }),
        ),
        Effect.mapError(error =>
          OpfsUnavailable.make({ reason: describeError(error.cause) }),
        ),
      )
    : Effect.fail(
        OpfsUnavailable.make({
          reason: 'This browser has no OPFS sync access handles',
        }),
      )

const openMemory = (
  sqlite3: Sqlite3Static,
): Effect.Effect<Database, EngineOpenError> =>
  Effect.try({
    try: (): Database => new sqlite3.oo1.DB(':memory:', 'c'),
    catch: error =>
      EngineOpenError.make({
        failure: { code: 'SQLITE_CANTOPEN', message: describeError(error) },
      }),
  })

const operationOf = (sqlite3: Sqlite3Static, op: number): ChangeOperation =>
  op === sqlite3.capi.SQLITE_INSERT
    ? 'Insert'
    : op === sqlite3.capi.SQLITE_DELETE
      ? 'Delete'
      : 'Update'

const isSameChange = (a: TableChange, b: TableChange): boolean =>
  a.table === b.table && a.operation === b.operation

const addChange = (
  changes: ReadonlyArray<TableChange>,
  change: TableChange,
): ReadonlyArray<TableChange> =>
  Array.some(changes, existing => isSameChange(existing, change))
    ? changes
    : Array.append(changes, change)

const watchChanges = (
  sqlite3: Sqlite3Static,
  db: Database,
): (() => ReadonlyArray<TableChange>) => {
  const pending = MutableRef.make<ReadonlyArray<TableChange>>([])
  const committed = MutableRef.make<ReadonlyArray<TableChange>>([])
  sqlite3.capi.sqlite3_update_hook(
    db,
    (_context, op, _database, table) => {
      MutableRef.update(pending, changes =>
        addChange(changes, { table, operation: operationOf(sqlite3, op) }),
      )
    },
    0,
  )
  sqlite3.capi.sqlite3_commit_hook(
    db,
    () => {
      MutableRef.update(committed, changes =>
        Array.reduce(MutableRef.get(pending), changes, addChange),
      )
      MutableRef.set(pending, [])
      return 0
    },
    0,
  )
  sqlite3.capi.sqlite3_rollback_hook(
    db,
    () => {
      MutableRef.set(pending, [])
      return 0
    },
    0,
  )
  return () => {
    const changes = MutableRef.get(committed)
    MutableRef.set(committed, [])
    return changes
  }
}

const makeEngine = (
  sqlite3: Sqlite3Static,
  db: Database,
  persistence: Persistence,
): Engine => {
  const takeChanges = watchChanges(sqlite3, db)
  return {
    persistence,
    execute: (sql, params) =>
      Result.try({
        try: (): EngineRows => {
          const columnNames: globalThis.Array<string> = []
          const resultRows: globalThis.Array<globalThis.Array<SqlValue>> = []
          db.exec(
            params.length === 0
              ? { sql, rowMode: 'array', resultRows, columnNames }
              : {
                  sql,
                  bind: [...params],
                  rowMode: 'array',
                  resultRows,
                  columnNames,
                },
          )
          return { columns: columnNames, values: resultRows }
        },
        catch: error => failureOf(sqlite3, error),
      }),
    isInTransaction: () => sqlite3.capi.sqlite3_get_autocommit(db) === 0,
    rollback: () => {
      Result.try(() => db.exec('ROLLBACK'))
    },
    takeChanges,
    close: () => {
      Result.try(() => db.close())
    },
  }
}

const WARM = 'warm'

const warmModules = new Map<typeof WARM, Promise<Sqlite3Static>>()

export const warmEngine = (): void => {
  if (warmModules.has(WARM)) {
    return
  }
  const loading = sqlite3InitModule()
  loading.catch(() => undefined)
  warmModules.set(WARM, loading)
}

const takeSqlite = (): Promise<Sqlite3Static> => {
  const maybeWarm = warmModules.get(WARM)
  warmModules.delete(WARM)
  return maybeWarm ?? sqlite3InitModule()
}

const loadSqlite: Effect.Effect<Sqlite3Static, EngineOpenError> =
  Effect.tryPromise({
    try: takeSqlite,
    catch: error =>
      EngineOpenError.make({
        failure: { code: 'SQLITE_CANTOPEN', message: describeError(error) },
      }),
  })

export const openEngine = (
  options: OpenOptions,
): Effect.Effect<Engine, EngineOpenError> =>
  Effect.gen(function* () {
    const sqlite3 = yield* loadSqlite
    const opened = yield* pipe(
      openOpfs(sqlite3, options),
      Effect.map(db => ({ db, persistence: Persistence.cases.Opfs.make({}) })),
      Effect.catch(({ reason }) =>
        Effect.map(openMemory(sqlite3), db => ({
          db,
          persistence: Persistence.cases.Memory.make({ reason }),
        })),
      ),
    )
    const engine = makeEngine(sqlite3, opened.db, opened.persistence)
    yield* pipe(
      engine.execute('PRAGMA foreign_keys = ON', []),
      Result.match({
        onSuccess: () => Effect.void,
        onFailure: failure => Effect.fail(EngineOpenError.make({ failure })),
      }),
    )
    return engine
  })
