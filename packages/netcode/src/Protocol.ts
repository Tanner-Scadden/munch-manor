import { Array, Option, Result, Schema, pipe } from 'effect'

import {
  type Reader,
  WireError,
  type Writer,
  readAll,
  repeat,
  tryWrite,
} from './Wire'

// NOTE: the realtime channel between a player and a GameRoom, in binary
// WebSocket frames. Every message is described by a Schema below; the
// codec writes it compactly by hand. The room decodes what a client sends
// in three steps: a size cap, the binary reader, then the Schema, which
// clamps what a player may claim (move length, finite aim, known buttons,
// how many samples). What the room sends is decoded with the reader's
// bounds checks only: it is trusted.

// VERSIONS

// NOTE: a client says the range it speaks and the room picks the newest
// both know, or refuses with its own range so the client can say "update".
// Version 2 (2026-10-30): the room's lobby carries picks, looks, and the
// Nightmare unlock, and a run can close as Won; a version 1 client is
// refused rather than handed messages it cannot read. Version 3: an Input
// says which room tick its player was looking at (`seen`) and its round
// trip, and a Delta can carry everyone's round trips (`pings`). Version 4:
// the World holds each seat's hold-to-buy (src/purchase.ts), the interact
// hold rides as button bit 2, and the BuyExit seat action is gone, which
// moved the codes of LeaveCounter and Ready (src/roomWorld.ts pins them).
// Version 5: the Mystery Leftovers fridge and its weapons. The World holds
// the fridge, the Cooker's lids in flight, each player's charge, and the
// new zombie actions; the shop sells the fridge weapons' upgrades and
// lids, whose codes follow the old ones. Version 6: take it or leave it,
// the fridge's door can hold a weapon on Offering, taken with a hold.
// Version 7: the knife and two gun slots. Each player's guns are two
// slots with the pistol a gun like any other, the player carries the
// knife's cooldown, the knife rides as button bit 4, and the shop sells
// the pistol back, whose code follows the old ones.
// Version 8: the boss's brace target and rush length go as positions, not
// unit values, so a client draws the charge lane where the room aims it.
// Version 9: standing still buys as the hold does (src/purchase.ts), and a
// seat's purchase can be Spent, waiting for its player to move before
// standing buys again; a version 8 client cannot read it.
// Version 10: the ammo window mid-wave (src/ammoCounter.ts), a seat's
// purchase can target the stall's Ammo.
// Version 11: the knife is a third slot. Each player holds a gun or the
// knife (`wield`), the knife is drawn by a press (a new action code, as is
// drawing a gun by its slot) and stabs on the fire button, and button bit
// 4 no longer holds it.
// Version 12: the Clang Pan takes the knife's place. Each player carries
// what is in the melee slot (`melee`, the knife or the Pan with its dents
// and tier), the Pan no longer takes a gun slot, and the action that drew
// the knife draws the melee slot, whatever is in it.
export const PROTOCOL_VERSION = 12
export const MIN_PROTOCOL_VERSION = 12

// NOTE: a round trip as the wire carries it, in whole ms.
export const MAX_RTT_MS = 60_000

export interface VersionRange {
  readonly minVersion: number
  readonly maxVersion: number
}

export const SERVER_VERSIONS: VersionRange = {
  minVersion: MIN_PROTOCOL_VERSION,
  maxVersion: PROTOCOL_VERSION,
}

export const negotiateVersion = (
  client: VersionRange,
  server: VersionRange,
): Option.Option<number> => {
  const newest = Math.min(client.maxVersion, server.maxVersion)
  return newest >= Math.max(client.minVersion, server.minVersion)
    ? Option.some(newest)
    : Option.none()
}

// LIMITS

export const MAX_CLIENT_FRAME_BYTES = 1024
export const MAX_TOKEN_LENGTH = 1024
export const MAX_SAMPLES_PER_INPUT = 64
export const MAX_TICKS_PER_SAMPLE = 600
export const MAX_SLOTS = 4
export const MAX_WORLD_BYTES = 256 * 1024

// INPUT

// NOTE: one player's controls for one tick, made on the client from its
// own keys, sticks, and camera, never raw DOM events: move as a vector
// whose components run from -127 to 127, aim as a point in world pixels,
// held buttons as bits, and a world-defined action such as buying an item
// (0 is none). A held state, not an event: the room sees a press as a
// button bit that was clear on the tick before.
export const MOVE_SCALE = 127

const MoveComponent = Schema.Int.check(
  Schema.isBetween({ minimum: -MOVE_SCALE, maximum: MOVE_SCALE }),
)
const AimComponent = Schema.Finite.check(
  Schema.isBetween({ minimum: -4096, maximum: 4095 }),
)
const Bits16 = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 0xffff }),
)

export const PlayerInput = Schema.Struct({
  moveX: MoveComponent,
  moveY: MoveComponent,
  aimX: AimComponent,
  aimY: AimComponent,
  buttons: Bits16,
  action: Bits16,
})
export type PlayerInput = typeof PlayerInput.Type

export const NEUTRAL_INPUT: PlayerInput = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  buttons: 0,
  action: 0,
}

export const inputsEqual = (a: PlayerInput, b: PlayerInput): boolean =>
  a.moveX === b.moveX &&
  a.moveY === b.moveY &&
  a.aimX === b.aimX &&
  a.aimY === b.aimY &&
  a.buttons === b.buttons &&
  a.action === b.action

// NOTE: a move vector longer than 1 is scaled back onto the unit circle,
// so a hand-made input never walks faster than a stick.
export const moveOf = (
  input: PlayerInput,
): Readonly<{ x: number; y: number }> => {
  const x = input.moveX / MOVE_SCALE
  const y = input.moveY / MOVE_SCALE
  const length = Math.sqrt(x * x + y * y)
  return length > 1 ? { x: x / length, y: y / length } : { x, y }
}

export const Sample = Schema.Struct({
  ticks: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_TICKS_PER_SAMPLE }),
  ),
  input: PlayerInput,
})
export type Sample = typeof Sample.Type

// FRAMES

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Slot = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_SLOTS - 1 }),
)
const Version = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 255 }))

export const ClientFrame = Schema.TaggedUnion({
  Hello: {
    minVersion: Version,
    maxVersion: Version,
    token: Schema.String.check(Schema.isMaxLength(MAX_TOKEN_LENGTH)),
  },
  // NOTE: the samples since the last Input, in tick order, from `tick`
  // on. Inputs go out when they change, at most 10 a second, and at least
  // once a second as a heartbeat.
  // NOTE: `seen` is the room tick the player's picture showed when the
  // newest sample was taken (everyone else is drawn behind the room's
  // clock), so the room can check that player's shots against what they
  // saw (MULTIPLAYER.md, "Latency"). `rttMs` is the player's own round
  // trip, so the room can share it.
  Input: {
    seq: Count,
    tick: Count,
    seen: Count,
    rttMs: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: MAX_RTT_MS }),
    ),
    samples: Schema.Array(Sample).check(
      Schema.isMaxLength(MAX_SAMPLES_PER_INPUT),
    ),
  },
  Ping: {
    nonce: Count,
    rttMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60_000 })),
  },
  Leave: {},
})
export type ClientFrame = typeof ClientFrame.Type
export type InputFrame = typeof ClientFrame.cases.Input.Type

export const RefusedReason = Schema.Literals([
  'VersionMismatch',
  'Unauthorized',
  'NotMember',
  'NoRoom',
  'Started',
  'BadMessage',
])
export type RefusedReason = typeof RefusedReason.Type

export const ClosedReason = Schema.Literals([
  'GameOver',
  'EndedByHost',
  'Abandoned',
  'Interrupted',
  'Won',
])
export type ClosedReason = typeof ClosedReason.Type

export const RoomState = Schema.Literals(['Waiting', 'Playing'])
export type RoomState = typeof RoomState.Type

export const ServerFrame = Schema.TaggedUnion({
  Welcome: { version: Version, slot: Slot, state: RoomState, tick: Count },
  Refused: {
    reason: RefusedReason,
    minVersion: Version,
    maxVersion: Version,
  },
  // NOTE: the whole world, on join, on rejoin, and on game start. `ack` is
  // the newest Input seq of this player the room has applied.
  Snapshot: { tick: Count, ack: Count, world: Schema.Uint8Array },
  // NOTE: the change since this player's previous message, which the
  // ordered WebSocket guarantees it has, as of `base`.
  // NOTE: `pings` is every seat's round trip, sent every couple of seconds
  // and otherwise empty, for the ping bars.
  Delta: {
    tick: Count,
    base: Count,
    ack: Count,
    pings: Schema.Array(Schema.Struct({ slot: Slot, rttMs: Count })),
    diff: Schema.Uint8Array,
  },
  Pong: { nonce: Count, tick: Count },
  Away: { slot: Slot },
  Back: { slot: Slot },
  Kicked: {},
  RoomClosed: { reason: ClosedReason },
})
export type ServerFrame = typeof ServerFrame.Type

// TAGS

const CLIENT_TAGS: ReadonlyArray<ClientFrame['_tag']> = [
  'Hello',
  'Input',
  'Ping',
  'Leave',
]
const SERVER_TAGS: ReadonlyArray<ServerFrame['_tag']> = [
  'Welcome',
  'Refused',
  'Snapshot',
  'Delta',
  'Pong',
  'Away',
  'Back',
  'Kicked',
  'RoomClosed',
]

const REFUSED_REASONS = RefusedReason.literals
const CLOSED_REASONS = ClosedReason.literals
const ROOM_STATES = RoomState.literals

const indexOf = <A extends string>(list: ReadonlyArray<A>, value: A): number =>
  list.indexOf(value) + 1

const pick = <A extends string>(list: ReadonlyArray<A>, index: number): A => {
  const value = list[index - 1]
  if (value === undefined) {
    throw new WireError({ reason: `Unknown tag ${index}` })
  }
  return value
}

// INPUT CODEC

// NOTE: a mask byte says which parts are not neutral, so a player standing
// still with nothing held is one byte.
const MOVE_BIT = 1
const AIM_BIT = 2
const BUTTONS_BIT = 4
const ACTION_BIT = 8
const AIM_SCALE = 8

const writeInput = (writer: Writer, input: PlayerInput) => {
  const hasMove = input.moveX !== 0 || input.moveY !== 0
  const hasAim = input.aimX !== 0 || input.aimY !== 0
  writer.u8(
    (hasMove ? MOVE_BIT : 0) |
      (hasAim ? AIM_BIT : 0) |
      (input.buttons !== 0 ? BUTTONS_BIT : 0) |
      (input.action !== 0 ? ACTION_BIT : 0),
  )
  if (hasMove) {
    writer.u8(input.moveX + MOVE_SCALE)
    writer.u8(input.moveY + MOVE_SCALE)
  }
  if (hasAim) {
    writer.fixed(input.aimX, AIM_SCALE)
    writer.fixed(input.aimY, AIM_SCALE)
  }
  if (input.buttons !== 0) {
    writer.varint(input.buttons)
  }
  if (input.action !== 0) {
    writer.varint(input.action)
  }
}

const readInput = (reader: Reader): PlayerInput => {
  const mask = reader.u8()
  const hasMove = (mask & MOVE_BIT) !== 0
  const hasAim = (mask & AIM_BIT) !== 0
  const moveX = hasMove ? reader.u8() - MOVE_SCALE : 0
  const moveY = hasMove ? reader.u8() - MOVE_SCALE : 0
  const aimX = hasAim ? reader.fixed(AIM_SCALE) : 0
  const aimY = hasAim ? reader.fixed(AIM_SCALE) : 0
  return {
    moveX,
    moveY,
    aimX,
    aimY,
    buttons: (mask & BUTTONS_BIT) !== 0 ? reader.varint() : 0,
    action: (mask & ACTION_BIT) !== 0 ? reader.varint() : 0,
  }
}

// CLIENT FRAMES

const writeClientFrame = (writer: Writer, frame: ClientFrame) => {
  writer.u8(indexOf(CLIENT_TAGS, frame._tag))
  ClientFrame.match(frame, {
    Hello: hello => {
      writer.u8(hello.minVersion)
      writer.u8(hello.maxVersion)
      writer.text(hello.token)
    },
    Input: input => {
      writer.varint(input.seq)
      writer.varint(input.tick)
      writer.varint(input.seen)
      writer.varint(input.rttMs)
      writer.varint(input.samples.length)
      Array.forEach(input.samples, sample => {
        writer.varint(sample.ticks)
        writeInput(writer, sample.input)
      })
    },
    Ping: ping => {
      writer.varint(ping.nonce)
      writer.varint(ping.rttMs)
    },
    Leave: () => {},
  })
}

// NOTE: plain objects in the frame's encoded shape, for the Schema to
// check. Counts are read before their items so a short frame fails fast.
// NOTE: each tag's reader, exhaustive over the union's tags.
const CLIENT_READERS: {
  readonly [Tag in ClientFrame['_tag']]: (reader: Reader) => unknown
} = {
  Hello: reader => ({
    _tag: 'Hello',
    minVersion: reader.u8(),
    maxVersion: reader.u8(),
    token: reader.text(MAX_TOKEN_LENGTH),
  }),
  Input: reader => {
    const seq = reader.varint()
    const tick = reader.varint()
    const seen = reader.varint()
    const rttMs = reader.varint()
    const count = reader.varint()
    if (count > MAX_SAMPLES_PER_INPUT) {
      throw new WireError({ reason: `${count} samples` })
    }
    return {
      _tag: 'Input',
      seq,
      tick,
      seen,
      rttMs,
      samples: repeat(count, () => ({
        ticks: reader.varint(),
        input: readInput(reader),
      })),
    }
  },
  Ping: reader => ({
    _tag: 'Ping',
    nonce: reader.varint(),
    rttMs: reader.varint(),
  }),
  Leave: () => ({ _tag: 'Leave' }),
}

const readClientFrame = (reader: Reader): unknown =>
  CLIENT_READERS[pick(CLIENT_TAGS, reader.u8())](reader)

const decodeClientSchema = Schema.decodeUnknownResult(ClientFrame)

export const encodeClientFrame = (
  frame: ClientFrame,
): Result.Result<Uint8Array, WireError> =>
  tryWrite(writer => writeClientFrame(writer, frame))

export const decodeClientFrame = (
  bytes: Uint8Array,
): Result.Result<ClientFrame, WireError> =>
  bytes.length > MAX_CLIENT_FRAME_BYTES
    ? Result.fail(new WireError({ reason: `${bytes.length} bytes` }))
    : pipe(
        readAll(bytes, readClientFrame),
        Result.flatMap(raw =>
          Result.mapError(
            decodeClientSchema(raw),
            error => new WireError({ reason: error.message }),
          ),
        ),
      )

// SERVER FRAMES

const writeServerFrame = (writer: Writer, frame: ServerFrame) => {
  writer.u8(indexOf(SERVER_TAGS, frame._tag))
  ServerFrame.match(frame, {
    Welcome: welcome => {
      writer.u8(welcome.version)
      writer.u8(welcome.slot)
      writer.u8(indexOf(ROOM_STATES, welcome.state))
      writer.varint(welcome.tick)
    },
    Refused: refused => {
      writer.u8(indexOf(REFUSED_REASONS, refused.reason))
      writer.u8(refused.minVersion)
      writer.u8(refused.maxVersion)
    },
    Snapshot: snapshot => {
      writer.varint(snapshot.tick)
      writer.varint(snapshot.ack)
      writer.raw(snapshot.world)
    },
    // NOTE: `base` goes as how far back it is, which is one byte at 20 Hz.
    Delta: delta => {
      writer.varint(delta.tick)
      writer.varint(delta.tick - delta.base)
      writer.varint(delta.ack)
      writer.varint(delta.pings.length)
      Array.forEach(delta.pings, ping => {
        writer.u8(ping.slot)
        writer.varint(ping.rttMs)
      })
      writer.raw(delta.diff)
    },
    Pong: pong => {
      writer.varint(pong.nonce)
      writer.varint(pong.tick)
    },
    Away: away => writer.u8(away.slot),
    Back: back => writer.u8(back.slot),
    Kicked: () => {},
    RoomClosed: closed => writer.u8(indexOf(CLOSED_REASONS, closed.reason)),
  })
}

// NOTE: each tag's reader, exhaustive over the union's tags.
const SERVER_READERS: {
  readonly [Tag in ServerFrame['_tag']]: (reader: Reader) => ServerFrame
} = {
  Welcome: reader =>
    ServerFrame.cases.Welcome.make({
      version: reader.u8(),
      slot: reader.u8(),
      state: pick(ROOM_STATES, reader.u8()),
      tick: reader.varint(),
    }),
  Refused: reader =>
    ServerFrame.cases.Refused.make({
      reason: pick(REFUSED_REASONS, reader.u8()),
      minVersion: reader.u8(),
      maxVersion: reader.u8(),
    }),
  Snapshot: reader =>
    ServerFrame.cases.Snapshot.make({
      tick: reader.varint(),
      ack: reader.varint(),
      world: reader.rest(),
    }),
  Delta: reader => {
    const tick = reader.varint()
    const back = reader.varint()
    if (back > tick) {
      throw new WireError({ reason: 'Delta base before tick 0' })
    }
    const ack = reader.varint()
    const pingCount = reader.varint()
    if (pingCount > MAX_SLOTS) {
      throw new WireError({ reason: `${pingCount} pings` })
    }
    const pings = repeat(pingCount, () => ({
      slot: reader.u8(),
      rttMs: reader.varint(),
    }))
    return ServerFrame.cases.Delta.make({
      tick,
      base: tick - back,
      ack,
      pings,
      diff: reader.rest(),
    })
  },
  Pong: reader =>
    ServerFrame.cases.Pong.make({
      nonce: reader.varint(),
      tick: reader.varint(),
    }),
  Away: reader => ServerFrame.cases.Away.make({ slot: reader.u8() }),
  Back: reader => ServerFrame.cases.Back.make({ slot: reader.u8() }),
  Kicked: () => ServerFrame.cases.Kicked.make({}),
  RoomClosed: reader =>
    ServerFrame.cases.RoomClosed.make({
      reason: pick(CLOSED_REASONS, reader.u8()),
    }),
}

const readServerFrame = (reader: Reader): ServerFrame =>
  SERVER_READERS[pick(SERVER_TAGS, reader.u8())](reader)

export const encodeServerFrame = (
  frame: ServerFrame,
): Result.Result<Uint8Array, WireError> =>
  tryWrite(writer => writeServerFrame(writer, frame))

export const decodeServerFrame = (
  bytes: Uint8Array,
): Result.Result<ServerFrame, WireError> =>
  bytes.length > MAX_WORLD_BYTES + 64
    ? Result.fail(new WireError({ reason: `${bytes.length} bytes` }))
    : readAll(bytes, readServerFrame)

// NOTE: a WebSocket frame adds 2 bytes of header under 126 bytes of
// payload and 4 up to 64 KB. A client's frames are masked, 4 bytes more.
export const webSocketBytes = (payload: number, masked: boolean): number =>
  payload + (payload < 126 ? 2 : 4) + (masked ? 4 : 0)
