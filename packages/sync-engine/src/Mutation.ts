import { type Effect, Function, Schema } from 'effect'
import { type SqlClient, type SqlError, Statement } from 'effect/sql'

export const Writer = Schema.Literals(['Owner', 'Members', 'ServerOnly'])
export type Writer = typeof Writer.Type

export const Actor = Schema.TaggedUnion({
  Device: { playerId: Schema.String, deviceId: Schema.String },
  Server: {},
})
export type Actor = typeof Actor.Type

export class MutationRejected extends Schema.TaggedError<
  MutationRejected,
  { readonly brand: unique symbol }
>()('MutationRejected', {
  reason: Schema.String,
}) {}

export const Target = Schema.Literals(['Server', 'Confirmed', 'View'])
export type Target = typeof Target.Type

export const CONFIRMED_PREFIX = 'sync_confirmed_'

export const tableName: {
  (table: string): (target: Target) => string
  (target: Target, table: string): string
} = Function.dual(2, (target: Target, table: string): string =>
  target === 'Confirmed' ? `${CONFIRMED_PREFIX}${table}` : table,
)

export interface ApplyContext {
  readonly scope: string
  readonly timestampMs: number
  readonly target: Target
  readonly table: (name: string) => Statement.Identifier
}

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

export type Apply<A> = (
  args: A,
  context: ApplyContext,
) => Effect.Effect<
  void,
  MutationRejected | SqlError.SqlError,
  SqlClient.SqlClient
>

export type DeviceActor = typeof Actor.cases.Device.Type

export interface Mutation<Name extends string, A, I> {
  readonly name: Name
  readonly version: number
  readonly args: Schema.Codec<A, I>
  readonly scopes: ReadonlyArray<string>
  readonly writer: Writer
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

export type AnyMutation = Mutation<string, unknown, unknown>

export const defineMutation = <const Name extends string, A, I>(
  mutation: Mutation<Name, A, I>,
): Mutation<Name, A, I> => mutation

export type ArgsOf<M> = M extends Mutation<string, infer A, unknown> ? A : never

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
