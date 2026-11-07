import {
  Array,
  Clock,
  Effect,
  Option,
  Ref,
  Schema,
  Semaphore,
  pipe,
} from 'effect'
import type { SqlClient } from 'effect/sql'
import { type SqlError } from 'effect/sql'

import {
  type ChallengeResponse,
  IdentityFailure,
  IdentityRefused,
  type LinkCodeResponse,
  type SessionRequest,
  type SessionResponse,
  type StoredKey,
  generateKey,
  importKey,
  makePlayerId,
  sessionMessage,
} from './Identity'
import { decodeRows } from './Rows'

// NOTE: this device's identity on the client: its key pair and player id
// in the sync_device table, and a session token kept in memory and renewed
// a minute before it expires. The HTTP calls go through an IdentityApi, so
// tests can point it straight at a Directory.

export interface IdentityApi {
  readonly challenge: Effect.Effect<ChallengeResponse, IdentityRefused>
  readonly session: (
    request: SessionRequest,
  ) => Effect.Effect<SessionResponse, IdentityRefused>
  readonly link: (
    token: string,
  ) => Effect.Effect<LinkCodeResponse, IdentityRefused>
  readonly redeem: (
    token: string,
    code: string,
  ) => Effect.Effect<SessionResponse, IdentityRefused>
}

export interface DeviceIdentity {
  readonly playerId: Effect.Effect<string, IdentityRefused>
  readonly session: Effect.Effect<SessionResponse, IdentityRefused>
  readonly invalidate: Effect.Effect<void>
  readonly createLinkCode: Effect.Effect<LinkCodeResponse, IdentityRefused>
  readonly redeem: (
    code: string,
  ) => Effect.Effect<SessionResponse, IdentityRefused>
}

const RENEW_BEFORE_MS = 60 * 1000

const DeviceRow = Schema.Struct({
  private_jwk: Schema.String,
  public_x: Schema.String,
  public_y: Schema.String,
  player_id: Schema.String,
})

const unavailable = () =>
  IdentityRefused.make({ failure: IdentityFailure.cases.Unavailable.make({}) })

/** @stability unstable */
export const makeDeviceIdentity = (options: {
  readonly sql: SqlClient.SqlClient
  readonly api: IdentityApi
}): Effect.Effect<DeviceIdentity, SqlError.SqlError> =>
  Effect.gen(function* () {
    const { sql, api } = options
    yield* sql`CREATE TABLE IF NOT EXISTS sync_device (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      private_jwk TEXT NOT NULL,
      public_x TEXT NOT NULL,
      public_y TEXT NOT NULL,
      player_id TEXT NOT NULL
    )`

    const readRow = Effect.flatMap(
      sql`SELECT private_jwk, public_x, public_y, player_id FROM sync_device WHERE id = 1`,
      rows => Effect.map(decodeRows(DeviceRow, rows), Array.head),
    )

    // NOTE: made once, the first time this device syncs. Two tabs racing
    // here both insert with ON CONFLICT DO NOTHING and both read back the
    // one row that won.
    const stored = Effect.gen(function* () {
      const existing = yield* Effect.mapError(readRow, unavailable)
      if (Option.isSome(existing)) {
        return existing.value
      }
      const key = yield* Effect.mapError(generateKey, unavailable)
      const playerId = yield* makePlayerId
      yield* Effect.mapError(
        sql`INSERT INTO sync_device ${sql.insert({
          id: 1,
          private_jwk: key.privateJwk,
          public_x: key.publicKey.x,
          public_y: key.publicKey.y,
          player_id: playerId,
        })} ON CONFLICT (id) DO NOTHING`,
        unavailable,
      )
      return yield* pipe(
        readRow,
        Effect.mapError(unavailable),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(unavailable()),
            onSome: Effect.succeed,
          }),
        ),
      )
    })

    const cached = yield* Ref.make<Option.Option<SessionResponse>>(
      Option.none(),
    )
    const lock = yield* Semaphore.make(1)

    const signIn = Effect.gen(function* () {
      const row = yield* stored
      const key: StoredKey = {
        privateJwk: row.private_jwk,
        publicKey: {
          kty: 'EC',
          crv: 'P-256',
          x: row.public_x,
          y: row.public_y,
        },
      }
      const deviceKey = yield* Effect.mapError(importKey(key), unavailable)
      const { nonce } = yield* api.challenge
      const signature = yield* Effect.mapError(
        deviceKey.sign(sessionMessage(nonce, row.player_id)),
        unavailable,
      )
      const session = yield* api.session({
        publicKey: key.publicKey,
        playerId: row.player_id,
        nonce,
        signature,
      })
      if (session.playerId !== row.player_id) {
        yield* Effect.mapError(
          sql`UPDATE sync_device SET player_id = ${session.playerId} WHERE id = 1`,
          unavailable,
        )
      }
      yield* Ref.set(cached, Option.some(session))
      return session
    })

    const session = lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const current = yield* Ref.get(cached)
        return Option.isSome(current) &&
          current.value.expiresMs - RENEW_BEFORE_MS > now
          ? current.value
          : yield* signIn
      }),
    )

    const redeem = (code: string) =>
      Effect.gen(function* () {
        const current = yield* session
        const linked = yield* api.redeem(current.token, code)
        yield* Effect.mapError(
          sql`UPDATE sync_device SET player_id = ${linked.playerId} WHERE id = 1`,
          unavailable,
        )
        yield* Ref.set(cached, Option.some(linked))
        return linked
      })

    return {
      playerId: Effect.map(stored, row => row.player_id),
      session,
      invalidate: Ref.set(cached, Option.none()),
      createLinkCode: Effect.flatMap(session, current =>
        api.link(current.token),
      ),
      redeem,
    }
  })
