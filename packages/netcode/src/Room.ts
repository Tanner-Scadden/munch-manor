import { Array, Match, Option, pipe } from 'effect'

import {
  ClientFrame,
  type ClosedReason,
  type InputFrame,
  MAX_RTT_MS,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  type PlayerInput,
  ServerFrame,
} from './Protocol'
import { repeat, writeAll } from './Wire'
import { MAX_VIEW_LAG_TICKS, type PlayerTick, type World } from './World'

// NOTE: the GameRoom's game, as pure functions over plain data, apart from
// the Durable Object that runs them (infra/worker/gameRoom.ts) so tests
// can drive every rule with a fake clock. Each function takes the room and
// the time and returns the next room and what to send, close, or record.
//
// - The tick is a fixed 60 Hz, counted from the start time: `advance` runs
//   as many ticks as the clock owes, at most MAX_CATCH_UP_TICKS at once, so
//   a stalled loop loses time instead of spinning to catch up.
// - Inputs land by tick: each sample becomes a change point, and a player's
//   input on tick T is the newest change point at or before T. A late one
//   takes effect on the next tick, for that player only.
// - About 20 times a second (every TICKS_PER_SEND ticks) every linked
//   player gets a Delta from the world it was last sent, with the newest
//   Input seq the room applied for it. One diff is written and shared.
// - A player who links gets Welcome and a Snapshot of the last world sent,
//   so the next shared Delta applies to it.
// - No word from a linked player for AWAY_AFTER_MS, or its socket closing,
//   makes it Away. Away for FREE_SEAT_AFTER_MS frees its seat.

export const TICK_HZ = 60
export const TICK_MS = 1000 / TICK_HZ
export const TICKS_PER_SEND = 3
export const SEND_MS = TICK_MS * TICKS_PER_SEND
export const AWAY_AFTER_MS = 3000
export const FREE_SEAT_AFTER_MS = 2 * 60 * 1000
export const MAX_CATCH_UP_TICKS = 30
export const MAX_INPUT_LEAD_TICKS = 60
export const MAX_QUEUED_CHANGES = 240
export const MAX_RECEIPTS = 64

export type SocketId = string

export type SeatPresence =
  | { readonly _tag: 'Here' }
  | { readonly _tag: 'Away'; readonly sinceMs: number }

const HERE: SeatPresence = { _tag: 'Here' }
const awaySince = (sinceMs: number): SeatPresence => ({
  _tag: 'Away',
  sinceMs,
})

export interface Change {
  readonly tick: number
  readonly input: PlayerInput
}

export interface Receipt {
  readonly seq: number
  readonly lastTick: number
}

export interface Seat {
  readonly slot: number
  readonly playerId: string
  readonly socket: Option.Option<SocketId>
  readonly presence: SeatPresence
  readonly lastHeardMs: number
  readonly input: PlayerInput
  readonly queued: ReadonlyArray<Change>
  readonly receipts: ReadonlyArray<Receipt>
  readonly ack: number
  readonly rttMs: number
  readonly viewLagTicks: number
}

export interface Room<W> {
  readonly seats: ReadonlyArray<Seat>
  readonly world: W
  readonly tick: number
  readonly startedMs: number
  readonly sentWorld: W
  readonly sentTick: number
}

export interface Scored {
  readonly slot: number
  readonly playerId: string
  readonly score: number
}

export interface Ended {
  readonly _tag: 'Ended'
  readonly reason: ClosedReason
  readonly tick: number
  readonly scores: ReadonlyArray<Scored>
}

export type Out =
  | {
      readonly _tag: 'Send'
      readonly socket: SocketId
      readonly frame: ServerFrame
    }
  | { readonly _tag: 'Close'; readonly socket: SocketId }
  | { readonly _tag: 'FreedSeat'; readonly playerId: string }
  | Ended

export interface Stepped<W> {
  readonly room: Room<W>
  readonly out: ReadonlyArray<Out>
}

export interface Member {
  readonly slot: number
  readonly playerId: string
  readonly socket: Option.Option<SocketId>
}

const send = (socket: SocketId, frame: ServerFrame): Out => ({
  _tag: 'Send',
  socket,
  frame,
})

const close = (socket: SocketId): Out => ({ _tag: 'Close', socket })

const sendToLinked = (
  seats: ReadonlyArray<Seat>,
  frameFor: (seat: Seat) => ServerFrame,
): ReadonlyArray<Out> =>
  Array.getSomes(
    Array.map(seats, seat =>
      Option.map(seat.socket, socket => send(socket, frameFor(seat))),
    ),
  )

const updateSeat = (
  seats: ReadonlyArray<Seat>,
  slot: number,
  update: (seat: Seat) => Seat,
): ReadonlyArray<Seat> =>
  Array.map(seats, seat => (seat.slot === slot ? update(seat) : seat))

const seatOfSocket = (room: Room<unknown>, socket: SocketId) =>
  Array.findFirst(room.seats, seat =>
    Option.exists(seat.socket, linked => linked === socket),
  )

export const seatOfPlayer = <W>(room: Room<W>, playerId: string) =>
  Array.findFirst(room.seats, seat => seat.playerId === playerId)

const welcome = (seat: Seat, tick: number): ServerFrame =>
  ServerFrame.cases.Welcome.make({
    version: PROTOCOL_VERSION,
    slot: seat.slot,
    state: 'Playing',
    tick,
  })

const snapshotFrame = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  seat: Seat,
): ServerFrame =>
  ServerFrame.cases.Snapshot.make({
    tick: room.sentTick,
    ack: seat.ack,
    world: writeAll(writer => world.snapshot(writer, room.sentWorld)),
  })

// START

export const startRoom = <W, Own>(
  world: World<W, Own>,
  members: ReadonlyArray<Member>,
  seed: number,
  nowMs: number,
): Stepped<W> => {
  const first = world.start(
    Array.map(members, member => member.slot),
    seed,
  )
  const seats = Array.map(members, (member): Seat => ({
    slot: member.slot,
    playerId: member.playerId,
    socket: member.socket,
    presence: Option.isSome(member.socket) ? HERE : awaySince(nowMs),
    lastHeardMs: nowMs,
    input: NEUTRAL_INPUT,
    queued: [],
    receipts: [],
    ack: 0,
    rttMs: 0,
    viewLagTicks: 0,
  }))
  const room: Room<W> = {
    seats,
    world: first,
    tick: 0,
    startedMs: nowMs,
    sentWorld: first,
    sentTick: 0,
  }
  return {
    room,
    out: Array.flatMap(seats, seat =>
      Option.match(seat.socket, {
        onNone: () => [],
        onSome: socket => [
          send(socket, welcome(seat, 0)),
          send(socket, snapshotFrame(world, room, seat)),
        ],
      }),
    ),
  }
}

// RESTORE

// NOTE: a room the object lost to a restart (a deploy), put back from a
// checkpoint: the World as it was at `tick`, with every seat Away since
// `nowMs` and no socket linked. Each player who reconnects within
// FREE_SEAT_AFTER_MS links as in any rejoin and gets a Snapshot of this
// World. The clock starts as if the room had run to `tick` just now.
export const restoreRoom = <W>(
  restored: W,
  tick: number,
  members: ReadonlyArray<Pick<Member, 'slot' | 'playerId'>>,
  nowMs: number,
): Room<W> => ({
  seats: Array.map(members, (member): Seat => ({
    slot: member.slot,
    playerId: member.playerId,
    socket: Option.none(),
    presence: awaySince(nowMs),
    lastHeardMs: nowMs,
    input: NEUTRAL_INPUT,
    queued: [],
    receipts: [],
    ack: 0,
    rttMs: 0,
    viewLagTicks: 0,
  })),
  world: restored,
  tick,
  startedMs: nowMs - tick * TICK_MS,
  sentWorld: restored,
  sentTick: tick,
})

// LINKS

// NOTE: a player's game socket said Hello. A newer socket replaces an older
// one (a reload, or a second tab), which is closed. The input queue and the
// seq count start over, since a new socket starts its seqs from 1.
export const link = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  playerId: string,
  socket: SocketId,
  nowMs: number,
): Option.Option<Stepped<W>> =>
  Option.map(seatOfPlayer(room, playerId), seat => {
    const replaced = Option.filter(seat.socket, old => old !== socket)
    const linked: Seat = {
      ...seat,
      socket: Option.some(socket),
      presence: HERE,
      lastHeardMs: nowMs,
      input: NEUTRAL_INPUT,
      queued: [],
      receipts: [],
      ack: 0,
    }
    const seats = updateSeat(room.seats, seat.slot, () => linked)
    const next = { ...room, seats }
    const back =
      seat.presence._tag === 'Away'
        ? sendToLinked(
            Array.filter(seats, other => other.slot !== seat.slot),
            () => ServerFrame.cases.Back.make({ slot: seat.slot }),
          )
        : []
    return {
      room: next,
      out: [
        ...Option.match(replaced, {
          onNone: () => [],
          onSome: old => [close(old)],
        }),
        send(socket, welcome(linked, room.tick)),
        send(socket, snapshotFrame(world, next, linked)),
        ...back,
      ],
    }
  })

const awayOut = (
  seats: ReadonlyArray<Seat>,
  slot: number,
): ReadonlyArray<Out> =>
  sendToLinked(
    Array.filter(seats, other => other.slot !== slot),
    () => ServerFrame.cases.Away.make({ slot }),
  )

// NOTE: a socket closed. Its player is Away at once.
export const unlink = <W>(
  room: Room<W>,
  socket: SocketId,
  nowMs: number,
): Stepped<W> =>
  Option.match(seatOfSocket(room, socket), {
    onNone: () => ({ room, out: [] }),
    onSome: seat => {
      const seats = updateSeat(room.seats, seat.slot, current => ({
        ...current,
        socket: Option.none(),
        presence:
          current.presence._tag === 'Away'
            ? current.presence
            : awaySince(nowMs),
        queued: [],
        receipts: [],
        input: NEUTRAL_INPUT,
      }))
      return {
        room: { ...room, seats },
        out: seat.presence._tag === 'Here' ? awayOut(seats, seat.slot) : [],
      }
    },
  })

// SEATS

const removeSeat = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  seat: Seat,
): Room<W> => ({
  ...room,
  seats: Array.filter(room.seats, other => other.slot !== seat.slot),
  world: world.removePlayer(room.world, seat.slot),
})

// NOTE: the host kicked a player, or they left the room from the lobby.
export const dropPlayer = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  playerId: string,
  kicked: boolean,
): Stepped<W> =>
  Option.match(seatOfPlayer(room, playerId), {
    onNone: () => ({ room, out: [] }),
    onSome: seat => ({
      room: removeSeat(world, room, seat),
      out: Option.match(seat.socket, {
        onNone: () => [],
        onSome: socket =>
          kicked
            ? [send(socket, ServerFrame.cases.Kicked.make({})), close(socket)]
            : [close(socket)],
      }),
    }),
  })

// INPUTS

const changesOf = (
  frame: InputFrame,
  firstTick: number,
): readonly [ReadonlyArray<Change>, number] => {
  const none: readonly [ReadonlyArray<Change>, number] = [[], firstTick]
  return Array.reduce(frame.samples, none, ([changes, tick], sample) => {
    const next: readonly [ReadonlyArray<Change>, number] = [
      Array.append(changes, { tick, input: sample.input }),
      tick + sample.ticks,
    ]
    return next
  })
}

// NOTE: each sample keeps its own tick. Samples for ticks the room already
// ran are late: the newest of them takes effect on the next tick, with any
// button the others pressed, and the rest are dropped, so one slow message
// (a resend holding the socket up) never shifts the ticks of the ones
// on time. A message claiming ticks too far ahead is pulled back whole.
// The new change points replace queued ones at or after their first tick:
// they are newer word about the same ticks.
const pointsOf = (frame: InputFrame, tick: number): ReadonlyArray<Change> => {
  const pulledBack = Math.max(0, frame.tick - (tick + MAX_INPUT_LEAD_TICKS))
  const [points] = changesOf(frame, frame.tick - pulledBack)
  const late = Array.filter(points, point => point.tick <= tick)
  const onTime = Array.filter(points, point => point.tick > tick)
  return Option.match(Array.last(late), {
    onNone: () => onTime,
    onSome: newestLate => {
      const maybeNextOnTime = Option.filter(
        Array.head(onTime),
        first => first.tick === tick + 1,
      )
      const next = Option.match(maybeNextOnTime, {
        onNone: () => newestLate.input,
        onSome: first => first.input,
      })
      const rest = Option.isSome(maybeNextOnTime)
        ? Array.drop(onTime, 1)
        : onTime
      // NOTE: a button pressed and let go inside the late samples (a quick
      // click held up behind a resend) is pressed for the next tick alone,
      // so a late shot fires late instead of not at all.
      const extra =
        Array.reduce(late, 0, (bits, point) => bits | point.input.buttons) &
        ~next.buttons
      const released = Option.exists(
        Array.head(rest),
        after => after.tick === tick + 2,
      )
        ? []
        : [{ tick: tick + 2, input: next }]
      return extra === 0
        ? Array.prepend(rest, { tick: tick + 1, input: next })
        : [
            {
              tick: tick + 1,
              input: { ...next, buttons: next.buttons | extra },
            },
            ...released,
            ...rest,
          ]
    },
  })
}

const enqueue = (seat: Seat, frame: InputFrame, tick: number): Seat => {
  const changes = pointsOf(frame, tick)
  const firstTick = Option.match(Array.head(changes), {
    onNone: () => tick + 1,
    onSome: change => change.tick,
  })
  const lastTick = Option.match(Array.last(changes), {
    onNone: () => tick + 1,
    onSome: change => change.tick,
  })
  const kept = Array.filter(seat.queued, change => change.tick < firstTick)
  return {
    ...seat,
    rttMs: frame.rttMs,
    viewLagTicks: Math.max(
      0,
      Math.min(MAX_VIEW_LAG_TICKS, lastTick - frame.seen),
    ),
    queued: Array.takeRight(Array.appendAll(kept, changes), MAX_QUEUED_CHANGES),
    receipts: Array.takeRight(
      Array.append(seat.receipts, { seq: frame.seq, lastTick }),
      MAX_RECEIPTS,
    ),
  }
}

// NOTE: any frame from a linked player is word from them, and brings an
// Away player back.
const heard = <W>(room: Room<W>, seat: Seat, nowMs: number): Stepped<W> => {
  const seats = updateSeat(room.seats, seat.slot, current => ({
    ...current,
    lastHeardMs: nowMs,
    presence: HERE,
  }))
  return {
    room: { ...room, seats },
    out:
      seat.presence._tag === 'Away'
        ? sendToLinked(
            Array.filter(seats, other => other.slot !== seat.slot),
            () => ServerFrame.cases.Back.make({ slot: seat.slot }),
          )
        : [],
  }
}

export const receive = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  socket: SocketId,
  frame: ClientFrame,
  nowMs: number,
): Stepped<W> =>
  Option.match(seatOfSocket(room, socket), {
    onNone: () => ({ room, out: [] }),
    onSome: seat => {
      const woke = heard(room, seat, nowMs)
      const current = Option.getOrElse(
        seatOfSocket(woke.room, socket),
        () => seat,
      )
      return ClientFrame.match(frame, {
        Input: (input): Stepped<W> => ({
          room: {
            ...woke.room,
            seats: updateSeat(woke.room.seats, seat.slot, () =>
              enqueue(current, input, woke.room.tick),
            ),
          },
          out: woke.out,
        }),
        Ping: ({ rttMs, nonce }): Stepped<W> => ({
          room: {
            ...woke.room,
            seats: updateSeat(woke.room.seats, seat.slot, () => ({
              ...current,
              rttMs,
            })),
          },
          out: [
            ...woke.out,
            send(
              socket,
              ServerFrame.cases.Pong.make({ nonce, tick: woke.room.tick }),
            ),
          ],
        }),
        Leave: (): Stepped<W> => ({
          room: removeSeat(world, woke.room, current),
          out: [
            close(socket),
            { _tag: 'FreedSeat', playerId: current.playerId },
          ],
        }),
        Hello: (): Stepped<W> => woke,
      })
    },
  })

// TICKS

const inputAt = (seat: Seat, tick: number): Seat => {
  const due = Array.filter(seat.queued, change => change.tick <= tick)
  return Option.match(Array.last(due), {
    onNone: () => seat,
    onSome: change => ({
      ...seat,
      input: change.input,
      queued: Array.filter(seat.queued, queued => queued.tick > tick),
    }),
  })
}

const acked = (seat: Seat, tick: number): Seat => {
  const done = Array.filter(seat.receipts, receipt => receipt.lastTick <= tick)
  return Option.match(Array.last(done), {
    onNone: () => seat,
    onSome: receipt => ({
      ...seat,
      ack: Math.max(seat.ack, receipt.seq),
      receipts: Array.filter(seat.receipts, other => other.lastTick > tick),
    }),
  })
}

const tickOf = (seat: Seat): PlayerTick => ({
  slot: seat.slot,
  input: seat.presence._tag === 'Here' ? seat.input : NEUTRAL_INPUT,
  presence: seat.presence._tag,
  viewLagTicks: seat.viewLagTicks,
  rttMs: seat.rttMs,
})

// NOTE: everyone's round trip rides in a Delta about every 2 seconds, for
// the ping bars; it costs nothing billed, since only what players send is.
export const PINGS_EVERY_TICKS = 120

const pingsOf = (room: Room<unknown>) =>
  Math.floor(room.tick / PINGS_EVERY_TICKS) >
  Math.floor(room.sentTick / PINGS_EVERY_TICKS)
    ? Array.map(room.seats, seat => ({
        slot: seat.slot,
        rttMs: Math.min(MAX_RTT_MS, Math.round(seat.rttMs)),
      }))
    : []

const runTick = <W, Own>(world: World<W, Own>, room: Room<W>): Room<W> => {
  const tick = room.tick + 1
  const seats = Array.map(room.seats, seat => inputAt(seat, tick))
  return {
    ...room,
    tick,
    world: world.step(room.world, Array.map(seats, tickOf)),
    seats: Array.map(seats, seat => acked(seat, tick)),
  }
}

const broadcast = <W, Own>(world: World<W, Own>, room: Room<W>): Stepped<W> => {
  const diff = writeAll(writer =>
    world.diff(writer, room.sentWorld, room.world),
  )
  const pings = pingsOf(room)
  return {
    room: { ...room, sentWorld: room.world, sentTick: room.tick },
    out: sendToLinked(room.seats, seat =>
      ServerFrame.cases.Delta.make({
        tick: room.tick,
        base: room.sentTick,
        ack: seat.ack,
        pings,
        diff,
      }),
    ),
  }
}

const isSendTick = (room: Room<unknown>): boolean =>
  Math.floor(room.tick / TICKS_PER_SEND) >
  Math.floor(room.sentTick / TICKS_PER_SEND)

const checkPresence = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  nowMs: number,
): Stepped<W> => {
  const none: Stepped<W> = { room, out: [] }
  return Array.reduce(room.seats, none, (stepped, seat): Stepped<W> =>
    Match.valueTags(seat.presence, {
      Here: (): Stepped<W> => {
        if (nowMs - seat.lastHeardMs <= AWAY_AFTER_MS) {
          return stepped
        }
        const seats = updateSeat(stepped.room.seats, seat.slot, current => ({
          ...current,
          presence: awaySince(nowMs),
        }))
        return {
          room: { ...stepped.room, seats },
          out: [...stepped.out, ...awayOut(seats, seat.slot)],
        }
      },
      Away: ({ sinceMs }): Stepped<W> =>
        nowMs - sinceMs > FREE_SEAT_AFTER_MS
          ? {
              room: removeSeat(world, stepped.room, seat),
              out: [
                ...stepped.out,
                ...Option.match(seat.socket, {
                  onNone: () => [],
                  onSome: socket => [close(socket)],
                }),
                { _tag: 'FreedSeat', playerId: seat.playerId },
              ],
            }
          : stepped,
    }),
  )
}

// NOTE: the game is over. Everyone linked hears why; `Ended` carries the
// scores by player for the room's result. Sockets stay open for the next
// game in the same room.
export const endRoom = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  reason: ClosedReason,
): ReadonlyArray<Out> => [
  ...sendToLinked(room.seats, () =>
    ServerFrame.cases.RoomClosed.make({ reason }),
  ),
  {
    _tag: 'Ended',
    reason,
    tick: room.tick,
    scores: Array.getSomes(
      Array.map(world.scores(room.world), score =>
        Option.map(
          Array.findFirst(room.seats, seat => seat.slot === score.slot),
          seat => ({
            slot: score.slot,
            playerId: seat.playerId,
            score: score.score,
          }),
        ),
      ),
    ),
  },
]

export const isEnded = (out: ReadonlyArray<Out>): boolean =>
  Array.some(out, item => item._tag === 'Ended')

// NOTE: a hair of slack, so 1000 ms is 60 ticks and not 59.999.
const TICK_SLACK = 1e-6

export const ticksDue = (room: Room<unknown>, nowMs: number): number =>
  Math.max(
    0,
    Math.floor((nowMs - room.startedMs) / TICK_MS + TICK_SLACK) - room.tick,
  )

// NOTE: one wake of the room's loop: the ticks the clock owes, one message
// to everyone if a send tick passed, then presence, then the end of the
// game, which first sends the last world if it is not out yet, so every
// player sees how the run ended. After an `Ended` out the room is done.
export const advance = <W, Own>(
  world: World<W, Own>,
  room: Room<W>,
  nowMs: number,
): Stepped<W> => {
  const owed = ticksDue(room, nowMs)
  const slipped =
    owed > MAX_CATCH_UP_TICKS
      ? {
          ...room,
          startedMs: nowMs - (room.tick + MAX_CATCH_UP_TICKS) * TICK_MS,
        }
      : room
  const ticked = Array.reduce(
    repeat(Math.min(owed, MAX_CATCH_UP_TICKS), () => 0),
    slipped,
    current => runTick(world, current),
  )
  const sent = isSendTick(ticked)
    ? broadcast(world, ticked)
    : { room: ticked, out: [] }
  const present = checkPresence(world, sent.room, nowMs)
  const out = [...sent.out, ...present.out]
  if (world.isOver(present.room.world)) {
    const last =
      present.room.sentTick === present.room.tick
        ? { room: present.room, out: [] }
        : broadcast(world, present.room)
    return {
      room: last.room,
      out: [
        ...out,
        ...last.out,
        ...endRoom(
          world,
          last.room,
          world.isWon(last.room.world) ? 'Won' : 'GameOver',
        ),
      ],
    }
  }
  if (Array.isReadonlyArrayEmpty(present.room.seats)) {
    return {
      room: present.room,
      out: [...out, ...endRoom(world, present.room, 'Abandoned')],
    }
  }
  return { room: present.room, out }
}

// NOTE: when the loop should wake next: the next send tick.
export const nextWakeMs = (room: Room<unknown>): number => {
  const nextSendTick =
    (Math.floor(room.tick / TICKS_PER_SEND) + 1) * TICKS_PER_SEND
  return room.startedMs + nextSendTick * TICK_MS
}

export const linkedSockets = (room: Room<unknown>): ReadonlyArray<SocketId> =>
  Array.getSomes(Array.map(room.seats, seat => seat.socket))

export const rttsOf = (
  room: Room<unknown>,
): ReadonlyArray<{ readonly slot: number; readonly rttMs: number }> =>
  pipe(
    room.seats,
    Array.map(seat => ({ slot: seat.slot, rttMs: seat.rttMs })),
  )
