import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as SqlClient from 'effect/sql/SqlClient'

import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'
import { type Connection, OPENED } from '@munch/sync-engine'

import type { Socket } from './syncCore.ts'

const TaggedJson = Schema.fromJsonString(Schema.Struct({ _tag: Schema.String }))

export const decodeTagged = (text: string): { readonly _tag: string } =>
  Result.getOrThrow(Schema.decodeResult(TaggedJson)(text))

const UnknownJson = Schema.fromJsonString(Schema.Unknown)

export const toJson = (value: unknown): string =>
  Result.getOrThrow(Schema.encodeResult(UnknownJson)(value))

export const fromJson = (text: string): unknown =>
  Result.getOrThrow(Schema.decodeResult(UnknownJson)(text))

export const memory: Effect.Effect<SqlClient.SqlClient, never, Scope.Scope> =
  SqliteClient.layer({ filename: ':memory:' }).pipe(
    Layer.build,
    Effect.orDie,
    Effect.map(context => Context.get(context, SqlClient.SqlClient)),
  )

export const fakeSocket = (): Socket & { readonly sent: Array<string> } => {
  const sent: Array<string> = []
  const state: { connection: Connection } = { connection: OPENED }
  return {
    sent,
    send: message => {
      sent.push(message)
    },
    get connection() {
      return state.connection
    },
    setConnection: connection =>
      Effect.sync(() => {
        state.connection = connection
      }),
  }
}
