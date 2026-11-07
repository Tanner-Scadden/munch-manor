import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type ClientFrame,
  MAX_CLIENT_FRAME_BYTES,
  MIN_PROTOCOL_VERSION,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  type PlayerInput,
  SERVER_VERSIONS,
  ServerFrame,
  WireError,
  decodeClientFrame,
  decodeServerFrame,
  encodeClientFrame,
  encodeServerFrame,
  makeReader,
  makeWriter,
  negotiateVersion,
  readAll,
  webSocketBytes,
  writeAll,
} from '../src/index'

const encodeClient = (frame: ClientFrame): Uint8Array =>
  Result.getOrThrow(encodeClientFrame(frame))

const encodeServer = (frame: ServerFrame): Uint8Array =>
  Result.getOrThrow(encodeServerFrame(frame))

const walking: PlayerInput = {
  moveX: 127,
  moveY: -64,
  aimX: 312.5,
  aimY: -40.125,
  buttons: 5,
  action: 0,
}

describe('the wire', () => {
  test('varints, zigzags, and fixed point read back', () => {
    const values = [0, 1, 127, 128, 300, 16_383, 16_384, 2 ** 31, 2 ** 48]
    const bytes = writeAll(writer => {
      Array.forEach(values, value => writer.varint(value))
      writer.zigzag(-1)
      writer.zigzag(-300)
      writer.position(123.456)
      writer.i16(-32768)
      writer.text('héllo')
    })
    const read = Result.getOrThrow(
      readAll(bytes, reader => ({
        values: Array.map(values, () => reader.varint()),
        minusOne: reader.zigzag(),
        minus300: reader.zigzag(),
        position: reader.position(),
        low: reader.i16(),
        text: reader.text(16),
      })),
    )
    expect(read.values).toEqual(values)
    expect(read.minusOne).toBe(-1)
    expect(read.minus300).toBe(-300)
    expect(read.position).toBe(123.5)
    expect(read.low).toBe(-32768)
    expect(read.text).toBe('héllo')
  })

  test('a varint takes one byte under 128 and two under 16,384', () => {
    expect(writeAll(writer => writer.varint(127)).length).toBe(1)
    expect(writeAll(writer => writer.varint(128)).length).toBe(2)
    expect(writeAll(writer => writer.varint(16_383)).length).toBe(2)
  })

  test('reading past the end, or leaving bytes, fails', () => {
    expect(
      Result.isFailure(readAll(new Uint8Array([200]), r => r.varint())),
    ).toBe(true)
    expect(Result.isFailure(readAll(new Uint8Array([1, 2]), r => r.u8()))).toBe(
      true,
    )
    const reader = makeReader(
      new Uint8Array([255, 255, 255, 255, 255, 255, 255, 1]),
    )
    expect(() => reader.varint()).toThrow(WireError)
  })

  test('a writer grows past its first buffer', () => {
    const writer = makeWriter(2)
    writer.raw(new Uint8Array(1000).fill(7))
    expect(writer.finish().length).toBe(1000)
  })
})

describe('versions', () => {
  test('the newest version both speak is chosen', () => {
    expect(
      negotiateVersion({ minVersion: 1, maxVersion: 1 }, SERVER_VERSIONS),
    ).toEqual(Option.none())
    expect(
      negotiateVersion(
        { minVersion: 1, maxVersion: PROTOCOL_VERSION },
        SERVER_VERSIONS,
      ),
    ).toEqual(Option.some(PROTOCOL_VERSION))
    expect(
      negotiateVersion(
        { minVersion: 1, maxVersion: MIN_PROTOCOL_VERSION - 1 },
        SERVER_VERSIONS,
      ),
    ).toEqual(Option.none())
    expect(
      negotiateVersion(
        {
          minVersion: PROTOCOL_VERSION + 1,
          maxVersion: PROTOCOL_VERSION + 2,
        },
        SERVER_VERSIONS,
      ),
    ).toEqual(Option.none())
    expect(
      negotiateVersion(
        { minVersion: 1, maxVersion: 4 },
        { minVersion: 2, maxVersion: 3 },
      ),
    ).toEqual(Option.some(3))
  })
})

describe('client frames', () => {
  const frames: ReadonlyArray<ClientFrame> = [
    { _tag: 'Hello', minVersion: 1, maxVersion: 1, token: 'abc.def' },
    {
      _tag: 'Input',
      seq: 41,
      tick: 1234,
      seen: 1234,
      rttMs: 61,
      samples: [
        { ticks: 4, input: NEUTRAL_INPUT },
        { ticks: 2, input: walking },
      ],
    },
    { _tag: 'Input', seq: 42, tick: 1240, seen: 1228, rttMs: 61, samples: [] },
    { _tag: 'Ping', nonce: 9, rttMs: 61 },
    { _tag: 'Leave' },
  ]

  test.each(frames)('$_tag round trips', frame => {
    expect(Result.getOrThrow(decodeClientFrame(encodeClient(frame)))).toEqual(
      frame,
    )
  })

  test('an input frame is small', () => {
    const standing = encodeClient({
      _tag: 'Input',
      seq: 200,
      tick: 36_000,
      seen: 36_000,
      rttMs: 61,
      samples: [{ ticks: 6, input: NEUTRAL_INPUT }],
    })
    const turning = encodeClient({
      _tag: 'Input',
      seq: 200,
      tick: 36_000,
      seen: 36_000,
      rttMs: 61,
      samples: [
        { ticks: 3, input: walking },
        { ticks: 3, input: { ...walking, moveX: 0 } },
      ],
    })
    expect(standing.length).toBeLessThanOrEqual(13)
    expect(turning.length).toBeLessThanOrEqual(29)
    expect(webSocketBytes(turning.length, true)).toBeLessThanOrEqual(35)
  })

  test('the Schema refuses what a player may not claim', () => {
    const tooFast = new Uint8Array([2, 1, 1, 1, 1, 1, 255, 127])
    const bad = [
      tooFast,
      new Uint8Array([9]),
      new Uint8Array(MAX_CLIENT_FRAME_BYTES + 1),
      encodeClient({
        _tag: 'Input',
        seq: 1,
        tick: 1,
        seen: 1,
        rttMs: 61,
        samples: globalThis.Array.from({ length: 65 }, () => ({
          ticks: 1,
          input: NEUTRAL_INPUT,
        })),
      }),
      encodeClient({
        _tag: 'Input',
        seq: 1,
        tick: 1,
        seen: 1,
        rttMs: 61,
        samples: [{ ticks: 0, input: NEUTRAL_INPUT }],
      }),
    ]
    Array.forEach(bad, bytes => {
      expect(Result.isFailure(decodeClientFrame(bytes))).toBe(true)
    })
  })
})

describe('server frames', () => {
  const frames: ReadonlyArray<ServerFrame> = [
    ServerFrame.cases.Welcome.make({
      version: 1,
      slot: 2,
      state: 'Playing',
      tick: 99,
    }),
    ServerFrame.cases.Refused.make({
      reason: 'NotMember',
      minVersion: 1,
      maxVersion: 1,
    }),
    ServerFrame.cases.Snapshot.make({
      tick: 300,
      ack: 12,
      world: new Uint8Array([1, 2, 3]),
    }),
    ServerFrame.cases.Delta.make({
      tick: 303,
      base: 300,
      ack: 13,
      pings: [],
      diff: new Uint8Array([4, 5]),
    }),
    ServerFrame.cases.Delta.make({
      tick: 423,
      base: 420,
      ack: 14,
      pings: [
        { slot: 0, rttMs: 48 },
        { slot: 2, rttMs: 212 },
      ],
      diff: new Uint8Array([6]),
    }),
    ServerFrame.cases.Pong.make({ nonce: 3, tick: 310 }),
    ServerFrame.cases.Away.make({ slot: 1 }),
    ServerFrame.cases.Back.make({ slot: 1 }),
    ServerFrame.cases.Kicked.make({}),
    ServerFrame.cases.RoomClosed.make({ reason: 'Abandoned' }),
  ]

  test.each(frames)('$_tag round trips', frame => {
    expect(Result.getOrThrow(decodeServerFrame(encodeServer(frame)))).toEqual(
      frame,
    )
  })

  test('a delta header is a few bytes', () => {
    const header = encodeServer(
      ServerFrame.cases.Delta.make({
        tick: 108_000,
        base: 107_997,
        ack: 6000,
        pings: [],
        diff: new Uint8Array(0),
      }),
    )
    expect(header.length).toBeLessThanOrEqual(8)
  })
})
