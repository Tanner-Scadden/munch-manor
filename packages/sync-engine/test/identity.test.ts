import { Array, Effect, Exit, Option, type Scope, String } from 'effect'
import { SqlClient } from 'effect/sql'

import { describe, expect, it, test } from '@effect/vitest'

import {
  ATTEMPT_WINDOW_MS,
  CODE_TTL_MS,
  ClientMessageJson,
  type Directory,
  type IdentityApi,
  IdentityFailure,
  IdentityRefused,
  MAX_FAILED_ATTEMPTS,
  ServerMessageJson,
  afterFailure,
  codeFromBytes,
  decideAttempt,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  generateKey,
  importKey,
  makeChallenge,
  makeDeviceIdentity,
  makeDirectory,
  normalizeCode,
  sessionMessage,
  signToken,
  verifySignature,
  verifyToken,
} from '../src/index'
import { openServerDatabase } from './fixtures'

const SECRET = 'test-secret-that-is-long-enough'

describe('pairing codes', () => {
  test('are six symbols from an alphabet without look-alikes', () => {
    const code = codeFromBytes(new Uint8Array([0, 31, 32, 255, 8, 14, 99]))
    expect(code).toBe('A9A9JQ')
    expect(code).toHaveLength(6)
    expect(code).not.toMatch(/[01IO]/)
  })

  test('accept what a player types, and nothing else', () => {
    expect(normalizeCode(' abc-def ')).toEqual(Option.some('ABCDEF'))
    expect(normalizeCode('abc 234')).toEqual(Option.some('ABC234'))
    expect(normalizeCode('ABCDE')).toEqual(Option.none())
    expect(normalizeCode('ABCDE0')).toEqual(Option.none())
    expect(normalizeCode('ABCDEFG')).toEqual(Option.none())
  })

  test('stop a device after five wrong tries until the window passes', () => {
    const start = 1_000
    const failures = Array.reduce<
      unknown,
      Option.Option<{ windowStartMs: number; failures: number }>
    >(
      globalThis.Array.from({ length: MAX_FAILED_ATTEMPTS }),
      Option.none(),
      maybe => Option.some(afterFailure(maybe, start + 10)),
    )
    expect(decideAttempt(Option.none(), start)._tag).toBe('Allowed')
    expect(decideAttempt(failures, start + 20)).toEqual({
      _tag: 'Limited',
      retryAfterMs: start + 10 + ATTEMPT_WINDOW_MS - (start + 20),
    })
    expect(decideAttempt(failures, start + 10 + ATTEMPT_WINDOW_MS)._tag).toBe(
      'Allowed',
    )
    expect(afterFailure(failures, start + 10 + ATTEMPT_WINDOW_MS)).toEqual({
      windowStartMs: start + 10 + ATTEMPT_WINDOW_MS,
      failures: 1,
    })
  })
})

describe('tokens and keys', () => {
  it.effect('a token carries its claims and fails when forged or expired', () =>
    Effect.gen(function* () {
      const claims = {
        deviceId: 'device',
        playerId: 'player',
        expiresMs: 5_000,
      }
      const token = yield* signToken(SECRET, claims)
      const value = yield* verifyToken(SECRET, token, 1000)
      expect(value).toEqual(claims)
      const expired = yield* Effect.exit(verifyToken(SECRET, token, 5_000))
      const forged = yield* Effect.exit(
        verifyToken('another-secret', token, 1_000),
      )
      const [body] = String.split('.')(token)
      const tampered = yield* Effect.exit(
        verifyToken(SECRET, `${body}x.${String.split('.')(token)[1]}`, 1_000),
      )
      expect(Exit.isFailure(expired)).toBe(true)
      expect(Exit.isFailure(forged)).toBe(true)
      expect(Exit.isFailure(tampered)).toBe(true)
    }),
  )

  it.effect('a device key signs what only its public key verifies', () =>
    Effect.gen(function* () {
      const stored = yield* generateKey
      const other = yield* generateKey
      const key = yield* importKey(stored)
      const signature = yield* key.sign('hello')
      const value_1 = yield* verifySignature(
        stored.publicKey,
        'hello',
        signature,
      )
      expect(value_1).toBe(true)
      const value_2 = yield* verifySignature(
        stored.publicKey,
        'hellO',
        signature,
      )
      expect(value_2).toBe(false)
      const value_3 = yield* verifySignature(
        other.publicKey,
        'hello',
        signature,
      )
      expect(value_3).toBe(false)
    }),
  )
})

const directoryApi = (
  directory: Directory,
  nowMs: () => number,
): IdentityApi => {
  const claimsOf = (token: string) =>
    Effect.mapError(verifyToken(SECRET, token, nowMs()), error =>
      IdentityRefused.make({
        failure: IdentityFailure.cases.Unauthorized.make({
          reason: error.reason,
        }),
      }),
    )
  return {
    challenge: Effect.suspend(() =>
      Effect.map(Effect.orDie(makeChallenge(SECRET, nowMs())), nonce => ({
        nonce,
      })),
    ),
    session: request => directory.session(request, nowMs()),
    link: token =>
      Effect.flatMap(claimsOf(token), claims =>
        directory.createLinkCode(claims, nowMs()),
      ),
    redeem: (token, code) =>
      Effect.flatMap(claimsOf(token), claims =>
        Effect.map(
          directory.redeem(claims, code, nowMs()),
          redeemed => redeemed.session,
        ),
      ),
  }
}

const withDirectory = <A, E>(
  body: (
    api: IdentityApi,
    clock: { now: number },
  ) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const sql = yield* openServerDatabase
    const directory = yield* Effect.provideService(
      makeDirectory(SECRET),
      SqlClient.SqlClient,
      sql,
    )
    const clock = { now: 1_000_000 }
    return yield* body(
      directoryApi(directory, () => clock.now),
      clock,
    )
  })

const openIdentity = (api: IdentityApi) =>
  Effect.flatMap(openServerDatabase, sql => makeDeviceIdentity({ sql, api }))

describe('device identity and linking', () => {
  it.effect('a device registers with the player id it made, and keeps it', () =>
    withDirectory(api =>
      Effect.gen(function* () {
        const device = yield* openIdentity(api)
        const playerId = yield* device.playerId
        const first = yield* device.session
        expect(first.playerId).toBe(playerId)
        expect(first.devices).toBe(1)
        yield* device.invalidate
        const second = yield* device.session
        expect(second.deviceId).toBe(first.deviceId)
        expect(second.playerId).toBe(playerId)
      }),
    ),
  )

  it.effect('a signature for another nonce or player id is refused', () =>
    withDirectory(api =>
      Effect.gen(function* () {
        const stored = yield* generateKey
        const key = yield* importKey(stored)
        const { nonce } = yield* api.challenge
        const signature = yield* key.sign(
          sessionMessage(nonce, 'AAAAAAAAAAAAAAAAAAAAAA'),
        )
        const refused = yield* Effect.flip(
          api.session({
            publicKey: stored.publicKey,
            playerId: 'BBBBBBBBBBBBBBBBBBBBBB',
            nonce,
            signature,
          }),
        )
        expect(refused.failure._tag).toBe('Unauthorized')
      }),
    ),
  )

  it.effect(
    "a code links a second device to the first device's player, once",
    () =>
      withDirectory((api, clock) =>
        Effect.gen(function* () {
          const phone = yield* openIdentity(api)
          const laptop = yield* openIdentity(api)
          const phonePlayer = (yield* phone.session).playerId
          const laptopBefore = (yield* laptop.session).playerId
          expect(laptopBefore).not.toBe(phonePlayer)
          const { code, expiresMs } = yield* phone.createLinkCode
          expect(expiresMs - clock.now).toBe(CODE_TTL_MS)
          const linked = yield* laptop.redeem(String.toLowerCase(code))
          expect(linked.playerId).toBe(phonePlayer)
          expect(linked.devices).toBe(2)
          const playerId_1 = yield* laptop.playerId
          expect(playerId_1).toBe(phonePlayer)
          const again = yield* Effect.flip(laptop.redeem(code))
          expect(again.failure._tag).toBe('WrongCode')
        }),
      ),
  )

  it.effect(
    'an expired code is refused, and guessing gets a device locked out',
    () =>
      withDirectory((api, clock) =>
        Effect.gen(function* () {
          const phone = yield* openIdentity(api)
          const laptop = yield* openIdentity(api)
          yield* laptop.session
          const { code } = yield* phone.createLinkCode
          clock.now += CODE_TTL_MS
          const late = yield* Effect.flip(laptop.redeem(code))
          expect(late.failure._tag).toBe('WrongCode')
          const fresh = yield* phone.createLinkCode
          yield* Effect.forEach(
            ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'],
            guess => Effect.flip(laptop.redeem(guess)),
          )
          const locked = yield* Effect.flip(laptop.redeem(fresh.code))
          expect(locked.failure._tag).toBe('TooManyTries')
        }),
      ),
  )
})

describe('the wire protocol', () => {
  it.effect('client and server messages round trip as JSON', () =>
    Effect.gen(function* () {
      const hello = {
        _tag: 'Hello' as const,
        protocol: 1,
        scope: 'player:abc',
        lastSeq: 3,
        mode: 'Catchup' as const,
        clientId: 'tab',
        token: 'token',
        versions: { ChangedSettings: 1 },
      }
      const json = yield* encodeClientMessage(hello)
      const value_4 = yield* decodeClientMessage(json)
      expect(value_4).toEqual(hello)
      const ack = { _tag: 'Acked' as const, id: 'mutation-0001', seq: 4 }
      const value_6 = yield* encodeServerMessage(ack)
      const value_5 = yield* decodeServerMessage(value_6)
      expect(value_5).toEqual(ack)
      expect(ClientMessageJson).toBeDefined()
      expect(ServerMessageJson).toBeDefined()
    }),
  )

  it.effect('malformed messages are refused', () =>
    Effect.gen(function* () {
      const bad = yield* Effect.exit(
        decodeClientMessage('{"_tag":"Push","mutations":[{"id":"x"}]}'),
      )
      const shortId = yield* Effect.exit(
        decodeServerMessage('{"_tag":"Acked","id":"short","seq":1}'),
      )
      const notJson = yield* Effect.exit(decodeClientMessage('nope'))
      expect(Exit.isFailure(bad)).toBe(true)
      expect(Exit.isFailure(shortId)).toBe(true)
      expect(Exit.isFailure(notJson)).toBe(true)
    }),
  )
})
