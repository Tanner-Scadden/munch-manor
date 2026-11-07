import { Array, Effect, Option, Schema, pipe } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  IdentityFailure,
  IdentityRefused,
  type LinkCodeResponse,
  SESSION_TTL_MS,
  type SessionClaims,
  type SessionRequest,
  type SessionResponse,
  checkChallenge,
  deviceIdOf,
  sessionMessage,
  signToken,
  verifySignature,
} from './Identity'
import {
  type Attempts,
  CODE_TTL_MS,
  afterFailure,
  codeFromBytes,
  decideAttempt,
  isExpired,
  normalizeCode,
} from './Pairing'
import { decodeRows, randomBytes } from './Rows'

// NOTE: the server's map from devices to players, and the link codes. It
// runs over any SqlClient; Munch Manor keeps it in one Durable Object.

const fail = (failure: IdentityFailure) =>
  Effect.fail(IdentityRefused.make({ failure }))

export interface Redeemed {
  readonly session: SessionResponse
  readonly previousPlayerId: string
}

export interface Directory {
  readonly session: (
    request: SessionRequest,
    nowMs: number,
  ) => Effect.Effect<SessionResponse, IdentityRefused>
  readonly createLinkCode: (
    claims: SessionClaims,
    nowMs: number,
  ) => Effect.Effect<LinkCodeResponse, IdentityRefused>
  readonly redeem: (
    claims: SessionClaims,
    code: string,
    nowMs: number,
  ) => Effect.Effect<Redeemed, IdentityRefused>
  readonly devices: (playerId: string) => Effect.Effect<number, IdentityRefused>
}

const DeviceRow = Schema.Struct({ player_id: Schema.String })
const CodeRow = Schema.Struct({
  player_id: Schema.String,
  expires_ms: Schema.Finite,
})
const AttemptsRow = Schema.Struct({
  window_start_ms: Schema.Finite,
  failures: Schema.Finite,
})
const CountRow = Schema.Struct({ n: Schema.Finite })

const RedeemStep = Schema.TaggedUnion({
  Linked: { playerId: Schema.String, previous: Schema.String },
  Refused: { failure: IdentityFailure },
})
type RedeemStep = typeof RedeemStep.Type

const refusedStep = (failure: IdentityFailure): RedeemStep =>
  RedeemStep.cases.Refused.make({ failure })

const unavailable = (_: SqlError.SqlError) =>
  IdentityRefused.make({ failure: IdentityFailure.cases.Unavailable.make({}) })

/** @stability unstable */
export const makeDirectory = (
  secret: string,
): Effect.Effect<Directory, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`CREATE TABLE IF NOT EXISTS sync_devices (
          device_id TEXT PRIMARY KEY,
          public_x TEXT NOT NULL,
          public_y TEXT NOT NULL,
          player_id TEXT NOT NULL,
          created_ms INTEGER NOT NULL,
          seen_ms INTEGER NOT NULL
        )`
        yield* sql`CREATE INDEX IF NOT EXISTS sync_devices_by_player
          ON sync_devices (player_id)`
        yield* sql`CREATE TABLE IF NOT EXISTS sync_link_codes (
          code TEXT PRIMARY KEY,
          player_id TEXT NOT NULL,
          expires_ms INTEGER NOT NULL
        )`
        yield* sql`CREATE TABLE IF NOT EXISTS sync_link_attempts (
          device_id TEXT PRIMARY KEY,
          window_start_ms INTEGER NOT NULL,
          failures INTEGER NOT NULL
        )`
      }),
    )

    const countDevices = (playerId: string) =>
      Effect.flatMap(
        sql`SELECT COUNT(*) AS n FROM sync_devices WHERE player_id = ${playerId}`,
        rows =>
          Effect.map(decodeRows(CountRow, rows), decoded =>
            Option.match(Array.head(decoded), {
              onNone: () => 0,
              onSome: row => row.n,
            }),
          ),
      )

    const playerOfDevice = (deviceId: string) =>
      Effect.flatMap(
        sql`SELECT player_id FROM sync_devices WHERE device_id = ${deviceId}`,
        rows =>
          Effect.map(decodeRows(DeviceRow, rows), decoded =>
            Option.map(Array.head(decoded), row => row.player_id),
          ),
      )

    const issue = (deviceId: string, playerId: string, nowMs: number) =>
      Effect.gen(function* () {
        const expiresMs = nowMs + SESSION_TTL_MS
        const token = yield* pipe(
          signToken(secret, { deviceId, playerId, expiresMs }),
          Effect.mapError(() =>
            IdentityRefused.make({
              failure: IdentityFailure.cases.Unavailable.make({}),
            }),
          ),
        )
        const devices = yield* Effect.mapError(
          countDevices(playerId),
          unavailable,
        )
        return { token, deviceId, playerId, devices, expiresMs }
      })

    // NOTE: a known device keeps the player it is mapped to, whatever it
    // claims. A new device registers with the player id it made, unless
    // another device already holds it.
    const session = (request: SessionRequest, nowMs: number) =>
      Effect.gen(function* () {
        yield* pipe(
          checkChallenge(secret, request.nonce, nowMs),
          Effect.catchTags({
            Unauthorized: error =>
              fail(
                IdentityFailure.cases.Unauthorized.make({
                  reason: error.reason,
                }),
              ),
            IdentityError: () =>
              fail(IdentityFailure.cases.Unavailable.make({})),
          }),
        )
        const signed = yield* pipe(
          verifySignature(
            request.publicKey,
            sessionMessage(request.nonce, request.playerId),
            request.signature,
          ),
          Effect.catchTag('IdentityError', () => Effect.succeed(false)),
        )
        if (!signed) {
          return yield* fail(
            IdentityFailure.cases.Unauthorized.make({
              reason: 'Bad signature',
            }),
          )
        }
        const deviceId = yield* Effect.mapError(
          deviceIdOf(request.publicKey),
          () =>
            IdentityRefused.make({
              failure: IdentityFailure.cases.Unavailable.make({}),
            }),
        )
        const playerId = yield* pipe(
          sql.withTransaction(
            Effect.gen(function* () {
              const known = yield* playerOfDevice(deviceId)
              if (Option.isSome(known)) {
                yield* sql`UPDATE sync_devices SET seen_ms = ${nowMs} WHERE device_id = ${deviceId}`
                return Option.some(known.value)
              }
              const holders = yield* countDevices(request.playerId)
              if (holders > 0) {
                return Option.none()
              }
              yield* sql`INSERT INTO sync_devices ${sql.insert({
                device_id: deviceId,
                public_x: request.publicKey.x,
                public_y: request.publicKey.y,
                player_id: request.playerId,
                created_ms: nowMs,
                seen_ms: nowMs,
              })}`
              return Option.some(request.playerId)
            }),
          ),
          Effect.mapError(unavailable),
        )
        if (Option.isNone(playerId)) {
          return yield* fail(IdentityFailure.cases.PlayerTaken.make({}))
        }
        return yield* issue(deviceId, playerId.value, nowMs)
      })

    // NOTE: one live code per player: asking again replaces the old one.
    const createLinkCode = (claims: SessionClaims, nowMs: number) =>
      pipe(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`DELETE FROM sync_link_codes
              WHERE expires_ms <= ${nowMs} OR player_id = ${claims.playerId}`
            const value_1 = yield* randomBytes(6)
            const code = codeFromBytes(value_1)
            const expiresMs = nowMs + CODE_TTL_MS
            yield* sql`INSERT INTO sync_link_codes ${sql.insert({
              code,
              player_id: claims.playerId,
              expires_ms: expiresMs,
            })} ON CONFLICT (code) DO UPDATE SET
              player_id = excluded.player_id, expires_ms = excluded.expires_ms`
            return { code, expiresMs }
          }),
        ),
        Effect.mapError(unavailable),
      )

    const attemptsOf = (deviceId: string) =>
      Effect.flatMap(
        sql`SELECT window_start_ms, failures FROM sync_link_attempts
          WHERE device_id = ${deviceId}`,
        rows =>
          Effect.map(decodeRows(AttemptsRow, rows), decoded =>
            Option.map(Array.head(decoded), (row): Attempts => ({
              windowStartMs: row.window_start_ms,
              failures: row.failures,
            })),
          ),
      )

    const recordFailure = (deviceId: string, nowMs: number) =>
      Effect.gen(function* () {
        const value_2 = yield* attemptsOf(deviceId)
        const next = afterFailure(value_2, nowMs)
        yield* sql`INSERT INTO sync_link_attempts ${sql.insert({
          device_id: deviceId,
          window_start_ms: next.windowStartMs,
          failures: next.failures,
        })} ON CONFLICT (device_id) DO UPDATE SET
          window_start_ms = excluded.window_start_ms, failures = excluded.failures`
      })

    // NOTE: every wrong, expired, or malformed code counts against the
    // device. A code is single use: redeeming it deletes it.
    const redeem = (claims: SessionClaims, input: string, nowMs: number) =>
      Effect.gen(function* () {
        const step = yield* pipe(
          sql.withTransaction(
            Effect.gen(function* () {
              const value_3 = yield* attemptsOf(claims.deviceId)
              const decision = decideAttempt(value_3, nowMs)
              if (decision._tag === 'Limited') {
                return refusedStep(
                  IdentityFailure.cases.TooManyTries.make({
                    retryAfterMs: decision.retryAfterMs,
                  }),
                )
              }
              const wrong = refusedStep(
                IdentityFailure.cases.WrongCode.make({}),
              )
              const maybeCode = normalizeCode(input)
              if (Option.isNone(maybeCode)) {
                yield* recordFailure(claims.deviceId, nowMs)
                return wrong
              }
              const rows =
                yield* sql`SELECT player_id, expires_ms FROM sync_link_codes
                WHERE code = ${maybeCode.value}`
              const value_4 = yield* decodeRows(CodeRow, rows)
              const found = Array.head(value_4)
              if (
                Option.isNone(found) ||
                isExpired(found.value.expires_ms, nowMs)
              ) {
                yield* recordFailure(claims.deviceId, nowMs)
                return wrong
              }
              yield* sql`DELETE FROM sync_link_codes WHERE code = ${maybeCode.value}`
              yield* sql`DELETE FROM sync_link_attempts WHERE device_id = ${claims.deviceId}`
              yield* sql`UPDATE sync_devices SET player_id = ${found.value.player_id},
                seen_ms = ${nowMs} WHERE device_id = ${claims.deviceId}`
              return RedeemStep.cases.Linked.make({
                playerId: found.value.player_id,
                previous: claims.playerId,
              })
            }),
          ),
          Effect.mapError(unavailable),
        )
        if (step._tag === 'Refused') {
          return yield* fail(step.failure)
        }
        const issued = yield* issue(claims.deviceId, step.playerId, nowMs)
        return { session: issued, previousPlayerId: step.previous }
      })

    return {
      session,
      createLinkCode,
      redeem,
      devices: playerId => Effect.mapError(countDevices(playerId), unavailable),
    }
  })
