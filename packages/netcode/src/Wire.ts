import { Function, Result, Schema } from 'effect'

// NOTE: the bytes under the room protocol, after the spike's estimate
// (MULTIPLAYER.md, "The wire at 20 Hz"): unsigned integers as LEB128
// varints, signed ones zigzagged first, positions and other fractions as
// int16 fixed point, strings and byte runs prefixed with their length, and
// any other number as a little-endian float64. A Reader that runs off the
// end, or meets a malformed varint, throws a WireError, and `readAll`
// turns that into a failed Result, so callers never see an exception.

export class WireError extends Schema.TaggedError<
  WireError,
  { readonly brand: unique symbol }
>()('WireError', {
  reason: Schema.String,
}) {}

// NOTE: 2^49, so a varint fits in 7 bytes and every value is an exact
// JavaScript integer.
export const MAX_VARINT = 2 ** 49

// NOTE: positions are int16 with 3 fraction bits: an eighth of a pixel, up
// to 4,095 pixels either way.
export const POSITION_SCALE = 8

const INT16_MIN = -32768
const INT16_MAX = 32767

export const fixedOf: {
  (scale: number): (value: number) => number
  (value: number, scale: number): number
} = Function.dual(2, (value: number, scale: number): number =>
  Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(value * scale))),
)

// NOTE: what a value reads back as after a trip through `fixed`. The room
// compares quantized values, so a client's copy equals the room's exactly.
export const quantize: {
  (scale: number): (value: number) => number
  (value: number, scale: number): number
} = Function.dual(
  2,
  (value: number, scale: number): number => fixedOf(value, scale) / scale,
)

export const quantizePosition = (value: number): number =>
  quantize(value, POSITION_SCALE)

// WRITER

export interface Writer {
  readonly u8: (value: number) => void
  readonly varint: (value: number) => void
  readonly zigzag: (value: number) => void
  readonly i16: (value: number) => void
  readonly fixed: (value: number, scale: number) => void
  readonly position: (value: number) => void
  readonly f64: (value: number) => void
  readonly bool: (value: boolean) => void
  readonly bytes: (value: Uint8Array) => void
  readonly raw: (value: Uint8Array) => void
  readonly text: (value: string) => void
  readonly size: () => number
  readonly finish: () => Uint8Array
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const makeWriter = (capacity = 64): Writer => {
  const state = { buffer: new Uint8Array(capacity), length: 0 }

  const reserve = (extra: number) => {
    const needed = state.length + extra
    if (needed > state.buffer.length) {
      const grown = new Uint8Array(Math.max(needed, state.buffer.length * 2))
      grown.set(state.buffer.subarray(0, state.length))
      state.buffer = grown
    }
  }

  const u8 = (value: number) => {
    reserve(1)
    state.buffer[state.length] = value & 0xff
    state.length += 1
  }

  const varint = (value: number): void => {
    if (!Number.isInteger(value) || value < 0 || value >= MAX_VARINT) {
      throw WireError.make({ reason: `Not a varint: ${value}` })
    }
    if (value < 128) {
      u8(value)
      return
    }
    u8((value % 128) + 128)
    varint(Math.floor(value / 128))
  }

  const zigzag = (value: number) =>
    varint(value < 0 ? -2 * value - 1 : 2 * value)

  const i16 = (value: number) => {
    const clamped = Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(value)))
    const unsigned = clamped < 0 ? clamped + 65536 : clamped
    u8(unsigned & 0xff)
    u8(unsigned >> 8)
  }

  const raw = (value: Uint8Array) => {
    reserve(value.length)
    state.buffer.set(value, state.length)
    state.length += value.length
  }

  return {
    u8,
    varint,
    zigzag,
    i16,
    fixed: (value, scale) => i16(fixedOf(value, scale)),
    position: value => i16(fixedOf(value, POSITION_SCALE)),
    f64: value => {
      const bytes = new Uint8Array(8)
      new DataView(bytes.buffer).setFloat64(0, value, true)
      raw(bytes)
    },
    bool: value => u8(value ? 1 : 0),
    bytes: value => {
      varint(value.length)
      raw(value)
    },
    raw,
    text: value => {
      const encoded = encoder.encode(value)
      varint(encoded.length)
      raw(encoded)
    },
    size: () => state.length,
    finish: () => state.buffer.slice(0, state.length),
  }
}

// READER

export interface Reader {
  readonly u8: () => number
  readonly varint: () => number
  readonly zigzag: () => number
  readonly i16: () => number
  readonly fixed: (scale: number) => number
  readonly position: () => number
  readonly f64: () => number
  readonly bool: () => boolean
  readonly bytes: (maxLength: number) => Uint8Array
  readonly rest: () => Uint8Array
  readonly text: (maxLength: number) => string
  readonly remaining: () => number
}

const VARINT_MAX_BYTES = 7

export const makeReader = (bytes: Uint8Array): Reader => {
  const state = { at: 0 }

  const take = (count: number): Uint8Array => {
    if (state.at + count > bytes.length) {
      throw WireError.make({ reason: 'Ran past the end' })
    }
    const slice = bytes.subarray(state.at, state.at + count)
    state.at += count
    return slice
  }

  const u8 = (): number => {
    const value = bytes[state.at]
    if (value === undefined) {
      throw WireError.make({ reason: 'Ran past the end' })
    }
    state.at += 1
    return value
  }

  const varintFrom = (index: number, scale: number, total: number): number => {
    if (index >= VARINT_MAX_BYTES) {
      throw WireError.make({ reason: 'Varint too long' })
    }
    const byte = u8()
    const sum = total + (byte & 0x7f) * scale
    return byte < 128 ? sum : varintFrom(index + 1, scale * 128, sum)
  }

  const varint = () => varintFrom(0, 1, 0)

  const i16 = () => {
    const low = u8()
    const high = u8()
    const unsigned = low + high * 256
    return unsigned > INT16_MAX ? unsigned - 65536 : unsigned
  }

  const lengthOf = (maxLength: number) => {
    const length = varint()
    if (length > maxLength) {
      throw WireError.make({ reason: `Length ${length} over ${maxLength}` })
    }
    return length
  }

  return {
    u8,
    varint,
    zigzag: () => {
      const value = varint()
      return value % 2 === 0 ? value / 2 : -(value + 1) / 2
    },
    i16,
    fixed: scale => i16() / scale,
    position: () => i16() / POSITION_SCALE,
    f64: () => {
      const taken = take(8)
      return new DataView(
        taken.buffer,
        taken.byteOffset,
        taken.byteLength,
      ).getFloat64(0, true)
    },
    bool: () => u8() !== 0,
    bytes: maxLength => take(lengthOf(maxLength)).slice(),
    rest: () => take(bytes.length - state.at).slice(),
    text: maxLength => {
      const encoded = take(lengthOf(maxLength))
      try {
        return decoder.decode(encoded)
      } catch {
        throw WireError.make({ reason: 'Not UTF-8' })
      }
    },
    remaining: () => bytes.length - state.at,
  }
}

// NOTE: reads `count` items in order. `Array.makeBy` makes at least one
// item, and a count read off the wire may be zero.
export const repeat: {
  <A>(make: () => A): (count: number) => ReadonlyArray<A>
  <A>(count: number, make: () => A): ReadonlyArray<A>
} = Function.dual(2, <A>(count: number, make: () => A): ReadonlyArray<A> =>
  globalThis.Array.from({ length: count }, make),
)

// NOTE: writes a value and returns its bytes.
export const writeAll = (write: (writer: Writer) => void): Uint8Array => {
  const writer = makeWriter()
  write(writer)
  return writer.finish()
}

const isWireError = Schema.is(WireError)

const asWireError = (error: unknown): WireError =>
  isWireError(error) ? error : WireError.make({ reason: String(error) })

// NOTE: reads one value that must use every byte.
export const readAll: {
  <A>(
    read: (reader: Reader) => A,
  ): (bytes: Uint8Array) => Result.Result<A, WireError>
  <A>(
    bytes: Uint8Array,
    read: (reader: Reader) => A,
  ): Result.Result<A, WireError>
} = Function.dual(
  2,
  <A>(
    bytes: Uint8Array,
    read: (reader: Reader) => A,
  ): Result.Result<A, WireError> => {
    try {
      const reader = makeReader(bytes)
      const value = read(reader)
      return reader.remaining() === 0
        ? Result.succeed(value)
        : Result.fail(
            WireError.make({ reason: `${reader.remaining()} trailing bytes` }),
          )
    } catch (error) {
      return Result.fail(asWireError(error))
    }
  },
)

// NOTE: for a writer callback that may throw, such as a varint out of
// range: the bytes, or the reason.
export const tryWrite = (
  write: (writer: Writer) => void,
): Result.Result<Uint8Array, WireError> => {
  try {
    return Result.succeed(writeAll(write))
  } catch (error) {
    return Result.fail(asWireError(error))
  }
}
