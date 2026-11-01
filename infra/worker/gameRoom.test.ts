import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as SqlClient from 'effect/sql/SqlClient'

import { describe, expect, it } from '@effect/vitest'
import {
  ChangedReady,
  type ClientFrame,
  KickedPlayer,
  type Lobby,
  PROTOCOL_VERSION as ROOM_PROTOCOL_VERSION,
  RoomScope,
  roomScopeId,
} from '@munch/netcode'
import {
  PROTOCOL_VERSION,
  encodeArgs,
  mutationVersions,
  signToken,
} from '@munch/sync-engine'

import { roomSettingsOf } from '../../src/roomWorld.ts'
import {
  DELETE_AFTER_MS,
  type RoomHost,
  answerHello,
  decideAlarm,
  listingOf,
  lookOfRequest,
  makeRoomHost,
  reactionsOf,
} from './gameRoomCore.ts'
import {
  decodeTagged,
  fakeSocket,
  fromJson,
  memory,
  toJson,
} from './testing.ts'

const SECRET = 'infra-room-test-secret'
const CODE = 'KX7PQ'
const SCOPE = roomScopeId(CODE)
const ANA = 'AAAAAAAAAAAAAAAAAAAAAA'
const BO = 'BBBBBBBBBBBBBBBBBBBBBB'
const CY = 'CCCCCCCCCCCCCCCCCCCCCC'
const DEE = 'DDDDDDDDDDDDDDDDDDDDDD'
const EVE = 'EEEEEEEEEEEEEEEEEEEEEE'

const roomHost = Effect.flatMap(memory, sql =>
  Effect.provideService(makeRoomHost(SCOPE, SECRET), SqlClient.SqlClient, sql),
)

// NOTE: a token that runs out a minute after now, on the TestClock, or at
// `expiresMs` when given.
const tokenOf = (playerId: string, expiresMs?: number) =>
  Effect.flatMap(Clock.currentTimeMillis, nowMs =>
    signToken(SECRET, {
      playerId,
      deviceId: `${playerId}-device`,
      expiresMs: expiresMs ?? nowMs + 60_000,
    }),
  )

const hello = (token: string) =>
  toJson({
    _tag: 'Hello',
    protocol: PROTOCOL_VERSION,
    scope: SCOPE,
    lastSeq: 0,
    mode: 'Snapshot',
    clientId: 'tab',
    token,
    versions: mutationVersions(RoomScope),
  })

const pushOf = <A, I>(
  mutation: Parameters<typeof encodeArgs<A, I>>[0],
  args: A,
  id: string,
) =>
  Effect.map(encodeArgs(mutation, args), encoded =>
    toJson({
      _tag: 'Push',
      mutations: [
        {
          id,
          name: mutation.name,
          version: mutation.version,
          args: encoded,
        },
      ],
    }),
  )

const lobbyOf = (host: RoomHost): Effect.Effect<Lobby> =>
  Effect.map(host.lobby, Option.getOrThrow)

const helloFrame = (
  token: string,
  maxVersion = ROOM_PROTOCOL_VERSION,
): ClientFrame => ({
  _tag: 'Hello',
  minVersion: 1,
  maxVersion,
  token,
})

describe('the room host', () => {
  it.effect('creating seats the host; joining fills slots up to 4', () =>
    Effect.gen(function* () {
      const host = yield* roomHost
      const created = yield* host.create(
        ANA,
        'Ana',
        'Male.Crop.Brown.Light.Blue',
        7,
        'Handyman',
        false,
        CODE,
        'Private',
      )
      expect(created).toEqual(Result.succeed({ code: CODE, slot: 0 }))
      const again = yield* host.create(
        BO,
        'Ana',
        '',
        1,
        'You',
        false,
        CODE,
        'Private',
      )
      expect(Result.isFailure(again)).toBe(true)
      const tickets = yield* Effect.forEach(
        [BO, CY, DEE],
        playerId =>
          host.join(
            playerId,
            'name',
            '',
            playerId === BO ? 12 : 1,
            playerId === BO ? 'LineCook' : 'You',
            false,
            [],
          ),
        { concurrency: 'unbounded' },
      )
      expect(
        tickets.map(result => Result.map(result, ticket => ticket.slot)),
      ).toEqual([Result.succeed(1), Result.succeed(2), Result.succeed(3)])
      const rejoined = yield* host.join(CY, 'name', '', 1, 'You', false, [])
      expect(rejoined).toEqual(Result.succeed({ code: CODE, slot: 2 }))
      const full = yield* host.join(EVE, 'name', '', 1, 'You', false, [])
      expect(full).toEqual(Result.fail({ _tag: 'Full' }))
      const lobby = yield* lobbyOf(host)
      expect(lobby.members.map(member => member.look)).toEqual([
        'Broad.Short.Brown.Light.Blue.AAAA',
        '',
        '',
        '',
      ])
      expect(lobby.members.map(member => member.rank)).toEqual([7, 12, 1, 1])
      expect(lobby.members.map(member => member.calling)).toEqual([
        'Handyman',
        'LineCook',
        'You',
        'You',
      ])
    }),
  )

  // NOTE: a calling is kept only when it reads back as one of the game's
  // callings (src/playerData.ts); a made-up word, a look code, a markup
  // string, or nothing seats the player as YOU. The Worker cannot check the
  // player's rank reached it.
  it.effect(
    'a sent calling is seated only when it is one of the callings',
    () =>
      Effect.gen(function* () {
        const host = yield* roomHost
        yield* host.create(
          ANA,
          'Ana',
          '',
          1,
          'TrackStar',
          false,
          CODE,
          'Private',
        )
        yield* host.join(BO, 'Bo', '', 1, 'Wizard', false, [])
        yield* host.join(CY, 'Cy', '', 1, '<b>LineCook</b>', false, [])
        yield* host.join(DEE, 'Dee', '', 1, 'PennyPincher', false, [])
        const lobby = yield* lobbyOf(host)
        expect(lobby.members.map(member => member.calling)).toEqual([
          'TrackStar',
          'You',
          'You',
          'PennyPincher',
        ])
        expect(
          roomSettingsOf('Campaign', 'Normal', lobby.members).callings,
        ).toEqual([
          { slot: 0, calling: 'TrackStar' },
          { slot: 1, calling: 'You' },
          { slot: 2, calling: 'You' },
          { slot: 3, calling: 'PennyPincher' },
        ])
      }),
  )

  // NOTE: a rank is a claim the Worker cannot check, so it only keeps it in
  // range: a whole number from 1 to 999.
  it.effect('a sent rank is clamped to a whole number from 1 to 999', () =>
    Effect.gen(function* () {
      const host = yield* roomHost
      yield* host.create(ANA, 'Ana', '', 5000, 'You', false, CODE, 'Private')
      yield* host.join(BO, 'Bo', '', -3, 'You', false, [])
      yield* host.join(CY, 'Cy', '', 4.9, 'You', false, [])
      yield* host.join(DEE, 'Dee', '', Number.NaN, 'You', false, [])
      const lobby = yield* lobbyOf(host)
      expect(lobby.members.map(member => member.rank)).toEqual([999, 1, 4, 1])
    }),
  )

  // NOTE: the look a player sends is kept only when it is one of the game's
  // looks (src/playerData.ts): the simple look, or an older code (five
  // words from the first look, or the many-part look's five letters) read
  // as its closest simple look. Anything else seats the player with none.
  it('a sent look is kept when it is a real look, and dropped when it is junk', () => {
    expect(lookOfRequest('Slim.Mohawk.Pink.Deep.Teal.CCBB')).toBe(
      'Slim.Mohawk.Pink.Deep.Teal.CCBB',
    )
    expect(lookOfRequest('Broad.Bald.Grey.Fair.Purple.DAAA')).toBe(
      'Broad.Bald.Grey.Fair.Purple.DAAA',
    )
    expect(lookOfRequest('Slim.Mohawk.Rainbow.Deep.Lilac.JFEDE')).toBe(
      'Slim.Mohawk.Pink.Deep.Purple.CCBA',
    )
    expect(lookOfRequest('Round.Bald.Pastel.Umber.Black.GMBBC')).toBe(
      'Broad.Bald.Pink.Deep.Blue.BCAB',
    )
    expect(lookOfRequest('Female.Ponytail.Pink.Tan.Teal')).toBe(
      'Broad.Ponytail.Pink.Tan.Teal.AAAA',
    )
    expect(lookOfRequest('Male.Curls.Black.Deep.Red')).toBe(
      'Broad.Curly.Black.Deep.Red.AAAA',
    )
    const junks = [
      'Female.Ponytail.Pink.Tan.Plaid',
      'Robot',
      '',
      'Slim.Mohawk.Pink.Deep.Teal',
      'Slim.Mohawk.Pink.Deep.Teal.CCBC',
      'Slim.Mohawk.Pink.Deep.Teal.ECAA',
      'Slim.Mohawk.Pink.Deep.Teal.ADAA',
      'Slim.Mohawk.Pink.Deep.Teal.AAA',
      'Slim.Mohawk.Pink.Deep.Teal.aaaa',
      'Medium.Short.Pink.Deep.Teal.AAAA',
      'Slim.Mohawk.Rainbow.Deep.Lilac.JFEDZ',
      'Slim.Mohawk.Rainbow.Deep.Lilac.AAAAAA',
      'Female.Mohawk.Pink.Deep.Teal.AAAA',
      'Slim.Mohawk.Pink.Deep.Teal.AAAA.AAAA',
    ]
    expect(junks.map(lookOfRequest)).toEqual(junks.map(() => ''))
  })

  it.effect('joining a room that does not exist says so', () =>
    Effect.gen(function* () {
      const host = yield* roomHost
      expect(yield* host.join(BO, 'name', '', 1, 'You', false, [])).toEqual(
        Result.fail({ _tag: 'NoRoom' }),
      )
    }),
  )

  it.effect('members follow the scope; others may not', () =>
    Effect.gen(function* () {
      const host = yield* roomHost
      yield* host.create(ANA, 'Ana', '', 1, 'You', false, CODE, 'Private')
      const member = fakeSocket()
      const stranger = fakeSocket()
      yield* host.scope.onMessage(member, hello(yield* tokenOf(ANA)), [member])
      yield* host.scope.onMessage(stranger, hello(yield* tokenOf(BO)), [
        member,
        stranger,
      ])
      expect(decodeTagged(member.sent[0] ?? '{}')._tag).toBe('Snapshot')
      expect(fromJson(stranger.sent[0] ?? '{}')).toMatchObject({
        _tag: 'Failed',
        code: 'Forbidden',
      })
    }),
  )

  it.effect(
    'a join reaches every joined socket, and the last READY starts the run',
    () =>
      Effect.gen(function* () {
        const host = yield* roomHost
        yield* host.create(ANA, 'Ana', '', 1, 'You', false, CODE, 'Private')
        const ana = fakeSocket()
        yield* host.scope.onMessage(ana, hello(yield* tokenOf(ANA)), [ana])
        yield* host.join(BO, 'name', '', 1, 'You', false, [ana])
        expect(fromJson(ana.sent.at(-1) ?? '{}')).toMatchObject({
          _tag: 'Deltas',
        })
        const bo = fakeSocket()
        yield* host.scope.onMessage(bo, hello(yield* tokenOf(BO)), [ana, bo])
        const ready = yield* host.scope.onMessage(
          bo,
          yield* pushOf(ChangedReady, { by: BO, ready: true }, 'ready-bo-0001'),
          [ana, bo],
        )
        expect(yield* reactionsOf(ready)).toEqual([{ _tag: 'MaybeStart' }])
        expect((yield* lobbyOf(host)).status).toBe('Lobby')
        const started = yield* host.scope.onMessage(
          ana,
          yield* pushOf(
            ChangedReady,
            { by: ANA, ready: true },
            'ready-ana-0001',
          ),
          [ana, bo],
        )
        expect(yield* reactionsOf(started)).toEqual([{ _tag: 'MaybeStart' }])
        expect((yield* lobbyOf(host)).status).toBe('Playing')
        expect(yield* host.join(CY, 'name', '', 1, 'You', false, [])).toEqual(
          Result.fail({ _tag: 'Started' }),
        )
      }),
  )

  it.effect('a kick says who to drop, and a result ends the game', () =>
    Effect.gen(function* () {
      const host = yield* roomHost
      yield* host.create(ANA, 'Ana', '', 1, 'You', false, CODE, 'Private')
      yield* host.join(BO, 'name', '', 1, 'You', false, [])
      const ana = fakeSocket()
      yield* host.scope.onMessage(ana, hello(yield* tokenOf(ANA)), [ana])
      const kicked = yield* host.scope.onMessage(
        ana,
        yield* pushOf(KickedPlayer, { by: ANA, playerId: BO }, 'kick-bo-00001'),
        [ana],
      )
      expect(yield* reactionsOf(kicked)).toEqual([
        { _tag: 'DropPlayer', playerId: BO, kicked: true },
      ])
      yield* host.join(BO, 'name', '', 1, 'You', false, [])
      yield* host.freeSeat(BO, 1, [ana])
      expect(
        (yield* lobbyOf(host)).members.map(member => member.playerId),
      ).toEqual([ANA])
    }),
  )
})

describe('a game socket Hello', () => {
  const lobbyWith = Effect.gen(function* () {
    const host = yield* roomHost
    yield* host.create(ANA, 'Ana', '', 1, 'You', false, CODE, 'Private')
    return yield* host.lobby
  })

  it.effect('is accepted for a member with a good token', () =>
    Effect.gen(function* () {
      const answer = yield* answerHello(
        helloFrame(yield* tokenOf(ANA)),
        SECRET,
        yield* lobbyWith,
        yield* Clock.currentTimeMillis,
      )
      expect(answer).toEqual({
        _tag: 'Accept',
        playerId: ANA,
        slot: 0,
        version: ROOM_PROTOCOL_VERSION,
      })
    }),
  )

  it.effect('is refused for each reason', () =>
    Effect.gen(function* () {
      const lobby = yield* lobbyWith
      const now = yield* Clock.currentTimeMillis
      const answers = yield* Effect.all(
        [
          answerHello({ _tag: 'Leave' }, SECRET, lobby, now),
          answerHello(
            {
              _tag: 'Hello',
              minVersion: 1,
              maxVersion: 1,
              token: yield* tokenOf(ANA),
            },
            SECRET,
            lobby,
            now,
          ),
          answerHello(helloFrame('forged.token'), SECRET, lobby, now),
          answerHello(
            helloFrame(yield* tokenOf(ANA, now - 1)),
            SECRET,
            lobby,
            now,
          ),
          answerHello(helloFrame(yield* tokenOf(BO)), SECRET, lobby, now),
          answerHello(
            helloFrame(yield* tokenOf(ANA)),
            SECRET,
            Option.none(),
            now,
          ),
        ],
        { concurrency: 'unbounded' },
      )
      expect(
        answers.map(answer =>
          answer._tag === 'Refuse' ? answer.reason : 'Accept',
        ),
      ).toEqual([
        'BadMessage',
        'VersionMismatch',
        'Unauthorized',
        'Unauthorized',
        'NotMember',
        'NoRoom',
      ])
    }),
  )
})

describe('the alarm', () => {
  const lobby = (
    status: Lobby['status'],
    updatedMs: number,
  ): Option.Option<Lobby> =>
    Option.some({
      code: CODE,
      host: ANA,
      status,
      visibility: 'Private',
      mode: 'Campaign',
      difficulty: 'Normal',
      canKeepGoing: false,
      round: 1,
      createdMs: 0,
      updatedMs,
      result: Option.none(),
      members: [],
    })

  it('watches a running loop, records a lost game, and deletes old rooms', () => {
    const nowMs = 10 * DELETE_AFTER_MS
    expect(
      decideAlarm({
        nowMs,
        gameRunning: true,
        lobby: lobby('Playing', 0),
        socketsOpen: 2,
      }),
    ).toEqual({ _tag: 'CheckLoop', nextMs: nowMs + 60_000 })
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Playing', nowMs),
        socketsOpen: 0,
      })._tag,
    ).toBe('Interrupted')
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Lobby', 0),
        socketsOpen: 0,
      }),
    ).toEqual({ _tag: 'Delete' })
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Lobby', 0),
        socketsOpen: 1,
      })._tag,
    ).toBe('Later')
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Lobby', nowMs - 1000),
        socketsOpen: 0,
      }),
    ).toEqual({ _tag: 'Later', nextMs: nowMs - 1000 + DELETE_AFTER_MS })
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: Option.none(),
        socketsOpen: 0,
      }),
    ).toEqual({ _tag: 'Delete' })
  })
})

describe('a public room', () => {
  it.effect('lists itself for Quick Play while its lobby has seats', () =>
    Effect.gen(function* () {
      const host = yield* roomHost
      yield* host.create(ANA, 'Ana', '', 1, 'You', false, CODE, 'Public')
      yield* host.join(BO, '  Bo\u0000  ', '', 1, 'You', false, [])
      const lobby = yield* lobbyOf(host)
      expect(lobby.members.map(member => member.name)).toEqual(['Ana', 'Bo'])
      expect(listingOf(lobby)).toEqual(
        Option.some({ code: CODE, members: 2, open: true }),
      )
      yield* host.join(CY, '', '', 1, 'You', false, [])
      yield* host.join(DEE, 'Dee', '', 1, 'You', false, [])
      const full = yield* lobbyOf(host)
      expect(full.members.map(member => member.name)).toEqual([
        'Ana',
        'Bo',
        'Player 3',
        'Dee',
      ])
      expect(listingOf(full)).toEqual(
        Option.some({ code: CODE, members: 4, open: false }),
      )
    }),
  )

  it.effect('a private room never lists itself', () =>
    Effect.gen(function* () {
      const host = yield* roomHost
      yield* host.create(ANA, 'Ana', '', 1, 'You', false, CODE, 'Private')
      expect(listingOf(yield* lobbyOf(host))).toEqual(Option.none())
    }),
  )
})
