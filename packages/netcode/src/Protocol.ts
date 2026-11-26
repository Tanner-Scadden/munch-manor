import { Array, Function, Option, Result, Schema, pipe } from 'effect'

import {
  type Reader,
  WireError,
  type Writer,
  readAll,
  repeat,
  tryWrite,
} from './Wire'

export const PROTOCOL_VERSION = 23
export const MIN_PROTOCOL_VERSION = 23

export const MAX_RTT_MS = 60_000

export interface VersionRange {
  readonly minVersion: number
  readonly maxVersion: number
}

export const SERVER_VERSIONS: VersionRange = {
  minVersion: MIN_PROTOCOL_VERSION,
  maxVersion: PROTOCOL_VERSION,
}

export const negotiateVersion: {
  (server: VersionRange): (client: VersionRange) => Option.Option<number>
  (client: VersionRange, server: VersionRange): Option.Option<number>
} = Function.dual(
  2,
  (client: VersionRange, server: VersionRange): Option.Option<number> => {
    const newest = Math.min(client.maxVersion, server.maxVersion)
    return newest >= Math.max(client.minVersion, server.minVersion)
      ? Option.some(newest)
      : Option.none()
  },
)

export const MAX_CLIENT_FRAME_BYTES = 1024
export const MAX_TOKEN_LENGTH = 1024
export const MAX_SAMPLES_PER_INPUT = 64
export const MAX_TICKS_PER_SAMPLE = 600
export const MAX_SLOTS = 4
export const MAX_WORLD_BYTES = 256 * 1024

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

export const inputsEqual: {
  (b: PlayerInput): (a: PlayerInput) => boolean
  (a: PlayerInput, b: PlayerInput): boolean
} = Function.dual(
  2,
  (a: PlayerInput, b: PlayerInput): boolean =>
    a.moveX === b.moveX &&
    a.moveY === b.moveY &&
    a.aimX === b.aimX &&
    a.aimY === b.aimY &&
    a.buttons === b.buttons &&
    a.action === b.action,
)

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
  'LeftEarly',
])
export type ClosedReason = typeof ClosedReason.Type

export type RunEndReason = 'GameOver' | 'Won' | 'LeftEarly'

export const RoomState = Schema.Literals(['Waiting', 'Playing'])
export type RoomState = typeof RoomState.Type

export const ServerFrame = Schema.TaggedUnion({
  Welcome: { version: Version, slot: Slot, state: RoomState, tick: Count },
  Refused: {
    reason: RefusedReason,
    minVersion: Version,
    maxVersion: Version,
  },
  Snapshot: { tick: Count, ack: Count, world: Schema.Uint8Array },
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
    throw WireError.make({ reason: `Unknown tag ${index}` })
  }
  return value
}

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
      throw WireError.make({ reason: `${count} samples` })
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
    ? Result.fail(WireError.make({ reason: `${bytes.length} bytes` }))
    : pipe(
        readAll(bytes, readClientFrame),
        Result.flatMap(raw =>
          Result.mapError(decodeClientSchema(raw), error =>
            WireError.make({ reason: error.message }),
          ),
        ),
      )

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
      throw WireError.make({ reason: 'Delta base before tick 0' })
    }
    const ack = reader.varint()
    const pingCount = reader.varint()
    if (pingCount > MAX_SLOTS) {
      throw WireError.make({ reason: `${pingCount} pings` })
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
    ? Result.fail(WireError.make({ reason: `${bytes.length} bytes` }))
    : readAll(bytes, readServerFrame)

export const webSocketBytes: {
  (masked: boolean): (payload: number) => number
  (payload: number, masked: boolean): number
} = Function.dual(
  2,
  (payload: number, masked: boolean): number =>
    payload + (payload < 126 ? 2 : 4) + (masked ? 4 : 0),
)
