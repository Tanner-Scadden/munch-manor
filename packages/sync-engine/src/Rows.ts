import { Effect, Function, Schema } from 'effect'
import { Base64Url } from 'effect/encoding'

export const decodeRows: {
  <A, I>(
    rows: ReadonlyArray<unknown>,
  ): (schema: Schema.Codec<A, I>) => Effect.Effect<ReadonlyArray<A>>
  <A, I>(
    schema: Schema.Codec<A, I>,
    rows: ReadonlyArray<unknown>,
  ): Effect.Effect<ReadonlyArray<A>>
} = Function.dual(
  2,
  <A, I>(
    schema: Schema.Codec<A, I>,
    rows: ReadonlyArray<unknown>,
  ): Effect.Effect<ReadonlyArray<A>> =>
    Effect.orDie(Schema.decodeUnknownEffect(Schema.Array(schema))(rows)),
)

const base64Url = (bytes: Uint8Array): string => Base64Url.encode(bytes)

const randomBytes = (length: number): Effect.Effect<Uint8Array> =>
  Effect.sync(() => crypto.getRandomValues(new Uint8Array(length)))

export const randomId = (bytes: number): Effect.Effect<string> =>
  Effect.map(randomBytes(bytes), base64Url)
