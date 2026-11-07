import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { Matchmaking } from '../src/index'

const {
  OFFER_AFTER_MS,
  OFFER_ANSWER_MS,
  QUICK_PLAY_GROUP_SIZE,
  answer,
  arrive,
  emptyMatchmaker,
  leave,
  listed,
  roomMade,
  seatFailed,
  wake,
} = Matchmaking

type Stepped = Matchmaking.Stepped
type Action = Matchmaking.Action

const T0 = 1_000_000

const player = (n: number, atMs = T0): Matchmaking.Queued => ({
  socket: `s${n}`,
  playerId: `p${n}`,
  name: ` Player\u0000 ${n} `,
  queuedMs: atMs,
})

const arriveAll = (
  start: Matchmaking.Matchmaker,
  numbers: ReadonlyArray<number>,
  atMs = T0,
): Stepped =>
  Array.reduce<number, Stepped>(
    numbers,
    { matchmaker: start, actions: [] },
    (stepped, n) => {
      const next = arrive(stepped.matchmaker, player(n, atMs), atMs)
      return { matchmaker: next.matchmaker, actions: next.actions }
    },
  )

const made = (actions: ReadonlyArray<Action>) =>
  Array.flatMap(actions, action =>
    action._tag === 'MakeRoom'
      ? [Array.map(action.players, queued => queued.socket)]
      : [],
  )

const seats = (actions: ReadonlyArray<Action>) =>
  Array.flatMap(actions, action =>
    action._tag === 'Seat' ? [[action.player.socket, action.code]] : [],
  )

const waitingFor = (actions: ReadonlyArray<Action>, socket: string) =>
  Array.flatMap(actions, action =>
    action._tag === 'Send' &&
    action.socket === socket &&
    action.message._tag === 'Waiting'
      ? [action.message]
      : [],
  )[0]

const queueOf = (stepped: Stepped) =>
  Array.map(stepped.matchmaker.queue, queued => queued.socket)

describe('the Quick Play queue', () => {
  test('one to three players wait, and the fourth makes a room of four', () => {
    const three = arriveAll(emptyMatchmaker, [1, 2, 3])
    expect(queueOf(three)).toEqual(['s1', 's2', 's3'])
    expect(waitingFor(three.actions, 's3')).toMatchObject({
      names: ['Player 1', 'Player 2', 'Player 3'],
      waiting: 3,
      groupSize: QUICK_PLAY_GROUP_SIZE,
      position: 3,
      offerPlayers: 0,
    })
    const four = arrive(three.matchmaker, player(4), T0 + 10)
    expect(made(four.actions)).toEqual([['s1', 's2', 's3', 's4']])
    expect(queueOf(four)).toEqual([])
  })

  test('a cancel or a dropped socket leaves the queue, first come first served', () => {
    const three = arriveAll(emptyMatchmaker, [1, 2, 3])
    const cancelled = leave(three.matchmaker, 's1', T0 + 5)
    expect(queueOf(cancelled)).toEqual(['s2', 's3'])
    expect(waitingFor(cancelled.actions, 's2')).toMatchObject({
      waiting: 2,
      position: 1,
    })
    const dropped = leave(cancelled.matchmaker, 's3', T0 + 6)
    const refilled = arriveAll(dropped.matchmaker, [4, 5, 6], T0 + 7)
    expect(made(refilled.actions)).toEqual([['s2', 's4', 's5', 's6']])
  })

  test('an open public lobby seats players before the queue, fullest first', () => {
    const oneRoom = listed(
      emptyMatchmaker,
      { code: 'AAAAA', members: 1, open: true },
      T0,
    )
    const withRooms = listed(
      oneRoom.matchmaker,
      { code: 'BBBBB', members: 3, open: true },
      T0,
    )
    const first = arrive(withRooms.matchmaker, player(1), T0 + 1)
    expect(seats(first.actions)).toEqual([['s1', 'BBBBB']])
    const second = arrive(first.matchmaker, player(2), T0 + 2)
    expect(seats(second.actions)).toEqual([['s2', 'AAAAA']])
  })

  test('a seat opening while players wait takes the first in line', () => {
    const two = arriveAll(emptyMatchmaker, [1, 2])
    const opened = listed(
      two.matchmaker,
      { code: 'CCCCC', members: 3, open: true },
      T0 + 50,
    )
    expect(seats(opened.actions)).toEqual([['s1', 'CCCCC']])
    expect(queueOf(opened)).toEqual(['s2'])
    const failed = seatFailed(opened.matchmaker, player(1), 'CCCCC', T0 + 60)
    expect(queueOf(failed)).toEqual(['s1', 's2'])
    expect(failed.matchmaker.rooms).toEqual([])
  })

  test('a closed or started room stops taking players', () => {
    const open = listed(
      emptyMatchmaker,
      { code: 'DDDDD', members: 2, open: true },
      T0,
    )
    const started = listed(
      open.matchmaker,
      { code: 'DDDDD', members: 2, open: false },
      T0 + 1,
    )
    const arrived = arrive(started.matchmaker, player(1), T0 + 2)
    expect(seats(arrived.actions)).toEqual([])
  })
})

describe('starting with fewer after a wait', () => {
  test('a lone player is never offered it, but is woken to check', () => {
    const one = arriveAll(emptyMatchmaker, [1])
    const later = wake(one.matchmaker, T0 + OFFER_AFTER_MS + 1)
    expect(Option.isNone(later.matchmaker.offer)).toBe(true)
    expect(waitingFor(later.actions, 's1')?.offerPlayers).toBe(0)
  })

  test('two or three waiting are offered it at the timeout', () => {
    const two = arriveAll(emptyMatchmaker, [1, 2])
    expect(two.actions).toContainEqual({
      _tag: 'WakeAt',
      atMs: T0 + OFFER_AFTER_MS,
    })
    const early = wake(two.matchmaker, T0 + OFFER_AFTER_MS - 1)
    expect(Option.isNone(early.matchmaker.offer)).toBe(true)
    const due = wake(two.matchmaker, T0 + OFFER_AFTER_MS)
    expect(waitingFor(due.actions, 's1')).toMatchObject({
      offerPlayers: 2,
      accepted: 0,
    })
    const three = arriveAll(emptyMatchmaker, [1, 2, 3])
    const offered = wake(three.matchmaker, T0 + OFFER_AFTER_MS)
    expect(waitingFor(offered.actions, 's3')).toMatchObject({ offerPlayers: 3 })
  })

  test('when everyone accepts, they get a room that still takes Quick Play players', () => {
    const offered = wake(
      arriveAll(emptyMatchmaker, [1, 2, 3]).matchmaker,
      T0 + OFFER_AFTER_MS,
    )
    const one = answer(offered.matchmaker, 's1', true, T0 + OFFER_AFTER_MS + 1)
    expect(waitingFor(one.actions, 's2')).toMatchObject({
      offerPlayers: 3,
      accepted: 1,
    })
    const two = answer(one.matchmaker, 's2', true, T0 + OFFER_AFTER_MS + 2)
    const all = answer(two.matchmaker, 's3', true, T0 + OFFER_AFTER_MS + 3)
    expect(made(all.actions)).toEqual([['s1', 's2', 's3']])
    const room = roomMade(all.matchmaker, 'EEEEE', 3, T0 + OFFER_AFTER_MS + 4)
    const late = arrive(room.matchmaker, player(9), T0 + OFFER_AFTER_MS + 5)
    expect(seats(late.actions)).toEqual([['s9', 'EEEEE']])
  })

  test('one who keeps waiting keeps everyone waiting, and no offer comes again for a while', () => {
    const offered = wake(
      arriveAll(emptyMatchmaker, [1, 2]).matchmaker,
      T0 + OFFER_AFTER_MS,
    )
    const accepted = answer(
      offered.matchmaker,
      's1',
      true,
      T0 + OFFER_AFTER_MS + 1,
    )
    const declined = answer(
      accepted.matchmaker,
      's2',
      false,
      T0 + OFFER_AFTER_MS + 2,
    )
    expect(made(declined.actions)).toEqual([])
    expect(queueOf(declined)).toEqual(['s1', 's2'])
    expect(waitingFor(declined.actions, 's1')?.offerPlayers).toBe(0)
    const soon = wake(declined.matchmaker, T0 + OFFER_AFTER_MS + 1000)
    expect(Option.isNone(soon.matchmaker.offer)).toBe(true)
    const again = wake(declined.matchmaker, T0 + 2 * OFFER_AFTER_MS + 2)
    expect(Option.isSome(again.matchmaker.offer)).toBe(true)
  })

  test('an unanswered offer lapses', () => {
    const offered = wake(
      arriveAll(emptyMatchmaker, [1, 2]).matchmaker,
      T0 + OFFER_AFTER_MS,
    )
    const lapsed = wake(
      offered.matchmaker,
      T0 + OFFER_AFTER_MS + OFFER_ANSWER_MS,
    )
    expect(Option.isNone(lapsed.matchmaker.offer)).toBe(true)
    expect(queueOf(lapsed)).toEqual(['s1', 's2'])
  })

  test('a fourth arriving during an offer makes a room of four instead', () => {
    const offered = wake(
      arriveAll(emptyMatchmaker, [1, 2, 3]).matchmaker,
      T0 + OFFER_AFTER_MS,
    )
    const accepted = answer(
      offered.matchmaker,
      's1',
      true,
      T0 + OFFER_AFTER_MS + 1,
    )
    const fourth = arrive(
      accepted.matchmaker,
      player(4, T0 + OFFER_AFTER_MS + 2),
      T0 + OFFER_AFTER_MS + 2,
    )
    expect(made(fourth.actions)).toEqual([['s1', 's2', 's3', 's4']])
    expect(Option.isNone(fourth.matchmaker.offer)).toBe(true)
  })

  test('an offered player who leaves withdraws the offer for the rest', () => {
    const offered = wake(
      arriveAll(emptyMatchmaker, [1, 2, 3]).matchmaker,
      T0 + OFFER_AFTER_MS,
    )
    const left = leave(offered.matchmaker, 's3', T0 + OFFER_AFTER_MS + 1)
    expect(Option.map(left.matchmaker.offer, offer => offer.sockets)).toEqual(
      Option.some(['s1', 's2']),
    )
  })
})

describe('continents', () => {
  const from = (n: number, region: string): Matchmaking.Queued => ({
    ...player(n),
    region,
  })

  const arriveFrom = (players: ReadonlyArray<Matchmaking.Queued>) =>
    Array.reduce<Matchmaking.Queued, Stepped>(
      players,
      { matchmaker: emptyMatchmaker, actions: [] },
      (stepped, queued) => arrive(stepped.matchmaker, queued, T0),
    )

  test('four from one continent play together first', () => {
    const stepped = arriveFrom([
      from(1, 'NA'),
      from(2, 'EU'),
      from(3, 'EU'),
      from(4, 'EU'),
      from(5, 'EU'),
    ])
    expect(made(stepped.actions)).toEqual([['s2', 's3', 's4', 's5']])
    expect(
      Array.map(stepped.matchmaker.queue, queued => queued.socket),
    ).toEqual(['s1'])
  })

  test('a split four waits, then plays together once the wait widens', () => {
    const stepped = arriveFrom([
      from(1, 'NA'),
      from(2, 'EU'),
      from(3, 'EU'),
      from(4, 'AS'),
    ])
    expect(made(stepped.actions)).toEqual([])
    expect(
      Array.filter(stepped.actions, action => action._tag === 'WakeAt'),
    ).toContainEqual({
      _tag: 'WakeAt',
      atMs: T0 + Matchmaking.REGION_WIDEN_MS,
    })
    const widened = wake(stepped.matchmaker, T0 + Matchmaking.REGION_WIDEN_MS)
    expect(made(widened.actions)).toEqual([['s1', 's2', 's3', 's4']])
  })
})
