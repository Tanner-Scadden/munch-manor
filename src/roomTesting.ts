import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type ClientFrame,
  NEUTRAL_INPUT,
  type PlayerInput,
  type PlayerTick,
  Room,
  Session,
  decodeClientFrame,
  decodeServerFrame,
  encodeClientFrame,
  encodeServerFrame,
  webSocketBytes,
} from '@munch/netcode'

import { normalize } from './geometry'
import { maybePlayerAt, playersOf, withSeat } from './party'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  MOVE_SCALE,
  type OwnSeat,
  ROOM_WORLD,
  type RoomWorld,
  actionCodeOf,
  heldAction,
  startRoomWorld,
  stepRoomWorld,
} from './roomWorld'
import { SeatAction } from './stepWorld'
import { Phase, type Vector, ZombieState } from './worldSchema'

// Test helpers for a co-op room playing the real World: scripted players,
// the room stepped tick by tick, and a room with clients over a fake
// network, every frame through the real codecs.

// NOTE: a room of two players from seed 7.
export const TWO_SEAT_ROOM = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)

// NOTE: each scripted player walks a square of its own, out of step with
// the others, aims at the nearest walking zombie and holds the trigger
// when there is one, and presses READY in every break.
const LEGS: ReadonlyArray<Vector> = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
]
const LEG_TICKS = 80

const nearestZombie = (room: RoomWorld, at: Vector): Option.Option<Vector> =>
  pipe(
    room.world.zombies,
    Array.filter(zombie => ZombieState.isAnyOf(['Walking'])(zombie.state)),
    Array.map(zombie => ({
      at: { x: zombie.x, y: zombie.y },
      distance: Math.hypot(zombie.x - at.x, zombie.y - at.y),
    })),
    Array.reduce(
      Option.none<{ at: Vector; distance: number }>(),
      (best, next) =>
        Option.match(best, {
          onNone: () => Option.some(next),
          onSome: current =>
            next.distance < current.distance ? Option.some(next) : best,
        }),
    ),
    Option.map(({ at: found }) => found),
  )

export const scriptedInput = (
  room: RoomWorld,
  slot: number,
  tick: number,
): PlayerInput =>
  Option.match(maybePlayerAt(room.world, slot), {
    onNone: () => NEUTRAL_INPUT,
    onSome: ({ player }) => {
      const leg =
        LEGS[Math.floor((tick + slot * 37) / LEG_TICKS) % LEGS.length] ??
        LEGS[0]
      const maybeAim = Option.flatMap(nearestZombie(room, player), target =>
        normalize({ x: target.x - player.x, y: target.y - player.y }),
      )
      const ready = Phase.isAnyOf(['Preparation'])(room.world.phase)
        ? heldAction(actionCodeOf(SeatAction.Ready()), room.world.phase.wave)
        : 0
      return {
        moveX: Math.round((leg?.x ?? 0) * MOVE_SCALE),
        moveY: Math.round((leg?.y ?? 0) * MOVE_SCALE),
        aimX: Option.match(maybeAim, {
          onNone: () => 0,
          onSome: aim => Math.round(aim.x * AIM_REACH * 8) / 8,
        }),
        aimY: Option.match(maybeAim, {
          onNone: () => 0,
          onSome: aim => Math.round(aim.y * AIM_REACH * 8) / 8,
        }),
        buttons: Option.isSome(maybeAim) ? 1 : 0,
        action: ready,
      }
    },
  })

export const scriptedTicks = (room: RoomWorld): ReadonlyArray<PlayerTick> =>
  Array.map(playersOf(room.world), ({ slot }) => ({
    slot,
    input: scriptedInput(room, slot, room.tick),
    presence: 'Here' as const,
    viewLagTicks: 0,
    rttMs: 0,
  }))

// NOTE: the room alone, `ticks` ticks of scripted players, calling `each`
// with every World it steps to.
export const playRoom = (
  start: RoomWorld,
  ticks: number,
  each: (room: RoomWorld) => void = () => {},
): RoomWorld =>
  Array.reduce(
    Array.makeBy(ticks, () => 0),
    start,
    room => {
      const next = stepRoomWorld(room, scriptedTicks(room))
      each(next)
      return next
    },
  )

// A ROOM OVER A FAKE NETWORK

// NOTE: a room whose players start with this many hearts, so scripted
// players last into the crowded waves a measurement wants.
const withHearts = (hearts: number) => ({
  ...ROOM_WORLD,
  start: (slots: ReadonlyArray<number>, seed: number): RoomWorld => {
    const room = ROOM_WORLD.start(slots, seed)
    return {
      ...room,
      world: Array.reduce(slots, room.world, (world, slot) =>
        withSeat(world, slot, seatWorld =>
          modifyFields(seatWorld, {
            player: player => modifyFields(player, { hp: () => hearts }),
          }),
        ),
      ),
    }
  },
})

type ClientSession = Session.Session<RoomWorld, OwnSeat>

type InFlight = Readonly<{ atMs: number; bytes: Uint8Array }>

type Client = {
  readonly slot: number
  readonly socket: string
  session: ClientSession
  toRoom: Array<InFlight>
  toClient: Array<InFlight>
  inputsSent: number
  shown: number
}

export type NetworkRun = Readonly<{
  clients: ReadonlyArray<Client>
  room: Room.Room<RoomWorld>
  messageBytes: ReadonlyArray<number>
  crowdedBytes: ReadonlyArray<number>
  bytesDown: number
  seconds: number
}>

const T0 = 5_000_000
const CROWDED = 15

// NOTE: each client draws every fourth frame, which keeps the run light
// enough for CI; the input and prediction still run every frame.
export const DRAW_EVERY = 4

// NOTE: a room and a client per player, each message encoded to bytes and
// decoded on the far side as the Durable Object and the browser do, over a
// network with a fixed one-way delay. Every client plays the scripted
// player from its own newest World and draws once a 60 Hz frame.
export const simulateRoom = (
  options: Readonly<{
    players: number
    oneWayMs: number
    seconds: number
    hearts?: number
  }>,
): NetworkRun => {
  const world = Option.match(Option.fromNullishOr(options.hearts), {
    onNone: () => ROOM_WORLD,
    onSome: hearts => withHearts(hearts),
  })
  const clients: Array<Client> = Array.makeBy(options.players, slot => ({
    slot,
    socket: `socket-${slot}`,
    session: Session.makeSession<RoomWorld, OwnSeat>(T0),
    toRoom: [],
    toClient: [],
    inputsSent: 0,
    shown: 0,
  }))
  const started = Room.startRoom(
    world,
    Array.map(clients, client => ({
      slot: client.slot,
      playerId: `player-${client.slot}`,
      socket: Option.some(client.socket),
    })),
    7,
    T0,
  )
  const state = {
    room: started.room,
    nextWakeMs: Room.nextWakeMs(started.room),
    bytesDown: 0,
    nextFrameMs: T0,
    isEnded: false,
    frame: 0,
    endedMs: T0 + options.seconds * 1000,
  }
  const messageBytes: Array<number> = []
  const crowdedBytes: Array<number> = []

  const deliver = (out: ReadonlyArray<Room.Out>, nowMs: number) =>
    Array.forEach(out, item => {
      if (item._tag !== 'Send') {
        return
      }
      const bytes = Result.getOrThrow(encodeServerFrame(item.frame))
      const onWire = webSocketBytes(bytes.length, false)
      state.bytesDown += onWire
      if (item.frame._tag === 'Delta') {
        messageBytes.push(onWire)
        if (state.room.world.world.zombies.length >= CROWDED) {
          crowdedBytes.push(onWire)
        }
      }
      Array.forEach(clients, client => {
        if (client.socket === item.socket) {
          client.toClient.push({ atMs: nowMs + options.oneWayMs, bytes })
        }
      })
    })

  deliver(started.out, T0)
  const stepMs = 4
  const frameMs = 1000 / 60
  Array.forEach(
    Array.makeBy(Math.ceil((options.seconds * 1000) / stepMs), index => index),
    index => {
      const nowMs = T0 + index * stepMs
      Array.forEach(clients, client => {
        const arrived = Array.filter(client.toRoom, ({ atMs }) => atMs <= nowMs)
        client.toRoom = Array.filter(client.toRoom, ({ atMs }) => atMs > nowMs)
        Array.forEach(arrived, ({ bytes }) => {
          const frame = Result.getOrThrow(decodeClientFrame(bytes))
          const received = Room.receive(
            world,
            state.room,
            client.socket,
            frame,
            nowMs,
          )
          state.room = received.room
          deliver(received.out, nowMs)
        })
      })
      if (!state.isEnded && nowMs >= state.nextWakeMs) {
        const advanced = Room.advance(world, state.room, nowMs)
        state.room = advanced.room
        state.nextWakeMs = Room.nextWakeMs(advanced.room)
        deliver(advanced.out, nowMs)
        if (Room.isEnded(advanced.out)) {
          state.isEnded = true
          state.endedMs = nowMs
        }
      }
      Array.forEach(clients, client => {
        const arrived = Array.filter(
          client.toClient,
          ({ atMs }) => atMs <= nowMs,
        )
        client.toClient = Array.filter(
          client.toClient,
          ({ atMs }) => atMs > nowMs,
        )
        Array.forEach(arrived, ({ bytes }) => {
          client.session = Result.getOrThrow(
            Session.receive(
              world,
              client.session,
              Result.getOrThrow(decodeServerFrame(bytes)),
              bytes.length,
              nowMs,
            ),
          )
        })
      })
      if (nowMs >= state.nextFrameMs) {
        state.nextFrameMs += frameMs
        state.frame += 1
        Array.forEach(clients, client => {
          const input = Option.match(Array.last(client.session.frames), {
            onNone: () => NEUTRAL_INPUT,
            onSome: newest =>
              scriptedInput(
                newest.world,
                client.slot,
                Math.floor(Session.inputTickAt(client.session, nowMs)),
              ),
          })
          const ticked = Session.tickInput(world, client.session, input, nowMs)
          client.session = ticked.session
          Array.forEach(ticked.outgoing, (frame: ClientFrame) => {
            const bytes = Result.getOrThrow(encodeClientFrame(frame))
            client.inputsSent += frame._tag === 'Input' ? 1 : 0
            client.session = Session.countSent(client.session, bytes.length)
            client.toRoom.push({ atMs: nowMs + options.oneWayMs, bytes })
          })
          if (state.frame % DRAW_EVERY === 0) {
            const rendered = Session.render(world, client.session, nowMs)
            client.session = rendered.session
            client.shown += Option.isSome(rendered.world) ? 1 : 0
          }
        })
      }
    },
  )
  return {
    clients,
    room: state.room,
    messageBytes,
    crowdedBytes,
    bytesDown: state.bytesDown,
    seconds: (state.endedMs - T0) / 1000,
  }
}

export const percentile = (
  values: ReadonlyArray<number>,
  fraction: number,
): number => {
  const sorted = Array.sort(values, (a: number, b: number) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  )
}

export const mean = (values: ReadonlyArray<number>): number =>
  Array.isReadonlyArrayEmpty(values)
    ? 0
    : Array.reduce(values, 0, (sum, value) => sum + value) / values.length
