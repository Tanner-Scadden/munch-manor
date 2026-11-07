import { Array } from 'effect'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'

import { describe, expect, it } from '@effect/vitest'
import { Matchmaking, RoomRefusal, type RoomTicket } from '@munch/netcode'

import { type MatchmakerIo, makeMatchmakerHost } from './matchmakerCore.ts'

// NOTE: the Matchmaker core with fake rooms and sockets: what it sends, who
// it seats where, and the rooms it makes.

interface Fake {
  state: Matchmaking.Matchmaker
  readonly sent: Array<[string, Matchmaking.QuickServer]>
  readonly closed: Array<string>
  readonly made: Array<ReadonlyArray<string>>
  readonly seated: Array<[string, string]>
  readonly alarms: Array<number>
  fullRooms: Set<string>
  failMaking: boolean
}

const ok = (ticket: RoomTicket): Result.Result<RoomTicket, RoomRefusal> =>
  Result.succeed(ticket)
const no = (refusal: RoomRefusal): Result.Result<RoomTicket, RoomRefusal> =>
  Result.fail(refusal)

const fakeIo = (fake: Fake): MatchmakerIo => ({
  load: Effect.sync(() => fake.state),
  save: next =>
    Effect.sync(() => {
      fake.state = next
    }),
  send: (socket, message) =>
    Effect.sync(() => void fake.sent.push([socket, message])),
  close: socket => Effect.sync(() => void fake.closed.push(socket)),
  seat: (player, code) =>
    Effect.sync(() => {
      if (fake.fullRooms.has(code)) {
        return no(RoomRefusal.cases.Full.make({}))
      }
      fake.seated.push([player.socket, code])
      return ok({ code, slot: 1 })
    }),
  makeRoom: players =>
    Effect.sync(() => {
      if (fake.failMaking) {
        return Result.fail(RoomRefusal.cases.Unavailable.make({}))
      }
      fake.made.push(Array.map(players, player => player.socket))
      return Result.succeed({
        code: 'NEWRM',
        tickets: Array.map(players, (player, slot) => ({
          socket: player.socket,
          ticket: ok({ code: 'NEWRM', slot }),
        })),
      })
    }),
  wakeAt: atMs => Effect.sync(() => void fake.alarms.push(atMs)),
})

const setUp = Effect.gen(function* () {
  const fake: Fake = {
    state: Matchmaking.emptyMatchmaker,
    sent: [],
    closed: [],
    made: [],
    seated: [],
    alarms: [],
    fullRooms: new Set(),
    failMaking: false,
  }
  const host = yield* makeMatchmakerHost(fakeIo(fake))
  const arrive = (n: number) =>
    host.run((matchmaker, nowMs) =>
      Matchmaking.arrive(
        matchmaker,
        {
          socket: `s${n}`,
          playerId: `p${n}`,
          name: `Zed ${n}`,
          queuedMs: nowMs,
        },
        nowMs,
      ),
    )
  const leave = (n: number) =>
    host.run((matchmaker, nowMs) =>
      Matchmaking.leave(matchmaker, `s${n}`, nowMs),
    )
  const list = (code: string, members: number, open = true) =>
    host.run((matchmaker, nowMs) =>
      Matchmaking.listed(matchmaker, { code, members, open }, nowMs),
    )
  return { fake, arrive, leave, list }
})

const lastWaiting = (fake: Fake, socket: string) =>
  Array.map(
    Array.filter(
      fake.sent,
      ([to, message]) => to === socket && message._tag === 'Waiting',
    ),
    ([, message]) => message,
  ).at(-1)

describe('the Matchmaker', () => {
  it.effect('four arrivals make a room, and each hears Matched', () =>
    Effect.gen(function* () {
      const { fake, arrive } = yield* setUp
      yield* arrive(1)
      yield* arrive(2)
      yield* arrive(3)
      expect(lastWaiting(fake, 's3')).toMatchObject({
        waiting: 3,
        position: 3,
        names: ['Zed 1', 'Zed 2', 'Zed 3'],
      })
      expect(fake.alarms.length).toBeGreaterThan(0)
      yield* arrive(4)
      expect(fake.made).toEqual([['s1', 's2', 's3', 's4']])
      expect(fake.closed).toEqual(['s1', 's2', 's3', 's4'])
      expect(
        Array.filter(fake.sent, ([, message]) => message._tag === 'Matched')
          .length,
      ).toBe(4)
      expect(fake.state.queue).toEqual([])
    }),
  )

  it.effect(
    'a dropped socket mid-queue leaves it, and the others hear the new count',
    () =>
      Effect.gen(function* () {
        const { fake, arrive, leave } = yield* setUp
        yield* arrive(1)
        yield* arrive(2)
        yield* arrive(3)
        yield* leave(2)
        expect(lastWaiting(fake, 's3')).toMatchObject({
          waiting: 2,
          position: 2,
        })
        yield* arrive(4)
        yield* arrive(5)
        expect(fake.made).toEqual([['s1', 's3', 's4', 's5']])
      }),
  )

  it.effect(
    'a seat that opens goes to the first in line; a full room is skipped',
    () =>
      Effect.gen(function* () {
        const { fake, arrive, list } = yield* setUp
        yield* arrive(1)
        yield* arrive(2)
        fake.fullRooms.add('FULLR')
        yield* list('FULLR', 3)
        yield* list('OPENR', 2)
        expect(fake.seated).toEqual([
          ['s1', 'OPENR'],
          ['s2', 'OPENR'],
        ])
        expect(Array.map(fake.state.rooms, room => room.code)).toEqual([
          'OPENR',
        ])
      }),
  )

  it.effect('a room that cannot be made says so to its players', () =>
    Effect.gen(function* () {
      const { fake, arrive } = yield* setUp
      fake.failMaking = true
      yield* arrive(1)
      yield* arrive(2)
      yield* arrive(3)
      yield* arrive(4)
      expect(
        Array.map(
          Array.filter(fake.sent, ([, message]) => message._tag === 'Refused'),
          ([to]) => to,
        ),
      ).toEqual(['s1', 's2', 's3', 's4'])
      expect(fake.state.queue).toEqual([])
    }),
  )
})
