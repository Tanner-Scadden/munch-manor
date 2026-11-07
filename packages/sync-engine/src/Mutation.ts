import { type Effect, Function, Schema } from 'effect'
import { type SqlClient, type SqlError, Statement } from 'effect/sql'

// WHO

// NOTE: who may write a mutation. Owner is the player the scope belongs to
// (the scope key is their player id), Members are the players listed in the
// scope's sync_members table, and ServerOnly is the authority itself.
export const Writer = Schema.Literals(['Owner', 'Members', 'ServerOnly'])
export type Writer = typeof Writer.Type

export const Actor = Schema.TaggedUnion({
  Device: { playerId: Schema.String, deviceId: Schema.String },
  Server: {},
})
export type Actor = typeof Actor.Type

// ERRORS

export class MutationRejected extends Schema.TaggedError<
  MutationRejected,
  { readonly brand: unique symbol }
>()('MutationRejected', {
  reason: Schema.String,
}) {}

// APPLY

// NOTE: where an apply runs. The server keeps one copy of each table. A
// client keeps two: the confirmed copy, which only server deltas touch, and
// the view the app reads, rebuilt from confirmed with pending mutations
// replayed on top. `table` names the right copy, so one apply function is
// the same plain SQL on every side.
export const Target = Schema.Literals(['Server', 'Confirmed', 'View'])
export type Target = typeof Target.Type

export const CONFIRMED_PREFIX = 'sync_confirmed_'

export const tableName: {
  (table: string): (target: Target) => string
  (target: Target, table: string): string
} = Function.dual(2, (target: Target, table: string): string =>
  target === 'Confirmed' ? `${CONFIRMED_PREFIX}${table}` : table,
)

/** @stability unstable */
export interface ApplyContext {
  readonly scope: string
  readonly timestampMs: number
  readonly target: Target
  readonly table: (name: string) => Statement.Identifier
}

/** @stability unstable */
export const applyContext: {
  (timestampMs: number, target: Target): (scope: string) => ApplyContext
  (scope: string, timestampMs: number, target: Target): ApplyContext
} = Function.dual(
  3,
  (scope: string, timestampMs: number, target: Target): ApplyContext => ({
    scope,
    timestampMs,
    target,
    table: name => Statement.identifier(tableName(target, name)),
  }),
)

// NOTE: an apply must be deterministic: the same arguments, timestamp, and
// starting rows give the same rows on every side. It reads time only from
// the context (the server's clock on the server) and never draws random
// numbers. It fails with MutationRejected when a precondition does not hold.
/** @stability unstable */
export type Apply<A> = (
  args: A,
  context: ApplyContext,
) => Effect.Effect<
  void,
  MutationRejected | SqlError.SqlError,
  SqlClient.SqlClient
>

export type DeviceActor = typeof Actor.cases.Device.Type

/** @stability unstable */
export interface Mutation<Name extends string, A, I> {
  readonly name: Name
  readonly version: number
  readonly args: Schema.Codec<A, I>
  readonly scopes: ReadonlyArray<string>
  readonly writer: Writer
  // NOTE: an optional check of the decoded args against the device that
  // sent them, run only on the server, before the apply. It is how a
  // shared scope's mutation says "only for yourself": args name the player
  // they act for, and this checks it is the sender. The server itself is
  // never asked. The apply stays a function of args and rows alone, so it
  // replays the same on every side.
  authorize?(args: A, actor: DeviceActor): boolean
  apply(
    args: A,
    context: ApplyContext,
  ): Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError,
    SqlClient.SqlClient
  >
}

// NOTE: `apply` is a method so its argument is checked bivariantly, which
// lets a scope list mutations with different args. Args are decoded through
// each mutation's own Schema before its apply sees them.
/** @stability unstable */
export type AnyMutation = Mutation<string, unknown, unknown>

/** @stability unstable */
export const defineMutation = <const Name extends string, A, I>(
  mutation: Mutation<Name, A, I>,
): Mutation<Name, A, I> => mutation

/** @stability unstable */
export type ArgsOf<M> = M extends Mutation<string, infer A, unknown> ? A : never

/** @stability unstable */
export const encodeArgs: {
  <A, I>(
    args: NoInfer<A>,
  ): (
    mutation: Mutation<string, A, I>,
  ) => Effect.Effect<string, Schema.SchemaError>
  <A, I>(
    mutation: Mutation<string, A, I>,
    args: NoInfer<A>,
  ): Effect.Effect<string, Schema.SchemaError>
} = Function.dual(
  2,
  <A, I>(
    mutation: Mutation<string, A, I>,
    args: NoInfer<A>,
  ): Effect.Effect<string, Schema.SchemaError> =>
    Schema.encodeEffect(Schema.fromJsonString(mutation.args))(args),
)

/** @stability unstable */
export const decodeArgs: {
  <A, I>(
    json: string,
  ): (mutation: Mutation<string, A, I>) => Effect.Effect<A, Schema.SchemaError>
  <A, I>(
    mutation: Mutation<string, A, I>,
    json: string,
  ): Effect.Effect<A, Schema.SchemaError>
} = Function.dual(
  2,
  <A, I>(
    mutation: Mutation<string, A, I>,
    json: string,
  ): Effect.Effect<A, Schema.SchemaError> =>
    Schema.decodeEffect(Schema.fromJsonString(mutation.args))(json),
)
