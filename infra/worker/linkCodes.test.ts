import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as TestClock from 'effect/testing/TestClock'

import { describe, expect, it } from '@effect/vitest'

import {
  LINK_REDEEM_PATH,
  LinkCode,
  RedeemAnswer,
  RedeemRequest,
  SessionRefused,
} from '../../src/shared/sessionApi.ts'
import {
  LINK_CODE_TTL_MS,
  type LinkStore,
  handleLinkCall,
  issueLinkCodeVia,
  normalizeLinkCode,
  routeLink,
} from './linkCodes.ts'
import { signToken, verifyToken } from './sessionToken.ts'
import { setupOnce } from './syncCore.ts'
import { linkCodeBook } from './testing.ts'

const SECRET = 'link-codes-test-secret'
const IDENTITY = 'identity-of-the-phone'
const PUBLIC_KEY = 'phone-public-key'

const encodeRedeem = Schema.encodeEffect(Schema.fromJsonString(RedeemRequest))
const decodeAnswer = Schema.decodeEffect(Schema.fromJsonString(RedeemAnswer))
const decodeLinkCode = Schema.decodeEffect(Schema.fromJsonString(LinkCode))

const answerOf = (response: Response) =>
  Effect.flatMap(
    Effect.promise(() => response.text()),
    decodeAnswer,
  )

const limiterOf = (allowed: number) => {
  const keys: Array<string> = []
  return {
    keys,
    limit: ({ key }: { key: string }) => {
      keys.push(key)
      return Promise.resolve({ success: keys.length <= allowed })
    },
  }
}

const redeemRequest = (code: string) =>
  Effect.map(
    encodeRedeem({ code }),
    body =>
      new Request(`https://api${LINK_REDEEM_PATH}`, {
        method: 'POST',
        body,
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      }),
  )

describe('link codes', () => {
  it.effect('a code is six letters from the code alphabet, typed loosely', () =>
    Effect.sync(() => {
      expect(normalizeLinkCode(' abc-23x ')).toEqual(Option.some('ABC23X'))
      expect(normalizeLinkCode('ABC10X')).toEqual(Option.none())
      expect(normalizeLinkCode('ABC2')).toEqual(Option.none())
    }),
  )

  it.effect(
    'a code the object issues redeems once through it, then is gone',
    () =>
      Effect.gen(function* () {
        const book = yield* linkCodeBook
        const issue = new Request('https://link/internal/link/issue', {
          method: 'POST',
          body: `{"publicKey":"${PUBLIC_KEY}","identity":"${IDENTITY}"}`,
        })
        const issued = yield* Effect.flatMap(
          Effect.flatMap(handleLinkCall(book, issue), response =>
            Effect.promise(() => response.text()),
          ),
          decodeLinkCode,
        )
        const redeem = (code: string) =>
          Effect.flatMap(
            Effect.map(
              encodeRedeem({ code }),
              body =>
                new Request(`https://link${LINK_REDEEM_PATH}`, {
                  method: 'POST',
                  body,
                }),
            ),
            request => handleLinkCall(book, request),
          )
        const first = yield* redeem(issued.code)
        expect(first.status).toBe(200)
        const seen1 = yield* answerOf(first)
        expect(seen1).toEqual(
          RedeemAnswer.cases.Redeemed.make({ identity: IDENTITY }),
        )
        const again = yield* redeem(issued.code)
        expect(again.status).toBe(400)
        const seen2 = yield* answerOf(again)
        expect(seen2).toEqual(
          RedeemAnswer.cases.Refused.make({ problem: 'WrongCode' }),
        )
      }),
  )

  it.effect(
    'the route forwards a redeem to the object and counts it against the address',
    () =>
      Effect.gen(function* () {
        const forwarded: Array<readonly [string, string]> = []
        const answer = '{"_tag":"Redeemed","identity":"x"}'
        const store: LinkStore = {
          call: (path, body) => {
            forwarded.push([path, body])
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve(answer),
            })
          },
        }
        const limiter = limiterOf(10)
        const request = yield* redeemRequest('ABCDEF')
        const routed = yield* routeLink(request, { limiter, store })
        const response = yield* Effect.fromOption(routed)
        expect(response.status).toBe(200)
        const seen3 = yield* Effect.promise(() => response.text())
        expect(seen3).toBe(answer)
        expect(forwarded).toEqual([[LINK_REDEEM_PATH, '{"code":"ABCDEF"}']])
        expect(limiter.keys).toEqual(['link:203.0.113.7'])
      }),
  )

  it.effect('a wrong code is refused', () =>
    Effect.gen(function* () {
      const book = yield* linkCodeBook
      yield* book.issue({ publicKey: PUBLIC_KEY, identity: IDENTITY })
      const seen4 = yield* book.redeem('ZZZZZZ')
      expect(seen4).toEqual(
        RedeemAnswer.cases.Refused.make({ problem: 'WrongCode' }),
      )
      const seen5 = yield* book.redeem('not a code')
      expect(seen5).toEqual(
        RedeemAnswer.cases.Refused.make({ problem: 'WrongCode' }),
      )
    }),
  )

  it.effect('a new code replaces the old one', () =>
    Effect.gen(function* () {
      const book = yield* linkCodeBook
      const old = yield* book.issue({ publicKey: PUBLIC_KEY, identity: IDENTITY })
      const fresh = yield* book.issue({
        publicKey: PUBLIC_KEY,
        identity: IDENTITY,
      })
      const seen6 = yield* book.redeem(old.code)
      expect(seen6).toEqual(
        old.code === fresh.code
          ? RedeemAnswer.cases.Redeemed.make({ identity: IDENTITY })
          : RedeemAnswer.cases.Refused.make({ problem: 'WrongCode' }),
      )
    }),
  )

  it.effect('a code is refused once its ten minutes are up', () =>
    Effect.gen(function* () {
      const book = yield* linkCodeBook
      const issued = yield* book.issue({
        publicKey: PUBLIC_KEY,
        identity: IDENTITY,
      })
      yield* TestClock.adjust(LINK_CODE_TTL_MS)
      const seen7 = yield* book.redeem(issued.code)
      expect(seen7).toEqual(
        RedeemAnswer.cases.Refused.make({ problem: 'WrongCode' }),
      )
    }),
  )

  it.effect('an address past its rate limit is told to wait, and the store is never asked', () =>
    Effect.gen(function* () {
      const asked: Array<string> = []
      const store: LinkStore = {
        call: path => {
          asked.push(path)
          return Promise.resolve({ status: 200, text: () => Promise.resolve('{}') })
        },
      }
      const routed = yield* Effect.flatMap(redeemRequest('ABCDEF'), request =>
        routeLink(request, { limiter: limiterOf(0), store }),
      )
      const response = yield* Effect.fromOption(routed)
      expect(response.status).toBe(429)
      const seen8 = yield* answerOf(response)
      expect(seen8).toEqual(
        RedeemAnswer.cases.Refused.make({ problem: 'TooManyTries' }),
      )
      expect(asked).toEqual([])
    }),
  )

  it.effect('a store that cannot answer makes the issue Unavailable', () =>
    Effect.gen(function* () {
      const store: LinkStore = {
        call: () => Promise.reject(new Error('down')),
      }
      const error = yield* Effect.flip(
        issueLinkCodeVia(store, { publicKey: PUBLIC_KEY, identity: IDENTITY }),
      )
      expect(error).toEqual(SessionRefused.make({ problem: 'Unavailable' }))
    }),
  )

  it.effect('other paths are not the link route', () =>
    Effect.gen(function* () {
      const routed = yield* routeLink(
        new Request('https://api/link/elsewhere', { method: 'POST' }),
        { limiter: limiterOf(10), store: { call: () => Promise.reject(new Error('unused')) } },
      )
      expect(routed).toEqual(Option.none())
    }),
  )
})

describe('session tokens', () => {
  it.effect('a token verifies with its secret until it expires', () =>
    Effect.gen(function* () {
      const claims = { deviceId: 'device', playerId: 'player', expiresMs: 1000 }
      const token = yield* signToken(SECRET, claims)
      const seen9 = yield* verifyToken(SECRET, token, 999)
      expect(seen9).toEqual(claims)
      const late = yield* Effect.exit(verifyToken(SECRET, token, 1000))
      expect(Exit.isFailure(late)).toBe(true)
      const forged = yield* Effect.exit(verifyToken('another secret', token, 0))
      expect(Exit.isFailure(forged)).toBe(true)
    }),
  )
})

describe('setupOnce', () => {
  it.effect(
    'a failed setup closes its scope, and a success keeps its scope open',
    () =>
      Effect.gen(function* () {
        const closed: Array<string> = []
        const attempts = { count: 0 }
        const setup = Effect.gen(function* () {
          attempts.count += 1
          const attempt = attempts.count
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed.push(`attempt ${attempt}`)
            }),
          )
          if (attempt === 1) {
            return yield* Effect.fail('cold storage')
          }
          return attempt
        })
        const once = yield* setupOnce(setup)
        const first = yield* Effect.exit(once)
        expect(Exit.isFailure(first)).toBe(true)
        expect(closed).toEqual(['attempt 1'])
        const seen10 = yield* once
        expect(seen10).toBe(2)
        const seen11 = yield* once
        expect(seen11).toBe(2)
        expect(closed).toEqual(['attempt 1'])
      }),
  )
})
