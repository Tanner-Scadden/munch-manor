import { Array } from 'effect'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'

import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'
import { describe, expect, it } from '@effect/vitest'
import {
  ExchangeReply,
  encodeArgs,
  generateKey,
  importKey,
  makeChallenge,
  makeDirectory,
  sessionMessage,
} from '@munch/sync-engine'

import { ChangedSettings, PlayerScope } from '../../src/playerScope.ts'
import {
  type DirectoryHost,
  type Linked,
  SessionResponseJson,
  SyncCallFailed,
  authenticateWith,
  encodeNightmareAnswer,
  handleDirectory,
  isNightmareUnlockedIn,
  makeDirectoryHost,
  makeScopeHost,
  nightmareUnlockedIn,
  playerScopeId,
  playerScopeOf,
  readNightmareUnlock,
  setupOnce,
} from './syncCore.ts'
import {
  decodeTagged,
  fakeSocket,
  fromJson,
  memory,
  toJson,
} from './testing.ts'

const decodeCode = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ code: Schema.String })),
)

const decodeSession = Schema.decodeEffect(
  Schema.fromJsonString(SessionResponseJson),
)

const decodeExchange = Schema.decodeEffect(Schema.fromJsonString(ExchangeReply))

const SECRET = 'infra-sync-test-secret'

const textOf = (response: Response) => Effect.promise(() => response.text())

const codeOf = (response: Response) =>
  Effect.flatMap(textOf(response), decodeCode)

const sessionOf = (response: Response) =>
  Effect.flatMap(textOf(response), decodeSession)

const directoryOn = Effect.flatMap(memory, sql =>
  Effect.provideService(makeDirectory(SECRET), SqlClient.SqlClient, sql),
)

const sessionBody = (playerId: string) =>
  Effect.gen(function* () {
    const stored = yield* generateKey
    const key = yield* importKey(stored)
    const nowMs = yield* Clock.currentTimeMillis
    const nonce = yield* makeChallenge(SECRET, nowMs)
    const signature = yield* key.sign(sessionMessage(nonce, playerId))
    return toJson({
      publicKey: stored.publicKey,
      playerId,
      nonce,
      signature,
    })
  })

const signedIn = (
  directory: Effect.Success<typeof directoryOn>,
  playerId: string,
) =>
  Effect.gen(function* () {
    const body = yield* sessionBody(playerId)
    const nowMs = yield* Clock.currentTimeMillis
    const handled = yield* handleDirectory(
      directory,
      SECRET,
      { path: '/sync/session', bearer: Option.none(), body },
      nowMs,
    )
    expect(handled.response.status).toBe(200)
    return yield* sessionOf(handled.response)
  })

const PLAYER = 'AAAAAAAAAAAAAAAAAAAAAA'

describe('the sync Worker', () => {
  it('only player scopes are routed', () => {
    expect(
      playerScopeOf(new URL(`https://x/sync/socket?scope=player:${PLAYER}`)),
    ).toEqual(Option.some(`player:${PLAYER}`))
    expect(
      playerScopeOf(new URL('https://x/sync/socket?scope=room:ABCD')),
    ).toEqual(Option.none())
    expect(playerScopeOf(new URL('https://x/sync/socket'))).toEqual(
      Option.none(),
    )
  })

  it.effect('a device signs in, links, and a stranger is refused', () =>
    Effect.gen(function* () {
      const directory = yield* directoryOn
      const phone = yield* signedIn(directory, PLAYER)
      const laptop = yield* signedIn(directory, 'BBBBBBBBBBBBBBBBBBBBBB')
      const linkAtMs = yield* Clock.currentTimeMillis
      const link = yield* handleDirectory(
        directory,
        SECRET,
        { path: '/sync/link', bearer: Option.some(phone.token), body: '{}' },
        linkAtMs,
      )
      const { code } = yield* codeOf(link.response)
      const redeemAtMs = yield* Clock.currentTimeMillis
      const redeem = yield* handleDirectory(
        directory,
        SECRET,
        {
          path: '/sync/link/redeem',
          bearer: Option.some(laptop.token),
          body: toJson({ code }),
        },
        redeemAtMs,
      )
      expect(redeem.response.status).toBe(200)
      expect(Option.map(redeem.linked, linked => linked.playerId)).toEqual(
        Option.some(PLAYER),
      )
      const strangerAtMs = yield* Clock.currentTimeMillis
      const stranger = yield* handleDirectory(
        directory,
        SECRET,
        { path: '/sync/link', bearer: Option.some('forged.token'), body: '{}' },
        strangerAtMs,
      )
      expect(stranger.response.status).toBe(401)
    }),
  )

  it.effect(
    'a scope host answers a Hello and fans a push out to every socket',
    () =>
      Effect.gen(function* () {
        const directory = yield* directoryOn
        const session = yield* signedIn(directory, PLAYER)
        const sql = yield* memory
        const scope = playerScopeId(PLAYER)
        const host = yield* Effect.provideService(
          makeScopeHost(scope, authenticateWith(SECRET), PlayerScope),
          SqlClient.SqlClient,
          sql,
        )
        const phone = fakeSocket()
        const laptop = fakeSocket()
        const everyone = [phone, laptop]
        const hello = (token: string) =>
          toJson({
            _tag: 'Hello',
            protocol: 1,
            scope,
            lastSeq: 0,
            mode: 'Catchup',
            clientId: 'tab',
            token,
            versions: {},
          })
        yield* host.onMessage(phone, hello(session.token), everyone)
        yield* host.onMessage(laptop, hello('forged.token'), everyone)
        expect(phone.connection._tag).toBe('Joined')
        expect(laptop.connection._tag).toBe('Opened')
        expect(fromJson(laptop.sent[0] ?? '{}')).toMatchObject({
          _tag: 'Failed',
          code: 'Unauthorized',
        })

        const args = yield* encodeArgs(ChangedSettings, {
          settings: {
            sound: 'Muted',
            music: 'On',
            shake: 'On',
            shareStats: 'On',
            cursor: 'Bold',
          },
        })
        const push = toJson({
          _tag: 'Push',
          mutations: [
            { id: 'mutation-0001', name: 'ChangedSettings', version: 2, args },
          ],
        })
        yield* host.onMessage(phone, push, everyone)
        const tags = Array.map(phone.sent, text => decodeTagged(text)._tag)
        expect(tags).toEqual(['Deltas', 'Deltas', 'Acked'])

        const reply = yield* host.exchange(
          `[${hello(session.token)}]`,
          everyone,
        )
        const replyText = yield* textOf(reply)
        const messages = yield* decodeExchange(replyText)
        expect(messages[0]).toMatchObject({ _tag: 'Deltas', head: 1 })

        const unlocked = yield* nightmareUnlockedIn(host)
        expect(unlocked).toBe(false)
        expect(
          isNightmareUnlockedIn({ player: [{ nightmare: 'Unlocked' }] }),
        ).toBe(true)
        expect(
          isNightmareUnlockedIn({ player: [{ nightmare: 'Locked' }] }),
        ).toBe(false)
        expect(isNightmareUnlockedIn({})).toBe(false)
        const asked: Array<Readonly<Record<string, string>>> = []
        const answer = yield* encodeNightmareAnswer(true)
        const answered = yield* readNightmareUnlock((_scope, _url, headers) => {
          asked.push(headers)
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(answer),
          })
        }, PLAYER)
        expect(answered).toBe(true)
        expect(asked).toEqual([{ 'x-sync-scope': scope }])
        const whenDown = yield* readNightmareUnlock(
          () => Promise.reject(new Error('down')),
          PLAYER,
        )
        expect(whenDown).toBe(false)
        const whenRefused = yield* readNightmareUnlock(
          () => Promise.resolve({ ok: false, text: () => Promise.resolve('') }),
          PLAYER,
        )
        expect(whenRefused).toBe(false)

        yield* host.linkedDevices(2, 'linked-x-2', everyone)
        expect(fromJson(phone.sent.at(-1) ?? '{}')).toMatchObject({
          _tag: 'Deltas',
          deltas: [{ name: 'LinkedDevices', origin: 'Server' }],
        })
      }),
  )
})

// NOTE: a SQLite layer whose first build fails, as a Durable Object's
// storage can on a cold start, and whose later builds work.
const flakySql = () => {
  const counts = { builds: 0 }
  const layer = Layer.unwrap(
    Effect.sync(() => {
      counts.builds += 1
      return counts.builds === 1
        ? SyncCallFailed.make({ step: 'open', cause: 'cold' }).pipe(
            Effect.fail,
            Layer.effectDiscard,
            Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
          )
        : SqliteClient.layer({ filename: ':memory:' })
    }),
  )
  return { layer, counts }
}

const post = (
  host: DirectoryHost,
  path: string,
  body: string,
  token: Option.Option<string> = Option.none(),
) =>
  host.fetch(
    new Request(`https://sync${path}`, {
      method: 'POST',
      body,
      headers: Option.match(token, {
        onNone: () => ({}),
        onSome: value => ({ authorization: `Bearer ${value}` }),
      }),
    }),
  )

describe('a sync Durable Object', () => {
  it.effect('a failed setup is not kept: the next request builds again', () =>
    Effect.gen(function* () {
      const sql = flakySql()
      const host = yield* makeDirectoryHost({
        sql: sql.layer,
        secret: SECRET,
        tellScope: () => Effect.void,
      })
      const first = yield* post(host, '/sync/link', '{}')
      expect(first.status).toBe(500)
      const second = yield* post(host, '/sync/link', '{}')
      expect(second.status).toBe(401)
      const third = yield* post(host, '/sync/link', '{}')
      expect(third.status).toBe(401)
      expect(sql.counts.builds).toBe(2)
    }),
  )

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
        const second = yield* once
        expect(second).toBe(2)
        const third = yield* once
        expect(third).toBe(2)
        expect(closed).toEqual(['attempt 1'])
      }),
  )

  it.effect('a link still succeeds when telling the scope fails', () =>
    Effect.gen(function* () {
      const told: Array<Linked> = []
      const host = yield* makeDirectoryHost({
        sql: SqliteClient.layer({ filename: ':memory:' }),
        secret: SECRET,
        tellScope: linked =>
          Effect.suspend(() => {
            told.push(linked)
            return Effect.fail(
              SyncCallFailed.make({ step: 'tell the scope', cause: 'down' }),
            )
          }),
      })
      const phoneBody = yield* sessionBody(PLAYER)
      const phoneSignIn = yield* post(host, '/sync/session', phoneBody)
      const phone = yield* sessionOf(phoneSignIn)
      const laptopBody = yield* sessionBody('BBBBBBBBBBBBBBBBBBBBBB')
      const laptopSignIn = yield* post(host, '/sync/session', laptopBody)
      const laptop = yield* sessionOf(laptopSignIn)
      const link = yield* post(
        host,
        '/sync/link',
        '{}',
        Option.some(phone.token),
      )
      const { code } = yield* codeOf(link)
      const redeem = yield* post(
        host,
        '/sync/link/redeem',
        toJson({ code }),
        Option.some(laptop.token),
      )
      expect(redeem.status).toBe(200)
      const redeemed = yield* sessionOf(redeem)
      expect(redeemed.playerId).toBe(PLAYER)
      expect(Array.map(told, linked => linked.playerId)).toEqual([PLAYER])
    }),
  )
})
