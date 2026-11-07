import {
  Array,
  Effect,
  Function,
  Option,
  Order,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type Actor,
  type AnyMutation,
  type Target,
  tableName,
} from './Mutation'

// SCOPE IDS

// NOTE: a scope id is `<kind>:<key>`, such as `player:3f9a...` or
// `leaderboard:campaign:2026-w44`. The kind picks the definition; the key
// picks the one instance, and for an Owner scope it is the owner's player id.
export const SCOPE_ID_PATTERN = /^[a-z][a-z0-9-]*:[A-Za-z0-9:_-]{1,128}$/

export const ScopeId = Schema.String.check(Schema.isPattern(SCOPE_ID_PATTERN))
export type ScopeId = typeof ScopeId.Type

export interface ScopeAddress {
  readonly kind: string
  readonly key: string
}

export const scopeId: {
  (key: string): (kind: string) => string
  (kind: string, key: string): string
} = Function.dual(2, (kind: string, key: string): string => `${kind}:${key}`)

export const parseScopeId = (id: string): Option.Option<ScopeAddress> =>
  SCOPE_ID_PATTERN.test(id)
    ? Option.map(String.indexOf(':')(id), separator => ({
        kind: String.slice(0, separator)(id),
        key: String.slice(separator + 1)(id),
      }))
    : Option.none()

// DEFINITION

export const Readers = Schema.Literals(['Owner', 'Members', 'Everyone'])
export type Readers = typeof Readers.Type

// NOTE: ReadWrite replicas keep confirmed tables and a view and replay
// pending mutations. ReadOnly replicas (a leaderboard a client only watches)
// apply deltas straight to the view and never rebuild.
export const ReplicaMode = Schema.Literals(['ReadWrite', 'ReadOnly'])
export type ReplicaMode = typeof ReplicaMode.Type

/** @stability unstable */
export type ScopeMigration = (
  table: (name: string) => string,
) => Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>

/** @stability unstable */
export interface ScopeDefinition {
  readonly kind: string
  readonly tables: ReadonlyArray<string>
  readonly migrations: Readonly<Record<string, ScopeMigration>>
  readonly mutations: ReadonlyArray<AnyMutation>
  readonly readers: Readers
  readonly replica: ReplicaMode
}

/** @stability unstable */
export const defineScope = (definition: ScopeDefinition): ScopeDefinition =>
  definition

// NOTE: every mutation a scope lists must allow the scope's kind. The server
// refuses to start a scope whose definition breaks this.
/** @stability unstable */
export const outOfScopeMutations = (
  definition: ScopeDefinition,
): ReadonlyArray<string> =>
  pipe(
    definition.mutations,
    Array.filter(mutation => !Array.contains(mutation.scopes, definition.kind)),
    Array.map(mutation => mutation.name),
  )

/** @stability unstable */
export const findMutation: {
  (name: string): (definition: ScopeDefinition) => Option.Option<AnyMutation>
  (definition: ScopeDefinition, name: string): Option.Option<AnyMutation>
} = Function.dual(
  2,
  (definition: ScopeDefinition, name: string): Option.Option<AnyMutation> =>
    Array.findFirst(definition.mutations, mutation => mutation.name === name),
)

/** @stability unstable */
export const mutationVersions = (
  definition: ScopeDefinition,
): Record<string, number> =>
  Record.fromEntries(
    Array.map(definition.mutations, (mutation): readonly [string, number] => [
      mutation.name,
      mutation.version,
    ]),
  )

// MIGRATIONS

// NOTE: each scope migration runs once per target: once on the server, and
// once for the confirmed tables and once for the view on a client. They are
// recorded in sync_migrations by kind, target, and id, and run in id order.
/** @stability unstable */
export const runScopeMigrations: {
  (
    target: Target,
  ): (
    definition: ScopeDefinition,
  ) => Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>
  (
    definition: ScopeDefinition,
    target: Target,
  ): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>
} = Function.dual(
  2,
  (
    definition: ScopeDefinition,
    target: Target,
  ): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE IF NOT EXISTS sync_migrations (
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      id TEXT NOT NULL,
      PRIMARY KEY (kind, target, id)
    )`
      const done = yield* sql<{
        readonly id: string
      }>`SELECT id FROM sync_migrations WHERE kind = ${definition.kind} AND target = ${target}`
      const doneIds = Array.map(done, row => row.id)
      const pending = pipe(
        Record.toEntries(definition.migrations),
        Array.filter(([id]) => !Array.contains(doneIds, id)),
        Array.sort(
          Order.mapInput(
            Order.String,
            ([id]: readonly [string, ScopeMigration]) => id,
          ),
        ),
      )
      yield* Effect.forEach(
        pending,
        ([id, migration]) =>
          Effect.andThen(
            migration(name => tableName(target, name)),
            sql`INSERT INTO sync_migrations ${sql.insert({
              kind: definition.kind,
              target,
              id,
            })}`,
          ),
        { discard: true },
      )
    }).pipe(withTransactionOf),
)

const withTransactionOf = <A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Effect.Effect<A, E | SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.flatMap(SqlClient.SqlClient, sql => sql.withTransaction(effect))

// PERMISSIONS

export const Permission = Schema.TaggedUnion({
  Allowed: {},
  Forbidden: { reason: Schema.String },
})
export type Permission = typeof Permission.Type

const allowed: Permission = Permission.cases.Allowed.make({})

const forbidden = (reason: string): Permission =>
  Permission.cases.Forbidden.make({ reason })

const isMember = (
  playerId: string,
): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT player_id FROM sync_members WHERE player_id = ${playerId}`
    return Array.isReadonlyArrayNonEmpty(rows)
  })

const checkParty = (
  party: 'Owner' | 'Members',
  actor: Actor,
  address: ScopeAddress,
): Effect.Effect<Permission, SqlError.SqlError, SqlClient.SqlClient> => {
  if (actor._tag === 'Server') {
    return Effect.succeed(allowed)
  }
  if (party === 'Owner') {
    return Effect.succeed(
      actor.playerId === address.key
        ? allowed
        : forbidden('Only the owner of this scope may do that'),
    )
  }
  return Effect.map(isMember(actor.playerId), member =>
    member ? allowed : forbidden('Only members of this scope may do that'),
  )
}

/** @stability unstable */
export const checkRead: {
  (
    actor: Actor,
    address: ScopeAddress,
  ): (
    definition: ScopeDefinition,
  ) => Effect.Effect<Permission, SqlError.SqlError, SqlClient.SqlClient>
  (
    definition: ScopeDefinition,
    actor: Actor,
    address: ScopeAddress,
  ): Effect.Effect<Permission, SqlError.SqlError, SqlClient.SqlClient>
} = Function.dual(
  3,
  (
    definition: ScopeDefinition,
    actor: Actor,
    address: ScopeAddress,
  ): Effect.Effect<Permission, SqlError.SqlError, SqlClient.SqlClient> =>
    definition.readers === 'Everyone'
      ? Effect.succeed(allowed)
      : checkParty(definition.readers, actor, address),
)

/** @stability unstable */
export const checkWrite: {
  (
    actor: Actor,
    address: ScopeAddress,
  ): (
    mutation: AnyMutation,
  ) => Effect.Effect<Permission, SqlError.SqlError, SqlClient.SqlClient>
  (
    mutation: AnyMutation,
    actor: Actor,
    address: ScopeAddress,
  ): Effect.Effect<Permission, SqlError.SqlError, SqlClient.SqlClient>
} = Function.dual(
  3,
  (
    mutation: AnyMutation,
    actor: Actor,
    address: ScopeAddress,
  ): Effect.Effect<Permission, SqlError.SqlError, SqlClient.SqlClient> => {
    if (mutation.writer === 'ServerOnly') {
      return Effect.succeed(
        actor._tag === 'Server'
          ? allowed
          : forbidden(`${mutation.name} is written only by the server`),
      )
    }
    return checkParty(mutation.writer, actor, address)
  },
)
