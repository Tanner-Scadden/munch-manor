import { Effect, FileSystem, Function, Result, Schema } from 'effect'
import type { PlatformError } from 'effect/PlatformError'

export const decodeJson =
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
  ): ((text: string) => S['Type']) =>
  text =>
    Result.getOrThrowWith(
      Schema.decodeResult(Schema.fromJsonString(schema))(text),
      error => new Error(error.message),
    )

const encodeJsonWith = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  space?: number,
): ((value: S['Type']) => string) => {
  const encode = Schema.encodeResult(
    Schema.fromJsonString(schema, space === undefined ? {} : { space }),
  )
  return value =>
    Result.getOrThrowWith(encode(value), error => new Error(error.message))
}

export const encodeJson: {
  (
    space?: number,
  ): <S extends Schema.ConstraintEncoder<unknown>>(
    schema: S,
  ) => (value: S['Type']) => string
  <S extends Schema.ConstraintEncoder<unknown>>(
    schema: S,
    space?: number,
  ): (value: S['Type']) => string
} = Function.dual(
  (args: IArguments) => Schema.isSchema(args[0]),
  encodeJsonWith,
)

export const readJsonFile: {
  <S extends Schema.ConstraintDecoder<unknown>>(
    path: string,
  ): (
    schema: S,
  ) => Effect.Effect<
    S['Type'],
    PlatformError | Schema.SchemaError,
    FileSystem.FileSystem
  >
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    path: string,
  ): Effect.Effect<
    S['Type'],
    PlatformError | Schema.SchemaError,
    FileSystem.FileSystem
  >
} = Function.dual(
  2,
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    path: string,
  ): Effect.Effect<
    S['Type'],
    PlatformError | Schema.SchemaError,
    FileSystem.FileSystem
  > =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const text = yield* fs.readFileString(path)
      return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(text)
    }),
)

export const writeJsonFile: {
  <S extends Schema.ConstraintEncoder<unknown>>(
    path: string,
    value: S['Type'],
  ): (
    schema: S,
  ) => Effect.Effect<
    void,
    PlatformError | Schema.SchemaError,
    FileSystem.FileSystem
  >
  <S extends Schema.ConstraintEncoder<unknown>>(
    schema: S,
    path: string,
    value: S['Type'],
  ): Effect.Effect<
    void,
    PlatformError | Schema.SchemaError,
    FileSystem.FileSystem
  >
} = Function.dual(
  3,
  <S extends Schema.ConstraintEncoder<unknown>>(
    schema: S,
    path: string,
    value: S['Type'],
  ): Effect.Effect<
    void,
    PlatformError | Schema.SchemaError,
    FileSystem.FileSystem
  > =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const text = yield* Schema.encodeEffect(
        Schema.fromJsonString(schema, { space: 2 }),
      )(value)
      yield* fs.writeFileString(path, `${text}\n`)
    }),
)
