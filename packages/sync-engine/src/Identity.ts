import { Effect, Function, Result, Schema, String, pipe } from 'effect'
import { Base64Url } from 'effect/encoding'

import { base64Url, randomBytes } from './Rows'
import { Unauthorized } from './Server'

// NOTE: identity without accounts. Each device makes an ECDSA P-256 key
// pair on first launch and a random player id. To sync, it asks the server
// for a challenge (a nonce the server MACs, so it keeps no state), signs it
// with its private key, and trades the signature for a session token: an
// HMAC-signed claim of its device id and player id that lasts a day. The
// WebSocket Hello and every identity request carry that token. The server
// maps a device id (a hash of its public key) to one player id; linking a
// device moves that mapping to another device's player.
//
// Why a token after a challenge, and not a signature on every request: a
// Durable Object then checks a cheap HMAC instead of an ECDSA signature per
// message, and the private key signs only once a day.

// ERRORS

export class IdentityError extends Schema.TaggedError<
  IdentityError,
  { readonly brand: unique symbol }
>()('IdentityError', {
  reason: Schema.String,
}) {}

const cryptoError = (error: unknown) =>
  IdentityError.make({ reason: `WebCrypto: ${globalThis.String(error)}` })

// KEYS

export const PublicKey = Schema.Struct({
  kty: Schema.Literal('EC'),
  crv: Schema.Literal('P-256'),
  x: Schema.String,
  y: Schema.String,
})
export type PublicKey = typeof PublicKey.Type

const EcdsaParams = { name: 'ECDSA', namedCurve: 'P-256' }
const SignParams = { name: 'ECDSA', hash: 'SHA-256' }

const encoder = new TextEncoder()

const bytesOf = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(encoder.encode(text))

const fromBase64Url = (
  text: string,
): Result.Result<Uint8Array<ArrayBuffer>, string> =>
  Result.mapError(
    Result.map(Base64Url.decode(text), bytes => new Uint8Array(bytes)),
    error => error.message,
  )

export const sha256 = (
  text: string,
): Effect.Effect<Uint8Array, IdentityError> =>
  Effect.map(
    Effect.tryPromise({
      try: () => crypto.subtle.digest('SHA-256', bytesOf(text)),
      catch: cryptoError,
    }),
    digest => new Uint8Array(digest),
  )

// NOTE: 128 bits of the SHA-256 of the public key's coordinates.
export const deviceIdOf = (
  publicKey: PublicKey,
): Effect.Effect<string, IdentityError> =>
  Effect.map(sha256(`${publicKey.x}.${publicKey.y}`), digest =>
    base64Url(digest.slice(0, 16)),
  )

export const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

export const PlayerId = Schema.String.check(Schema.isPattern(PLAYER_ID_PATTERN))
export type PlayerId = typeof PlayerId.Type

export const makePlayerId: Effect.Effect<string> = Effect.map(
  randomBytes(16),
  base64Url,
)

// NOTE: the private key is exported once, as a JWK, so the app can keep it
// in its own database; it is imported back as non-extractable, so code in
// the page can sign with it but never read it out again. A key in IndexedDB
// could stay non-extractable at rest; this engine keeps all of its state in
// SQLite instead (see the README's limits).
export interface StoredKey {
  readonly privateJwk: string
  readonly publicKey: PublicKey
}

export const StoredKeyJson = Schema.Struct({
  privateJwk: Schema.String,
  publicKey: PublicKey,
})

export interface DeviceKey {
  readonly publicKey: PublicKey
  readonly sign: (message: string) => Effect.Effect<string, IdentityError>
}

// NOTE: the whole private JWK is stored as Web Crypto exports it.
const UnknownJson = Schema.fromJsonString(Schema.Unknown)

export const generateKey: Effect.Effect<StoredKey, IdentityError> = Effect.gen(
  function* () {
    const pair = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.generateKey(EcdsaParams, true, ['sign', 'verify']),
      catch: cryptoError,
    })
    const privateJwk = yield* Effect.tryPromise({
      try: () => crypto.subtle.exportKey('jwk', pair.privateKey),
      catch: cryptoError,
    })
    const publicJwk = yield* Effect.tryPromise({
      try: () => crypto.subtle.exportKey('jwk', pair.publicKey),
      catch: cryptoError,
    })
    const publicKey = yield* Effect.mapError(
      Schema.decodeUnknownEffect(PublicKey)({
        kty: publicJwk.kty,
        crv: publicJwk.crv,
        x: publicJwk.x,
        y: publicJwk.y,
      }),
      error => IdentityError.make({ reason: error.message }),
    )
    const privateJwkText = yield* Effect.mapError(
      Schema.encodeEffect(UnknownJson)(privateJwk),
      error => IdentityError.make({ reason: error.message }),
    )
    return { privateJwk: privateJwkText, publicKey }
  },
)

const PrivateJwk = Schema.fromJsonString(
  Schema.Struct({
    kty: Schema.Literal('EC'),
    crv: Schema.Literal('P-256'),
    x: Schema.String,
    y: Schema.String,
    d: Schema.String,
  }),
)

export const importKey = (
  stored: StoredKey,
): Effect.Effect<DeviceKey, IdentityError> =>
  Effect.gen(function* () {
    const jwk = yield* Effect.mapError(
      Schema.decodeEffect(PrivateJwk)(stored.privateJwk),
      error => IdentityError.make({ reason: error.message }),
    )
    const privateKey = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey(
          'jwk',
          { ...jwk, ext: false },
          EcdsaParams,
          false,
          ['sign'],
        ),
      catch: cryptoError,
    })
    return {
      publicKey: stored.publicKey,
      sign: message =>
        Effect.map(
          Effect.tryPromise({
            try: () =>
              crypto.subtle.sign(SignParams, privateKey, bytesOf(message)),
            catch: cryptoError,
          }),
          signature => base64Url(new Uint8Array(signature)),
        ),
    }
  })

export const verifySignature: {
  (
    message: string,
    signature: string,
  ): (publicKey: PublicKey) => Effect.Effect<boolean, IdentityError>
  (
    publicKey: PublicKey,
    message: string,
    signature: string,
  ): Effect.Effect<boolean, IdentityError>
} = Function.dual(
  3,
  (
    publicKey: PublicKey,
    message: string,
    signature: string,
  ): Effect.Effect<boolean, IdentityError> =>
    Effect.gen(function* () {
      const signatureBytes = yield* Result.match(fromBase64Url(signature), {
        onFailure: reason => Effect.fail(IdentityError.make({ reason })),
        onSuccess: Effect.succeed,
      })
      const key = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.importKey(
            'jwk',
            {
              kty: publicKey.kty,
              crv: publicKey.crv,
              x: publicKey.x,
              y: publicKey.y,
            },
            EcdsaParams,
            false,
            ['verify'],
          ),
        catch: cryptoError,
      })
      return yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.verify(
            SignParams,
            key,
            signatureBytes,
            bytesOf(message),
          ),
        catch: cryptoError,
      })
    }),
)

export const sessionMessage: {
  (playerId: string): (nonce: string) => string
  (nonce: string, playerId: string): string
} = Function.dual(
  2,
  (nonce: string, playerId: string): string =>
    `munch-sync-session:v1:${nonce}:${playerId}`,
)

// MACS

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
    catch: cryptoError,
  })

export const mac: {
  (message: string): (secret: string) => Effect.Effect<string, IdentityError>
  (secret: string, message: string): Effect.Effect<string, IdentityError>
} = Function.dual(
  2,
  (secret: string, message: string): Effect.Effect<string, IdentityError> =>
    Effect.gen(function* () {
      const key = yield* hmacKey(secret)
      const signature = yield* Effect.tryPromise({
        try: () => crypto.subtle.sign('HMAC', key, bytesOf(message)),
        catch: cryptoError,
      })
      return base64Url(new Uint8Array(signature))
    }),
)

// NOTE: crypto.subtle.verify compares in constant time.
const checkMac = (
  secret: string,
  message: string,
  signature: string,
): Effect.Effect<boolean, IdentityError> =>
  Effect.gen(function* () {
    const signatureBytes = yield* Result.match(fromBase64Url(signature), {
      onFailure: () => Effect.succeed(new Uint8Array(0)),
      onSuccess: Effect.succeed,
    })
    const key = yield* hmacKey(secret)
    return yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.verify('HMAC', key, signatureBytes, bytesOf(message)),
      catch: cryptoError,
    })
  })

// CHALLENGES

export const CHALLENGE_TTL_MS = 2 * 60 * 1000

export const makeChallenge: {
  (nowMs: number): (secret: string) => Effect.Effect<string, IdentityError>
  (secret: string, nowMs: number): Effect.Effect<string, IdentityError>
} = Function.dual(
  2,
  (secret: string, nowMs: number): Effect.Effect<string, IdentityError> =>
    Effect.gen(function* () {
      const value = yield* randomBytes(12)
      const salt = base64Url(value)
      const body = `${salt}.${nowMs + CHALLENGE_TTL_MS}`
      return `${body}.${yield* mac(secret, `challenge:${body}`)}`
    }),
)

export const checkChallenge: {
  (
    nonce: string,
    nowMs: number,
  ): (secret: string) => Effect.Effect<void, Unauthorized | IdentityError>
  (
    secret: string,
    nonce: string,
    nowMs: number,
  ): Effect.Effect<void, Unauthorized | IdentityError>
} = Function.dual(
  3,
  (
    secret: string,
    nonce: string,
    nowMs: number,
  ): Effect.Effect<void, Unauthorized | IdentityError> =>
    Effect.gen(function* () {
      const parts = String.split('.')(nonce)
      const [salt, expires, signature] = parts
      if (
        parts.length !== 3 ||
        expires === undefined ||
        signature === undefined
      ) {
        return yield* Unauthorized.make({ reason: 'Malformed challenge' })
      }
      const body = `${salt}.${expires}`
      if (!(yield* checkMac(secret, `challenge:${body}`, signature))) {
        return yield* Unauthorized.make({ reason: 'Forged challenge' })
      }
      if (Number(expires) <= nowMs) {
        return yield* Unauthorized.make({ reason: 'Expired challenge' })
      }
    }),
)

// TOKENS

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export const SessionClaims = Schema.Struct({
  deviceId: Schema.String,
  playerId: Schema.String,
  expiresMs: Schema.Finite,
})
export type SessionClaims = typeof SessionClaims.Type

const ClaimsJson = Schema.fromJsonString(SessionClaims)

export const signToken: {
  (
    claims: SessionClaims,
  ): (secret: string) => Effect.Effect<string, IdentityError>
  (secret: string, claims: SessionClaims): Effect.Effect<string, IdentityError>
} = Function.dual(
  2,
  (
    secret: string,
    claims: SessionClaims,
  ): Effect.Effect<string, IdentityError> =>
    Effect.gen(function* () {
      const json = yield* Effect.mapError(
        Schema.encodeEffect(ClaimsJson)(claims),
        error => IdentityError.make({ reason: error.message }),
      )
      const body = base64Url(bytesOf(json))
      return `${body}.${yield* mac(secret, `token:${body}`)}`
    }),
)

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
    pipe(
      Effect.gen(function* () {
        const parts = String.split('.')(token)
        const [body, signature] = parts
        if (parts.length !== 2 || signature === undefined) {
          return yield* Unauthorized.make({ reason: 'Malformed token' })
        }
        if (!(yield* checkMac(secret, `token:${body}`, signature))) {
          return yield* Unauthorized.make({ reason: 'Forged token' })
        }
        const json = yield* Result.match(Base64Url.decodeString(body), {
          onFailure: () =>
            Effect.fail(Unauthorized.make({ reason: 'Malformed token' })),
          onSuccess: Effect.succeed,
        })
        const claims = yield* Effect.mapError(
          Schema.decodeEffect(ClaimsJson)(json),
          () => Unauthorized.make({ reason: 'Malformed token' }),
        )
        if (claims.expiresMs <= nowMs) {
          return yield* Unauthorized.make({ reason: 'Expired token' })
        }
        return claims
      }),
      Effect.catchTag('IdentityError', error =>
        Effect.fail(Unauthorized.make({ reason: error.reason })),
      ),
    ),
)

// API

// NOTE: the identity endpoints' bodies, shared by the browser client and
// the Worker. Paths are relative to the sync origin.
export const IDENTITY_PATHS = {
  challenge: '/sync/challenge',
  session: '/sync/session',
  link: '/sync/link',
  redeem: '/sync/link/redeem',
  socket: '/sync/socket',
  exchange: '/sync/exchange',
}

export const ChallengeResponse = Schema.Struct({ nonce: Schema.String })
export type ChallengeResponse = typeof ChallengeResponse.Type

export const SessionRequest = Schema.Struct({
  publicKey: PublicKey,
  playerId: PlayerId,
  nonce: Schema.String,
  signature: Schema.String,
})
export type SessionRequest = typeof SessionRequest.Type

export const SessionResponse = Schema.Struct({
  token: Schema.String,
  deviceId: Schema.String,
  playerId: PlayerId,
  devices: Schema.Finite,
  expiresMs: Schema.Finite,
})
export type SessionResponse = typeof SessionResponse.Type

export const LinkCodeResponse = Schema.Struct({
  code: Schema.String,
  expiresMs: Schema.Finite,
})
export type LinkCodeResponse = typeof LinkCodeResponse.Type

export const RedeemRequest = Schema.Struct({ code: Schema.String })
export type RedeemRequest = typeof RedeemRequest.Type

export const IdentityFailure = Schema.TaggedUnion({
  Unauthorized: { reason: Schema.String },
  PlayerTaken: {},
  WrongCode: {},
  TooManyTries: { retryAfterMs: Schema.Finite },
  RateLimited: {},
  BadRequest: { reason: Schema.String },
  Unavailable: {},
})
export type IdentityFailure = typeof IdentityFailure.Type

// NOTE: a refusal with its reason, from the directory on the server or
// decoded from an identity response on the client.
export class IdentityRefused extends Schema.TaggedError<
  IdentityRefused,
  { readonly brand: unique symbol }
>()('IdentityRefused', {
  failure: IdentityFailure,
}) {}

export const identityFailureStatus = (failure: IdentityFailure): number =>
  IdentityFailure.match(failure, {
    Unauthorized: () => 401,
    PlayerTaken: () => 409,
    WrongCode: () => 400,
    TooManyTries: () => 429,
    RateLimited: () => 429,
    BadRequest: () => 400,
    Unavailable: () => 503,
  })
