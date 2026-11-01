import { Context, Effect, Layer, Option, Schedule, Stream } from 'effect'
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
        id: `mutation-${counter.toString().padStart(4, '0')}`,
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
          lobby.members.map(member => [
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
        expect(lobby.members.map(member => member.look)).toEqual([
          'Male.Crop.Brown.Light.Blue',
          'Female.Bun.Pink.Tan.Teal',
          '',
          '',
        ])
        // NOTE: a rank is for show, so the scope only keeps it in range.
        expect(lobby.members.map(member => member.rank)).toEqual([
          40, 12, 999, 3,
        ])
      }),
  )

  it('cleanRank keeps a whole number from 1 to 999', () => {
    expect(
      [0, -5, 1, 7.9, 999, 1000, Number.NaN, Infinity].map(cleanRank),
    ).toEqual([1, 1, 1, 7, 999, 999, 1, 1])
  })

  // NOTE: a member row written before the rank column (a room already open
  // when the migration ran) is seated as rank 1 by the column's default.
  it.effect('a member row from before ranks reads as rank 1', () =>
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
          hostNightmare: false,
          mode: 'Campaign',
          visibility: 'Private',
        },
        'created-room',
      )
      yield* sql`INSERT INTO members (player_id, name, slot, ready, joined_ms)
        VALUES ('old', 'Old', 1, 0, 5)`
      const lobby = yield* lobbyOf(server)
      expect(lobby.members.map(member => member.rank)).toEqual([9, 1])
    }),
  )

  it.effect('a player sets only their own READY', () =>
    Effect.gen(function* () {
      const server = yield* created
      yield* seat(server, BO)
      expect(
        yield* push(server, BO, ChangedReady, { by: BO, ready: true }),
      ).toBe('Acked')
      expect(
        yield* push(server, BO, ChangedReady, { by: ANA, ready: true }),
      ).toMatch(/^Rejected: Forbidden/)
      expect(
        yield* push(server, EVE, ChangedReady, { by: EVE, ready: true }),
      ).toMatch(/^Rejected: Forbidden/)
      const lobby = yield* lobbyOf(server)
      expect(lobby.members.map(member => member.ready)).toEqual([false, true])
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
        expect(lobby.members.every(member => !member.ready)).toBe(true)
        expect(yield* seat(server, CY)).toMatchObject({ _tag: 'Refused' })
        expect(
          yield* push(server, BO, ChangedReady, { by: BO, ready: true }),
        ).toMatch(/Not in the lobby/)
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
        expect(yield* push(server, BO, EndedGame, { by: BO })).toMatch(
          /Only the host/,
        )
        expect(yield* push(server, ANA, EndedGame, { by: ANA })).toBe('Acked')
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
        expect(yield* seat(server, CY)).toMatchObject({ _tag: 'Applied' })
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
        expect(
          yield* push(server, BO, ChangedPicks, {
            by: BO,
            mode: 'Endless',
            difficulty: 'Hard',
          }),
        ).toMatch(/Only the host/)
        expect(
          yield* push(server, ANA, ChangedPicks, {
            by: ANA,
            mode: 'KeepGoing',
            difficulty: 'Normal',
          }),
        ).toMatch(/No run to keep going/)
        expect(
          yield* push(server, ANA, ChangedPicks, {
            by: ANA,
            mode: 'Endless',
            difficulty: 'Hard',
          }),
        ).toBe('Acked')
        const picked = yield* lobbyOf(server)
        expect([picked.mode, picked.difficulty]).toEqual(['Endless', 'Hard'])
        expect(picked.members.map(member => member.ready)).toEqual([
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
          (yield* lobbyOf(server)).members.map(member => member.ready),
        ).toEqual([false, true])
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        expect((yield* lobbyOf(server)).status).toBe('Playing')
        expect(
          yield* push(server, ANA, ChangedPicks, {
            by: ANA,
            mode: 'Campaign',
            difficulty: 'Easy',
          }),
        ).toMatch(/Not in the lobby/)
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
      expect(yield* nightmare(locked, ANA)).toMatch(/Nightmare is locked/)
      expect((yield* lobbyOf(locked)).difficulty).toBe('Normal')

      const unlocked = yield* createdBy(true)
      yield* seat(unlocked, BO)
      expect(yield* nightmare(unlocked, ANA)).toBe('Acked')
      yield* push(unlocked, ANA, ChangedReady, { by: ANA, ready: true })
      yield* push(unlocked, BO, ChangedReady, { by: BO, ready: true })
      expect((yield* lobbyOf(unlocked)).status).toBe('Playing')
      yield* unlocked.runServer(
        RecordedRoomResult,
        { result: { round: 1, reason: 'Won', ticks: 9, scores: [] } },
        'recorded-result-won',
      )
      const won = yield* lobbyOf(unlocked)
      expect([won.mode, won.difficulty]).toEqual(['KeepGoing', 'Nightmare'])
      yield* push(unlocked, BO, ChangedReady, { by: BO, ready: true })
      yield* push(unlocked, ANA, LeftRoom, { by: ANA })
      const handed = yield* lobbyOf(unlocked)
      expect(handed.host).toBe(BO)
      expect([handed.mode, handed.difficulty, handed.canKeepGoing]).toEqual([
        'Endless',
        'Hard',
        false,
      ])
      expect(handed.members.map(member => member.ready)).toEqual([false])
      expect(yield* nightmare(unlocked, BO)).toMatch(/Nightmare is locked/)
    }),
  )

  it.effect('a won campaign offers to keep going until the crew changes', () =>
    Effect.gen(function* () {
      const server = yield* created
      yield* seat(server, BO)
      const record = (round: number, reason: 'Won' | 'GameOver') =>
        server.runServer(
          RecordedRoomResult,
          { result: { round, reason, ticks: 900, scores: [] } },
          `recorded-result-${round}`,
        )
      const playRound = Effect.gen(function* () {
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
      })
      yield* playRound
      yield* record(1, 'Won')
      const won = yield* lobbyOf(server)
      expect([won.mode, won.canKeepGoing]).toEqual(['KeepGoing', true])
      yield* push(server, ANA, ChangedPicks, {
        by: ANA,
        mode: 'Campaign',
        difficulty: 'Normal',
      })
      expect(
        yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'KeepGoing',
          difficulty: 'Normal',
        }),
      ).toBe('Acked')
      yield* playRound
      expect((yield* lobbyOf(server)).mode).toBe('KeepGoing')
      yield* record(2, 'GameOver')
      const lost = yield* lobbyOf(server)
      expect([lost.mode, lost.canKeepGoing]).toEqual(['Endless', false])
      yield* push(server, ANA, ChangedPicks, {
        by: ANA,
        mode: 'Campaign',
        difficulty: 'Normal',
      })
      yield* playRound
      yield* record(3, 'Won')
      yield* push(server, BO, ChangedReady, { by: BO, ready: true })
      yield* seat(server, CY)
      const joined = yield* lobbyOf(server)
      expect([joined.mode, joined.canKeepGoing]).toEqual(['Endless', false])
      expect(joined.members.map(member => member.ready)).toEqual([
        false,
        false,
        false,
      ])
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
            hostNightmare: false,
            mode: 'Campaign',
            visibility: 'Public',
          },
          'created-room',
        )
        expect(isOpenToQuickPlay(yield* lobbyOf(server))).toBe(true)
        yield* seat(server, BO)
        yield* seat(server, CY)
        yield* seat(server, DEE)
        expect(isOpenToQuickPlay(yield* lobbyOf(server))).toBe(false)
      }),
  )

  it.effect(
    'the host kicks; a host who leaves hands over; the last out closes',
    () =>
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* seat(server, CY)
        expect(
          yield* push(server, BO, KickedPlayer, { by: BO, playerId: CY }),
        ).toMatch(/Only the host/)
        expect(
          yield* push(server, ANA, KickedPlayer, { by: ANA, playerId: CY }),
        ).toBe('Acked')
        expect(yield* push(server, ANA, LeftRoom, { by: ANA })).toBe('Acked')
        const handed = yield* lobbyOf(server)
        expect(handed.host).toBe(BO)
        expect(handed.members.map(member => member.playerId)).toEqual([BO])
        expect(yield* push(server, BO, LeftRoom, { by: BO })).toBe('Acked')
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
          : Effect.fail(new Unauthorized({ reason: 'No token' }))
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
            members.find(member => member.playerId === BO)?.ready === true,
          schedule: Schedule.spaced('10 millis'),
        }),
      )
      expect(lobby.members.find(member => member.playerId === BO)?.ready).toBe(
        true,
      )
    }),
  )
})
