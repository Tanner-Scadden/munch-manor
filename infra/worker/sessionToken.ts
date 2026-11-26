import { Array, Function, String } from 'effect'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { Base64Url } from 'effect/encoding'

import { Unauthorized } from '@munch/sync-engine'

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export const SessionClaims = Schema.Struct({
  deviceId: Schema.String,
  playerId: Schema.String,
  expiresMs: Schema.Finite,
})
export type SessionClaims = typeof SessionClaims.Type

class TokenCryptoFailed extends Schema.TaggedError<
  TokenCryptoFailed,
  { readonly brand: unique symbol }
>()('TokenCryptoFailed', { reason: Schema.String }) {}

const cryptoFailed = (error: unknown) =>
  TokenCryptoFailed.make({ reason: `WebCrypto: ${globalThis.String(error)}` })

const encoder = new TextEncoder()

const bytesOf = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(encoder.encode(text))

const ClaimsJson = Schema.fromJsonString(SessionClaims)

const hmacKey = (secret: string) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        'raw',
        bytesOf(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      ),
    catch: cryptoFailed,
  })

const mac = (
  secret: string,
  message: string,
): Effect.Effect<string, TokenCryptoFailed> =>
  Effect.gen(function* () {
    const key = yield* hmacKey(secret)
    const signature = yield* Effect.tryPromise({
      try: () => crypto.subtle.sign('HMAC', key, bytesOf(message)),
      catch: cryptoFailed,
    })
    return Base64Url.encode(new Uint8Array(signature))
  })

const checkMac = (
  secret: string,
  message: string,
  signature: string,
): Effect.Effect<boolean, TokenCryptoFailed> =>
  Effect.gen(function* () {
    const signatureBytes = Result.match(Base64Url.decode(signature), {
      onFailure: () => new Uint8Array(0),
      onSuccess: bytes => new Uint8Array(bytes),
    })
    const key = yield* hmacKey(secret)
    return yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.verify('HMAC', key, signatureBytes, bytesOf(message)),
      catch: cryptoFailed,
    })
  })

export const signToken: {
  (
    claims: SessionClaims,
  ): (secret: string) => Effect.Effect<string, TokenCryptoFailed>
  (
    secret: string,
    claims: SessionClaims,
  ): Effect.Effect<string, TokenCryptoFailed>
} = Function.dual(
  2,
  (
    secret: string,
    claims: SessionClaims,
  ): Effect.Effect<string, TokenCryptoFailed> =>
    Effect.gen(function* () {
      const json = yield* Effect.mapError(
        Schema.encodeEffect(ClaimsJson)(claims),
        error => TokenCryptoFailed.make({ reason: error.message }),
      )
      const body = Base64Url.encode(bytesOf(json))
      const signature = yield* mac(secret, `token:${body}`)
      return `${body}.${signature}`
    }),
)

const malformed = () => Unauthorized.make({ reason: 'Malformed token' })

export const verifyToken: {
  (
    token: string,
    nowMs: number,
  ): (secret: string) => Effect.Effect<SessionClaims, Unauthorized>
  (
    secret: string,
    token: string,
    nowMs: number,
  ): Effect.Effect<SessionClaims, Unauthorized>
} = Function.dual(
  3,
  (
    secret: string,
    token: string,
    nowMs: number,
  ): Effect.Effect<SessionClaims, Unauthorized> =>
    Effect.gen(function* () {
      const parts = String.split('.')(token)
      const [body, signature] = yield* Option.all([
        Array.get(parts, 0),
        Array.get(parts, 1),
      ]).pipe(
        Option.filter(() => parts.length === 2),
        Effect.fromOption,
        Effect.mapError(malformed),
      )
      if (!(yield* checkMac(secret, `token:${body}`, signature))) {
        return yield* Unauthorized.make({ reason: 'Forged token' })
      }
      const json = yield* Result.match(Base64Url.decodeString(body), {
        onFailure: () => Effect.fail(malformed()),
        onSuccess: Effect.succeed,
      })
      const claims = yield* Effect.mapError(
        Schema.decodeEffect(ClaimsJson)(json),
        malformed,
      )
      if (claims.expiresMs <= nowMs) {
        return yield* Unauthorized.make({ reason: 'Expired token' })
      }
      return claims
    }).pipe(
      Effect.catchTag('TokenCryptoFailed', error =>
        Effect.fail(Unauthorized.make({ reason: error.reason })),
      ),
    ),
)
