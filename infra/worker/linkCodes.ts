import { Array, Function, String } from 'effect'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import * as SqlClient from 'effect/sql/SqlClient'

import type {
  DurableObjectNamespace,
  DurableObjectState,
} from '@cloudflare/workers-types'
import { CODE_ALPHABET } from '@munch/netcode'

import {
  LINK_REDEEM_PATH,
  LinkCode,
  RedeemAnswer,
  RedeemRequest,
  SessionRefused,
} from '../../src/shared/records/sessionApi.ts'
import type { RateLimiter } from './api.ts'
import {
  CORS_HEADERS,
  type SyncSetupFailed,
  buildOn,
  json,
  setupOnce,
  sqlOf,
  tryCall,
} from './syncCore.ts'

const LINK_CODE_LENGTH = 6
export const LINK_CODE_TTL_MS = 10 * 60 * 1000
const MAX_DRAWS = 8
const LINK_CODES_NAME = 'link-codes'
const ISSUE_PATH = '/internal/link/issue'

const IssueRequest = Schema.Struct({
  publicKey: Schema.String,
  identity: Schema.String,
})
type IssueRequest = typeof IssueRequest.Type

const IssueJson = Schema.fromJsonString(IssueRequest)
const LinkCodeJson = Schema.fromJsonString(LinkCode)
const RedeemRequestJson = Schema.fromJsonString(RedeemRequest)
const RedeemAnswerJson = Schema.fromJsonString(RedeemAnswer)

const encodeAnswer = (answer: RedeemAnswer): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(RedeemAnswerJson)(answer))

const refused = (problem: SessionRefused['problem']): RedeemAnswer =>
  RedeemAnswer.cases.Refused.make({ problem })

const codeOfBytes = (bytes: Uint8Array): string =>
  Array.join(
    Array.map(globalThis.Array.from(bytes), byte =>
      Option.getOrElse(String.charAt(CODE_ALPHABET, byte & 31), () => 'A'),
    ),
    '',
  )

const drawCode = Effect.sync(() =>
  codeOfBytes(SecureRandom.randomBytesUnsafe(LINK_CODE_LENGTH)),
)

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`)

export const normalizeLinkCode = (text: string): Option.Option<string> =>
  Option.liftPredicate(
    String.replace(/[\s-]/g, '')(String.toUpperCase(text)),
    code => CODE_PATTERN.test(code),
  )

const IdentityRow = Schema.Struct({ identity: Schema.String })
const decodeIdentityRows = Schema.decodeUnknownEffect(Schema.Array(IdentityRow))

export interface LinkCodeBook {
  readonly issue: (
    request: IssueRequest,
  ) => Effect.Effect<LinkCode, SessionRefused>
  readonly redeem: (code: string) => Effect.Effect<RedeemAnswer>
}

export const sessionUnavailable = () =>
  SessionRefused.make({ problem: 'Unavailable' })

export const makeLinkCodeBook: Effect.Effect<
  LinkCodeBook,
  never,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* Effect.orDie(sql`CREATE TABLE IF NOT EXISTS link_codes (
    code TEXT PRIMARY KEY,
    public_key TEXT NOT NULL UNIQUE,
    identity TEXT NOT NULL,
    expires_ms INTEGER NOT NULL
  )`)

  const insertOnce = (request: IssueRequest, expiresMs: number) =>
    Effect.flatMap(drawCode, code =>
      sql`INSERT INTO link_codes (code, public_key, identity, expires_ms)
        VALUES (${code}, ${request.publicKey}, ${request.identity}, ${expiresMs})
        ON CONFLICT DO NOTHING RETURNING code`.pipe(
        Effect.map(rows =>
          rows.length === 0 ? Option.none<string>() : Option.some(code),
        ),
      ),
    )

  const issue = (request: IssueRequest) =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis
      const expiresMs = nowMs + LINK_CODE_TTL_MS
      yield* sql`DELETE FROM link_codes
        WHERE public_key = ${request.publicKey} OR expires_ms <= ${nowMs}`
      const code = yield* insertOnce(request, expiresMs).pipe(
        Effect.repeat({
          until: Option.isSome,
          times: MAX_DRAWS - 1,
        }),
        Effect.flatMap(Effect.fromOption),
      )
      return { code, expiresMs }
    }).pipe(Effect.mapError(sessionUnavailable))

  const redeem = (text: string): Effect.Effect<RedeemAnswer> =>
    Option.match(normalizeLinkCode(text), {
      onNone: () => Effect.succeed(refused('WrongCode')),
      onSome: code =>
        Effect.gen(function* () {
          const nowMs = yield* Clock.currentTimeMillis
          const rows = yield* sql`DELETE FROM link_codes
            WHERE code = ${code} RETURNING identity, expires_ms AS expiresMs`
          const live = yield* decodeIdentityRows(
            Array.filter(
              rows,
              row =>
                typeof row['expiresMs'] === 'number' &&
                row['expiresMs'] > nowMs,
            ),
          )
          return Option.match(Array.head(live), {
            onNone: () => refused('WrongCode'),
            onSome: row =>
              RedeemAnswer.cases.Redeemed.make({ identity: row.identity }),
          })
        }).pipe(Effect.orElseSucceed(() => refused('Unavailable'))),
    })

  return { issue, redeem }
})

type LinkAnswer = Readonly<{
  status: number
  text: () => Promise<string>
}>

export type LinkStore = Readonly<{
  call: (path: string, body: string) => Promise<LinkAnswer>
}>

export const linkStoreOf = (namespace: DurableObjectNamespace): LinkStore => ({
  call: (path, body) =>
    namespace
      .get(namespace.idFromName(LINK_CODES_NAME))
      .fetch(`https://link${path}`, { method: 'POST', body }),
})

export type LinkBindings = Readonly<{
  limiter: RateLimiter
  store: LinkStore
}>

export const issueLinkCodeVia: {
  (
    request: IssueRequest,
  ): (store: LinkStore) => Effect.Effect<LinkCode, SessionRefused>
  (
    store: LinkStore,
    request: IssueRequest,
  ): Effect.Effect<LinkCode, SessionRefused>
} = Function.dual(
  2,
  (
    store: LinkStore,
    request: IssueRequest,
  ): Effect.Effect<LinkCode, SessionRefused> =>
    Effect.gen(function* () {
      const body = yield* Schema.encodeEffect(IssueJson)(request)
      const response = yield* tryCall('ask for a link code', () =>
        store.call(ISSUE_PATH, body),
      )
      const text = yield* tryCall('read the link code', () => response.text())
      return yield* Schema.decodeEffect(LinkCodeJson)(text)
    }).pipe(Effect.mapError(sessionUnavailable)),
)

const answerResponse = (answer: RedeemAnswer): Effect.Effect<Response> =>
  Effect.map(encodeAnswer(answer), body =>
    json(
      RedeemAnswer.match(answer, {
        Redeemed: () => 200,
        Refused: ({ problem }) => (problem === 'TooManyTries' ? 429 : 400),
      }),
      body,
    ),
  )

const isWithinRate = (env: LinkBindings, request: Request) => {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  return tryCall('check the rate limit', () =>
    env.limiter.limit({ key: `link:${address}` }),
  ).pipe(
    Effect.map(outcome => outcome.success),
    Effect.catchTag('SyncCallFailed', error =>
      Effect.as(
        Effect.logWarning(
          'The link rate limiter failed, so the request goes through',
          error.cause,
        ),
        true,
      ),
    ),
  )
}

const redeemVia = (env: LinkBindings, request: Request) =>
  Effect.gen(function* () {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (request.method !== 'POST') {
      return json(405, '{}')
    }
    if (!(yield* isWithinRate(env, request))) {
      return yield* answerResponse(refused('TooManyTries'))
    }
    const body = yield* tryCall('read the body', () => request.text())
    const response = yield* tryCall('redeem the code', () =>
      env.store.call(LINK_REDEEM_PATH, body),
    )
    const text = yield* tryCall('read the answer', () => response.text())
    return new Response(text, {
      status: response.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }).pipe(
    Effect.catchTag('SyncCallFailed', () =>
      answerResponse(refused('Unavailable')),
    ),
  )

export const routeLink: {
  (
    env: LinkBindings,
  ): (request: Request) => Effect.Effect<Option.Option<Response>>
  (request: Request, env: LinkBindings): Effect.Effect<Option.Option<Response>>
} = Function.dual(
  2,
  (
    request: Request,
    env: LinkBindings,
  ): Effect.Effect<Option.Option<Response>> =>
    Effect.suspend(() =>
      new URL(request.url).pathname === LINK_REDEEM_PATH
        ? Effect.asSome(redeemVia(env, request))
        : Effect.succeedNone,
    ),
)

export const handleLinkCall: {
  (request: Request): (book: LinkCodeBook) => Effect.Effect<Response>
  (book: LinkCodeBook, request: Request): Effect.Effect<Response>
} = Function.dual(
  2,
  (book: LinkCodeBook, request: Request): Effect.Effect<Response> =>
    Effect.gen(function* () {
      const pathname = new URL(request.url).pathname
      const text = yield* tryCall('read the body', () => request.text())
      if (pathname === ISSUE_PATH) {
        const issued = yield* Effect.flatMap(
          Schema.decodeEffect(IssueJson)(text),
          book.issue,
        )
        const body = yield* Schema.encodeEffect(LinkCodeJson)(issued)
        return json(200, body)
      }
      if (pathname === LINK_REDEEM_PATH) {
        const answer = yield* Option.match(
          Schema.decodeOption(RedeemRequestJson)(text),
          {
            onNone: () => Effect.succeed(refused('WrongCode')),
            onSome: ({ code }) => book.redeem(code),
          },
        )
        return yield* answerResponse(answer)
      }
      return json(404, '{}')
    }).pipe(Effect.orElseSucceed(() => json(503, '{}'))),
)

export class LinkCodes {
  private readonly book: Effect.Effect<LinkCodeBook, SyncSetupFailed>

  constructor(ctx: DurableObjectState) {
    this.book = Effect.runSync(
      sqlOf(ctx.storage).pipe(buildOn(makeLinkCodeBook), setupOnce),
    )
  }

  fetch(request: Request): Promise<Response> {
    return Effect.runPromise(
      Effect.flatMap(this.book, book => handleLinkCall(book, request)).pipe(
        Effect.orElseSucceed(() => json(503, '{}')),
      ),
    )
  }
}
