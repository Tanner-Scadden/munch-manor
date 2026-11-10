import {
  Array,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Schedule,
  Stream,
  String,
} from 'effect'
import { SqlClient } from 'effect/sql'

import { describe, expect, it, test } from '@effect/vitest'
import { SqliteClient } from '@munch/sqlite-wasm-effect'
import { makeHub } from '@munch/sqlite-wasm-effect/in-process'
import {
  Actor,
  type Authenticate,
  type Mutation,
  type ScopeServer,
  Unauthorized,
  encodeArgs,
  makeReplica,
  makeScopeServer,
  startSync,
} from '@munch/sync-engine'
import { makeHost } from '@munch/sync-engine/in-process'
import { first, settle } from '@munch/sync-engine/testing'

import {
  ChangedMemberCalling,
  ChangedMemberName,
  ChangedModifiers,
  ChangedPicks,
  ChangedReady,
  CreatedRoom,
  EndedGame,
  JoinedRoom,
  KickedPlayer,
  LeftRoom,
  type Lobby,
  RecordedRoomResult,
  RoomScope,
  cleanCalling,
  cleanRank,
  displayName,
  isOpenToQuickPlay,
  lobbyOfSnapshot,
  normalizeRoomCode,
  roomCodeFromBytes,
  roomCodeOfScope,
  roomScopeId,
} from '../src/index'

const CODE = 'KX7PQ'
const SCOPE = roomScopeId(CODE)
const [ANA, BO, CY, DEE, EVE] = ['ana', 'bo', 'cy', 'dee', 'eve']

const openDatabase = () =>
  Effect.gen(function* () {
    const hub = yield* makeHub()
    const context = yield* Effect.orDie(Layer.build(hub.layer()))
    return Context.get(context, SqlClient.SqlClient)
  })

const openServer = Effect.gen(function* () {
  const sql = yield* openDatabase()
  return yield* Effect.provideService(
    makeScopeServer({ definition: RoomScope, scope: SCOPE }),
    SqlClient.SqlClient,
    sql,
  )
})

const lobbyOf = (server: ScopeServer) =>
  Effect.map(server.snapshot, snapshot =>
    snapshot._tag === 'Snapshot'
      ? Option.getOrThrow(lobbyOfSnapshot(snapshot.tables))
      : Option.getOrThrow(Option.none<Lobby>()),
  )

const device = (playerId: string) =>
  Actor.cases.Device.make({ playerId, deviceId: `${playerId}-device` })

let counter = 0

const push = <A, I>(
  server: ScopeServer,
  playerId: string,
  mutation: Mutation<string, A, I>,
  args: NoInfer<A>,
) =>
  Effect.gen(function* () {
    counter += 1
    const result = yield* server.push(device(playerId), [
      {
        id: `mutation-${String.padStart(4, '0')(counter.toString())}`,
        name: mutation.name,
        version: mutation.version,
        args: yield* encodeArgs(mutation, args),
      },
    ])
    return result.replies[0]?._tag === 'Rejected'
      ? `Rejected: ${result.replies[0].code} ${result.replies[0].reason}`
      : 'Acked'
  })

const seat = (server: ScopeServer, playerId: string) =>
  Effect.gen(function* () {
    yield* server.addMember(playerId)
    counter += 1
    return yield* server.runServer(
      JoinedRoom,
      {
        playerId,
        name: `  ${playerId}\u0000  the   great one `,
        look: playerId === BO ? 'Female.Bun.Pink.Tan.Teal' : 'not a <look>',
        rank: playerId === BO ? 12 : playerId === CY ? 5000 : 3,
        calling:
          playerId === BO
            ? 'LineCook'
            : playerId === CY
              ? 'not a <calling>'
              : 'TrackStar',
        nightmare: playerId === CY,
      },
      `joined-room-${counter}`,
    )
  })

const createdBy = (hostNightmare: boolean) =>
  Effect.gen(function* () {
    const server = yield* openServer
    yield* server.addMember(ANA)
    const outcome = yield* server.runServer(
      CreatedRoom,
      {
        code: CODE,
        host: ANA,
        hostName: 'Ana',
        hostLook: 'Male.Crop.Brown.Light.Blue',
        hostRank: 40,
        hostCalling: 'Handyman',
        hostNightmare,
        mode: 'Campaign',
        visibility: 'Private',
      },
      'created-room',
    )
    expect(outcome._tag).toBe('Applied')
    return server
  })

const created = createdBy(false)

describe('display names', () => {
  test('are cleaned, cut to 12 characters, and default by seat', () => {
    expect(displayName('  Big\u0007  Zed  ', 1)).toBe('Big Zed')
    expect(displayName('abcdefghijklmnop', 0)).toBe('abcdefghijkl')
    expect(displayName('\u200b \n ', 2)).toBe('Player 3')
    expect(displayName('🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟', 0)).toBe(
      '🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟',
    )
  })
})

describe('room codes', () => {
  test('five symbols from the pairing alphabet', () => {
    expect(roomCodeFromBytes(new Uint8Array([0, 1, 31, 32, 255]))).toBe('AB9A9')
    expect(normalizeRoomCode(' kx7-pq ')).toEqual(Option.some(CODE))
    expect(normalizeRoomCode('KX0PQ')).toEqual(Option.none())
    expect(normalizeRoomCode('KX7PQQ')).toEqual(Option.none())
    expect(roomCodeOfScope(SCOPE)).toEqual(Option.some(CODE))
    expect(roomCodeOfScope('room:kx7pq')).toEqual(Option.none())
    expect(roomCodeOfScope(`player:${CODE}`)).toEqual(Option.none())
  })
})

describe('the room scope', () => {
  it.effect(
    'the creator hosts in slot 0, and joiners take the free slots up to 4',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* seat(server, CY)
        yield* seat(server, DEE)
        const full = yield* seat(server, EVE)
        expect(full).toMatchObject({
          _tag: 'Refused',
          reason: 'The room is full',
        })
        const lobby = yield* lobbyOf(server)
        expect(lobby.host).toBe(ANA)
        expect(lobby.status).toBe('Lobby')
        expect(
          Array.map(lobby.members, member => [
            member.playerId,
            member.slot,
            member.name,
          ]),
        ).toEqual([
          [ANA, 0, 'Ana'],
          [BO, 1, 'bo the great'],
          [CY, 2, 'cy the great'],
          [DEE, 3, 'dee the grea'],
        ])
        expect(Array.map(lobby.members, member => member.look)).toEqual([
          'Male.Crop.Brown.Light.Blue',
          'Female.Bun.Pink.Tan.Teal',
          '',
          '',
        ])
        // NOTE: a rank is for show, so the scope only keeps it in range.
        expect(Array.map(lobby.members, member => member.rank)).toEqual([
          40, 12, 999, 3,
        ])
        // NOTE: a calling is text the scope keeps when it is one short
        // word; the Worker checks it against the game's callings.
        expect(Array.map(lobby.members, member => member.calling)).toEqual([
          'Handyman',
          'LineCook',
          'You',
          'TrackStar',
        ])
      }),
  )

  it('cleanCalling keeps one short word and else reads as YOU', () => {
    expect(
      Array.map(
        [
          'Handyman',
          'LineCook',
          '',
          'two words',
          'Line.Cook',
          String.repeat(25)('x'),
        ],
        cleanCalling,
      ),
    ).toEqual(['Handyman', 'LineCook', 'You', 'You', 'You', 'You'])
  })

  it('cleanRank keeps a whole number from 1 to 999', () => {
    expect(
      Array.map([0, -5, 1, 7.9, 999, 1000, Number.NaN, Infinity], cleanRank),
    ).toEqual([1, 1, 1, 7, 999, 999, 1, 1])
  })

  // NOTE: a member row written before the rank and calling columns (a room
  // already open when the migrations ran) is seated as rank 1 and YOU by the
  // columns' defaults.
  it.effect('a member row from before ranks reads as rank 1 and YOU', () =>
    Effect.gen(function* () {
      const sql = yield* openDatabase()
      const server = yield* Effect.provideService(
        makeScopeServer({ definition: RoomScope, scope: SCOPE }),
        SqlClient.SqlClient,
        sql,
      )
      yield* server.addMember(ANA)
      yield* server.runServer(
        CreatedRoom,
        {
          code: CODE,
          host: ANA,
          hostName: 'Ana',
          hostLook: '',
          hostRank: 9,
          hostCalling: 'LineCook',
          hostNightmare: false,
          mode: 'Campaign',
          visibility: 'Private',
        },
        'created-room',
      )
      yield* sql`INSERT INTO members (player_id, name, slot, ready, joined_ms)
        VALUES ('old', 'Old', 1, 0, 5)`
      const lobby = yield* lobbyOf(server)
      expect(Array.map(lobby.members, member => member.rank)).toEqual([9, 1])
      expect(Array.map(lobby.members, member => member.calling)).toEqual([
        'LineCook',
        'You',
      ])
    }),
  )

  it.effect('a player sets only their own READY', () =>
    Effect.gen(function* () {
      const server = yield* created
      yield* seat(server, BO)
      const value = yield* push(server, BO, ChangedReady, {
        by: BO,
        ready: true,
      })
      expect(value).toBe('Acked')
      const value_1 = yield* push(server, BO, ChangedReady, {
        by: ANA,
        ready: true,
      })
      expect(value_1).toMatch(/^Rejected: Forbidden/)
      const value_2 = yield* push(server, EVE, ChangedReady, {
        by: EVE,
        ready: true,
      })
      expect(value_2).toMatch(/^Rejected: Forbidden/)
      const lobby = yield* lobbyOf(server)
      expect(Array.map(lobby.members, member => member.ready)).toEqual([
        false,
        true,
      ])
    }),
  )

  it.effect(
    'the run starts when everyone is READY, and nobody joins mid-run',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        expect((yield* lobbyOf(server)).status).toBe('Lobby')
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        const lobby = yield* lobbyOf(server)
        expect(lobby.status).toBe('Playing')
        expect(lobby.round).toBe(1)
        expect(Array.every(lobby.members, member => !member.ready)).toBe(true)
        const value_3 = yield* seat(server, CY)
        expect(value_3).toMatchObject({ _tag: 'Refused' })
        const value_4 = yield* push(server, BO, ChangedReady, {
          by: BO,
          ready: true,
        })
        expect(value_4).toMatch(/Not in the lobby/)
      }),
  )

  it.effect(
    'a run records its result, and everyone READY again keeps going',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        const value_5 = yield* push(server, BO, EndedGame, { by: BO })
        expect(value_5).toMatch(/Only the host/)
        const value_6 = yield* push(server, ANA, EndedGame, { by: ANA })
        expect(value_6).toBe('Acked')
        yield* server.runServer(
          RecordedRoomResult,
          {
            result: {
              round: 1,
              reason: 'EndedByHost',
              ticks: 900,
              scores: [
                { playerId: ANA, slot: 0, score: 3 },
                { playerId: BO, slot: 1, score: 5 },
              ],
            },
          },
          'recorded-result-1',
        )
        const back = yield* lobbyOf(server)
        expect(back.status).toBe('Lobby')
        expect(
          Option.map(back.result, result => result.scores[1]?.score),
        ).toEqual(Option.some(5))
        const value_7 = yield* seat(server, CY)
        expect(value_7).toMatchObject({ _tag: 'Applied' })
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        yield* push(server, CY, ChangedReady, { by: CY, ready: true })
        const again = yield* lobbyOf(server)
        expect(again.status).toBe('Playing')
        expect(again.round).toBe(2)
      }),
  )

  it.effect(
    'the host picks the mode and difficulty, which takes back READY',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        const fresh = yield* lobbyOf(server)
        expect([fresh.mode, fresh.difficulty]).toEqual(['Campaign', 'Normal'])
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        const value_8 = yield* push(server, BO, ChangedPicks, {
          by: BO,
          mode: 'Endless',
          difficulty: 'Hard',
        })
        expect(value_8).toMatch(/Only the host/)
        const value_9 = yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'KeepGoing',
          difficulty: 'Normal',
        })
        expect(value_9).toMatch(/No run to keep going/)
        const value_10 = yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'Endless',
          difficulty: 'Hard',
        })
        expect(value_10).toBe('Acked')
        const picked = yield* lobbyOf(server)
        expect([picked.mode, picked.difficulty]).toEqual(['Endless', 'Hard'])
        expect(Array.map(picked.members, member => member.ready)).toEqual([
          false,
          false,
        ])
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'Endless',
          difficulty: 'Hard',
        })
        expect(
          Array.map((yield* lobbyOf(server)).members, member => member.ready),
        ).toEqual([false, true])
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        expect((yield* lobbyOf(server)).status).toBe('Playing')
        const value_11 = yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'Campaign',
          difficulty: 'Easy',
        })
        expect(value_11).toMatch(/Not in the lobby/)
      }),
  )

  it.effect(
    'the host picks the run modifiers, which takes back READY, and nobody else may',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        expect((yield* lobbyOf(server)).modifiers).toBe(0)
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        const value_12 = yield* push(server, BO, ChangedModifiers, {
          by: BO,
          modifiers: 8,
        })
        expect(value_12).toMatch(/Only the host/)
        expect((yield* lobbyOf(server)).modifiers).toBe(0)
        const value_13 = yield* push(server, ANA, ChangedModifiers, {
          by: ANA,
          modifiers: 9,
        })
        expect(value_13).toBe('Acked')
        const picked = yield* lobbyOf(server)
        expect(picked.modifiers).toBe(9)
        expect(Array.map(picked.members, member => member.ready)).toEqual([
          false,
          false,
        ])
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        yield* push(server, ANA, ChangedModifiers, { by: ANA, modifiers: 9 })
        expect(
          Array.map((yield* lobbyOf(server)).members, member => member.ready),
        ).toEqual([false, true])
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        expect((yield* lobbyOf(server)).status).toBe('Playing')
        const value_14 = yield* push(server, ANA, ChangedModifiers, {
          by: ANA,
          modifiers: 0,
        })
        expect(value_14).toMatch(/Not in the lobby/)
        expect((yield* lobbyOf(server)).modifiers).toBe(9)
      }),
  )

  it.effect('a mask no modifier has is refused before it is written', () =>
    Effect.gen(function* () {
      const server = yield* created
      const tooBig = yield* Effect.exit(
        push(server, ANA, ChangedModifiers, { by: ANA, modifiers: 16 }),
      )
      const negative = yield* Effect.exit(
        push(server, ANA, ChangedModifiers, { by: ANA, modifiers: -1 }),
      )
      expect(Exit.isFailure(tooBig)).toBe(true)
      expect(Exit.isFailure(negative)).toBe(true)
      expect((yield* lobbyOf(server)).modifiers).toBe(0)
    }),
  )

  it.effect(
    'a player picks their own calling in the lobby, and only theirs',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        const callings = Effect.map(lobbyOf(server), lobby =>
          Array.map(lobby.members, member => member.calling),
        )
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        const value_15 = yield* push(server, BO, ChangedMemberCalling, {
          by: BO,
          calling: 'LineCook',
        })
        expect(value_15).toBe('Acked')
        const callings_1 = yield* callings
        expect(callings_1).toEqual(['Handyman', 'LineCook'])
        // NOTE: the pick is the player's own, so nobody's READY goes.
        expect(
          Array.map((yield* lobbyOf(server)).members, member => member.ready),
        ).toEqual([false, true])
        // NOTE: a word that is not one short word is cleaned to YOU, as at
        // create and join; the Worker decodes the rest when the host starts.
        yield* push(server, BO, ChangedMemberCalling, {
          by: BO,
          calling: 'not a calling!',
        })
        const callings_2 = yield* callings
        expect(callings_2).toEqual(['Handyman', 'You'])
        const value_16 = yield* push(server, ANA, ChangedMemberCalling, {
          by: BO,
          calling: 'LineCook',
        })
        expect(value_16).not.toBe('Acked')
        const value_17 = yield* push(server, CY, ChangedMemberCalling, {
          by: CY,
          calling: 'LineCook',
        })
        expect(value_17).toMatch(/Not in this room|member/i)
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        expect((yield* lobbyOf(server)).status).toBe('Playing')
        const value_18 = yield* push(server, BO, ChangedMemberCalling, {
          by: BO,
          calling: 'TrackStar',
        })
        expect(value_18).toMatch(/Not in the lobby/)
      }),
  )

  it.effect(
    'a player renames themselves in the lobby, and only themselves',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        const names = Effect.map(lobbyOf(server), lobby =>
          Array.map(lobby.members, member => member.name),
        )
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        const value_19 = yield* push(server, BO, ChangedMemberName, {
          by: BO,
          name: '  Gravy   Dave ',
        })
        expect(value_19).toBe('Acked')
        expect((yield* names)[1]).toBe('Gravy Dave')
        // NOTE: the name is the player's own, so nobody's READY goes.
        expect(
          Array.map((yield* lobbyOf(server)).members, member => member.ready),
        ).toEqual([false, true])
        // NOTE: too long is cut to the limit, as at join; empty is "Player N".
        yield* push(server, BO, ChangedMemberName, {
          by: BO,
          name: 'Extraordinarily Long Name',
        })
        expect((yield* names)[1]).toBe('Extraordinar')
        yield* push(server, BO, ChangedMemberName, { by: BO, name: '   ' })
        expect((yield* names)[1]).toBe('Player 2')
        const value_20 = yield* push(server, ANA, ChangedMemberName, {
          by: BO,
          name: 'Mine',
        })
        expect(value_20).not.toBe('Acked')
        const value_21 = yield* push(server, CY, ChangedMemberName, {
          by: CY,
          name: 'Cy',
        })
        expect(value_21).toMatch(/Not in this room|member/i)
        expect((yield* names)[1]).toBe('Player 2')
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        const value_22 = yield* push(server, BO, ChangedMemberName, {
          by: BO,
          name: 'Late',
        })
        expect(value_22).toMatch(/Not in the lobby/)
      }),
  )

  it.effect('Nightmare is for a host the room found it unlocked for', () =>
    Effect.gen(function* () {
      const locked = yield* created
      yield* seat(locked, CY)
      const nightmare = (server: ScopeServer, by: string) =>
        push(server, by, ChangedPicks, {
          by,
          mode: 'Campaign',
          difficulty: 'Nightmare',
        })
      const value_23 = yield* nightmare(locked, ANA)
      expect(value_23).toMatch(/Nightmare is locked/)
      expect((yield* lobbyOf(locked)).difficulty).toBe('Normal')

      const unlocked = yield* createdBy(true)
      yield* seat(unlocked, BO)
      const value_24 = yield* nightmare(unlocked, ANA)
      expect(value_24).toBe('Acked')
      yield* push(unlocked, ANA, ChangedReady, { by: ANA, ready: true })
      yield* push(unlocked, BO, ChangedReady, { by: BO, ready: true })
      expect((yield* lobbyOf(unlocked)).status).toBe('Playing')
      yield* unlocked.runServer(
        RecordedRoomResult,
        { result: { round: 1, reason: 'Won', ticks: 9, scores: [] } },
        'recorded-result-won',
      )
      const won = yield* lobbyOf(unlocked)
      expect([won.mode, won.difficulty]).toEqual(['Campaign', 'Nightmare'])
      yield* push(unlocked, BO, ChangedReady, { by: BO, ready: true })
      yield* push(unlocked, ANA, LeftRoom, { by: ANA })
      const handed = yield* lobbyOf(unlocked)
      expect(handed.host).toBe(BO)
      expect([handed.mode, handed.difficulty, handed.canKeepGoing]).toEqual([
        'Campaign',
        'Hard',
        false,
      ])
      const value_25 = yield* nightmare(unlocked, BO)
      expect(value_25).toMatch(/Nightmare is locked/)
    }),
  )

  it.effect('a won campaign is an escape, with no run kept to go on', () =>
    Effect.gen(function* () {
      const server = yield* created
      yield* seat(server, BO)
      yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
      yield* push(server, BO, ChangedReady, { by: BO, ready: true })
      yield* server.runServer(
        RecordedRoomResult,
        { result: { round: 1, reason: 'Won', ticks: 900, scores: [] } },
        'recorded-result-1',
      )
      const won = yield* lobbyOf(server)
      expect([won.mode, won.canKeepGoing]).toEqual(['Campaign', false])
      const value_26 = yield* push(server, ANA, ChangedPicks, {
        by: ANA,
        mode: 'KeepGoing',
        difficulty: 'Normal',
      })
      expect(value_26).toMatch(/No run to keep going/)
    }),
  )

  it.effect(
    'a public room is open to QUICK PLAY only in its lobby with a seat',
    () =>
      Effect.gen(function* () {
        const server = yield* openServer
        yield* server.addMember(ANA)
        yield* server.runServer(
          CreatedRoom,
          {
            code: CODE,
            host: ANA,
            hostName: 'Ana',
            hostLook: 'Male.Crop.Brown.Light.Blue',
            hostRank: 1,
            hostCalling: 'You',
            hostNightmare: false,
            mode: 'Campaign',
            visibility: 'Public',
          },
          'created-room',
        )
        const value_27 = yield* lobbyOf(server)
        expect(isOpenToQuickPlay(value_27)).toBe(true)
        yield* seat(server, BO)
        yield* seat(server, CY)
        yield* seat(server, DEE)
        const value_28 = yield* lobbyOf(server)
        expect(isOpenToQuickPlay(value_28)).toBe(false)
      }),
  )

  it.effect(
    'the host kicks; a host who leaves hands over; the last out closes',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* seat(server, CY)
        const value_29 = yield* push(server, BO, KickedPlayer, {
          by: BO,
          playerId: CY,
        })
        expect(value_29).toMatch(/Only the host/)
        const value_30 = yield* push(server, ANA, KickedPlayer, {
          by: ANA,
          playerId: CY,
        })
        expect(value_30).toBe('Acked')
        const value_31 = yield* push(server, ANA, LeftRoom, { by: ANA })
        expect(value_31).toBe('Acked')
        const handed = yield* lobbyOf(server)
        expect(handed.host).toBe(BO)
        expect(Array.map(handed.members, member => member.playerId)).toEqual([
          BO,
        ])
        const value_32 = yield* push(server, BO, LeftRoom, { by: BO })
        expect(value_32).toBe('Acked')
        expect((yield* lobbyOf(server)).status).toBe('Closed')
      }),
  )

  it.effect('a Replica follows the room, as the game will', () =>
    Effect.gen(function* () {
      const authenticate: Authenticate = token =>
        token.length > 0
          ? Effect.succeed(
              Actor.cases.Device.make({
                playerId: token,
                deviceId: `${token}-d`,
              }),
            )
          : Effect.fail(Unauthorized.make({ reason: 'No token' }))
      const host = yield* makeHost({
        definitions: [RoomScope],
        openDatabase,
        authenticate,
      })
      const server = yield* host.server(SCOPE)
      yield* server.addMember(ANA)
      yield* server.runServer(
        CreatedRoom,
        {
          code: CODE,
          host: ANA,
          hostName: 'Ana',
          hostLook: 'Male.Crop.Brown.Light.Blue',
          hostRank: 1,
          hostCalling: 'You',
          hostNightmare: false,
          mode: 'Campaign',
          visibility: 'Private',
        },
        'created-room',
      )
      yield* seat(server, BO)
      const hub = yield* makeHub()
      const context = yield* Effect.orDie(Layer.build(hub.layer()))
      const client = Context.get(context, SqliteClient)
      const replica = yield* makeReplica({
        definition: RoomScope,
        database: {
          sql: client.sql,
          changes: client.changes,
          role: Effect.succeed('Leader'),
        },
        scope: SCOPE,
      })
      const network = yield* host.network()
      yield* startSync({
        replica,
        transports: [network.transport],
        credentials: Effect.succeed({ token: BO, clientId: 'bo-tab' }),
        backoff: Schedule.spaced('15 millis'),
      })
      yield* first(replica.status, status => status._tag === 'Ready')
      yield* replica.run(ChangedReady, { by: BO, ready: true })
      // NOTE: the row reads ready on the device, then on the server.
      yield* first(
        Stream.filterEffect(
          Stream.concat(Stream.make(undefined), replica.remoteChanges),
          () =>
            Effect.map(
              Effect.orDie(
                client.sql`SELECT ready FROM members WHERE player_id = ${BO}`,
              ),
              rows => rows[0]?.['ready'] === 1,
            ),
        ),
        () => true,
      )
      const lobby = yield* settle(
        Effect.repeat(lobbyOf(server), {
          until: ({ members }) =>
            Option.exists(
              Array.findFirst(members, member => member.playerId === BO),
              member => member.ready,
            ),
          schedule: Schedule.spaced('10 millis'),
        }),
      )
      expect(
        Option.map(
          Array.findFirst(lobby.members, member => member.playerId === BO),
          member => member.ready,
        ),
      ).toEqual(Option.some(true))
    }),
  )
})
