import { Array, Function, Option, String, pipe } from 'effect'
import { Base64 } from 'effect/encoding'

// COLOR

export type Rgba = Readonly<{ r: number; g: number; b: number; a: number }>

const hexByte = (hex: string): number => Number.parseInt(hex, 16)

const doubled = (hex: string): string =>
  pipe(
    String.split(hex, ''),
    Array.map(digit => `${digit}${digit}`),
    Array.join(''),
  )

const fromHex = (hex: string): Option.Option<Rgba> => {
  const digits = /^[0-9a-f]+$/i.test(hex) ? hex : ''
  const full =
    digits.length === 3 || digits.length === 4 ? doubled(digits) : digits
  if (full.length !== 6 && full.length !== 8) {
    return Option.none()
  }

  return Option.some({
    r: hexByte(String.slice(0, 2)(full)),
    g: hexByte(String.slice(2, 4)(full)),
    b: hexByte(String.slice(4, 6)(full)),
    a: full.length === 8 ? hexByte(String.slice(6, 8)(full)) : 255,
  })
}

const FUNCTIONAL_COLOR =
  /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/

const fromFunctional = (color: string): Option.Option<Rgba> =>
  pipe(
    Option.fromNullishOr(FUNCTIONAL_COLOR.exec(color)),
    Option.map(([, r, g, b, alpha]) => ({
      r: Number(r),
      g: Number(g),
      b: Number(b),
      a: alpha === undefined ? 255 : Math.round(Number(alpha) * 255),
    })),
  )

export const parseColor = (color: string): Option.Option<Rgba> =>
  String.startsWith('#')(color)
    ? fromHex(String.slice(1)(color))
    : fromFunctional(color)

// NOTE: the same source over blend a canvas uses when a later rectangle
// covers an earlier one, on straight (not premultiplied) color.
const blend = (under: Rgba, over: Rgba): Rgba => {
  if (over.a === 255 || under.a === 0) {
    return over
  }

  const overShare = over.a / 255
  const underShare = (under.a / 255) * (1 - overShare)
  const alpha = overShare + underShare
  const mix = (top: number, bottom: number) =>
    Math.round((top * overShare + bottom * underShare) / alpha)
  return {
    r: mix(over.r, under.r),
    g: mix(over.g, under.g),
    b: mix(over.b, under.b),
    a: Math.round(alpha * 255),
  }
}

// RASTER

export type Fill = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: Rgba
}>

const NO_FILTER = 0
const BYTES_PER_PIXEL = 4

const rowLength = (width: number): number => 1 + width * BYTES_PER_PIXEL

// NOTE: plain loops over the byte buffer, since this runs for every pixel of
// every sprite as the game loads, behind the splash. A callback per pixel
// cost several times more.
const paintFill =
  (lines: Uint8Array, width: number, height: number) =>
  (fill: Fill): void => {
    const left = Math.max(0, fill.x)
    const right = Math.min(width, fill.x + fill.width)
    const top = Math.max(0, fill.y)
    const bottom = Math.min(height, fill.y + fill.height)
    const over = fill.color
    for (let y = top; y < bottom; y++) {
      const rowStart = y * rowLength(width) + 1
      for (let x = left; x < right; x++) {
        const at = rowStart + x * BYTES_PER_PIXEL
        if (over.a === 255) {
          lines[at] = over.r
          lines[at + 1] = over.g
          lines[at + 2] = over.b
          lines[at + 3] = 255
          continue
        }
        const under: Rgba = {
          r: lines[at] ?? 0,
          g: lines[at + 1] ?? 0,
          b: lines[at + 2] ?? 0,
          a: lines[at + 3] ?? 0,
        }
        const { r, g, b, a } = blend(under, over)
        if (a === 0) {
          lines.fill(0, at, at + BYTES_PER_PIXEL)
        } else {
          lines[at] = r
          lines[at + 1] = g
          lines[at + 2] = b
          lines[at + 3] = a
        }
      }
    }
  }

// NOTE: the scanlines are painted into one local byte buffer in place, one
// fill after another, the way a canvas paints the same rectangles. Every
// scanline starts with PNG's "no filter" byte, which a new buffer already
// holds as zero.
const scanlinesOf = (
  width: number,
  height: number,
  fills: ReadonlyArray<Fill>,
): Uint8Array => {
  const lines = new Uint8Array(height * rowLength(width)).fill(NO_FILTER)
  Array.forEach(
    Array.filter(fills, fill => fill.width > 0 && fill.height > 0),
    paintFill(lines, width, height),
  )
  return lines
}

// NOTE: the RGBA pixels the PNG holds, row after row with no filter bytes,
// for tests and the atlas generator to read without a PNG decoder.
export const rasterOf: {
  (height: number, fills: ReadonlyArray<Fill>): (width: number) => Uint8Array
  (width: number, height: number, fills: ReadonlyArray<Fill>): Uint8Array
} = Function.dual(
  3,
  (width: number, height: number, fills: ReadonlyArray<Fill>): Uint8Array => {
    const lines = scanlinesOf(width, height, fills)
    const raster = new Uint8Array(width * height * BYTES_PER_PIXEL)
    for (let y = 0; y < height; y++) {
      const start = y * rowLength(width) + 1
      raster.set(
        lines.subarray(start, start + width * BYTES_PER_PIXEL),
        y * width * BYTES_PER_PIXEL,
      )
    }
    return raster
  },
)

// PNG

const CRC_TABLE: ReadonlyArray<number> = Array.makeBy(256, byte =>
  Array.reduce(
    Array.makeBy(8, () => 0),
    byte,
    crc => ((crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) >>> 0 : crc >>> 1),
  ),
)

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index++) {
    crc = (CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const ADLER_MOD = 65521

// NOTE: the largest run of bytes whose sums cannot pass 2^32 before the
// modulo, as in zlib, so the loop takes the modulo once per run.
const ADLER_RUN = 5552

const adler32 = (bytes: Uint8Array): number => {
  let low = 1
  let high = 0
  for (let start = 0; start < bytes.length; start += ADLER_RUN) {
    const end = Math.min(bytes.length, start + ADLER_RUN)
    for (let index = start; index < end; index++) {
      low += bytes[index] ?? 0
      high += low
    }
    low %= ADLER_MOD
    high %= ADLER_MOD
  }
  return ((high << 16) | low) >>> 0
}

const uint32 = (value: number): ReadonlyArray<number> => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

const uint16LittleEndian = (value: number): ReadonlyArray<number> => [
  value & 0xff,
  (value >>> 8) & 0xff,
]

const concatBytes = (
  parts: ReadonlyArray<Uint8Array | ReadonlyArray<number>>,
): Uint8Array => {
  const joined = new Uint8Array(
    Array.reduce(parts, 0, (total, part) => total + part.length),
  )
  Array.reduce(parts, 0, (at, part) => {
    joined.set(part, at)
    return at + part.length
  })
  return joined
}

const asciiBytes = (text: string): ReadonlyArray<number> =>
  Array.map(String.split(text, ''), letter =>
    Option.getOrElse(String.charCodeAt(letter, 0), () => 0),
  )

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typed = concatBytes([asciiBytes(type), data])
  return concatBytes([uint32(data.length), typed, uint32(crc32(typed))])
}

const STORED_BLOCK_MAX = 65535

// NOTE: the image data goes in uncompressed (stored) deflate blocks. A
// sprite is a few hundred bytes, so compressing it would save little, and
// stored blocks keep the encoder small and exactly deterministic.
const zlibStored = (data: Uint8Array): Uint8Array => {
  const blockCount = Math.max(1, Math.ceil(data.length / STORED_BLOCK_MAX))
  const blocks = Array.makeBy(blockCount, index => {
    const block = data.subarray(
      index * STORED_BLOCK_MAX,
      (index + 1) * STORED_BLOCK_MAX,
    )
    return concatBytes([
      [index === blockCount - 1 ? 1 : 0],
      uint16LittleEndian(block.length),
      uint16LittleEndian(~block.length & 0xffff),
      block,
    ])
  })
  return concatBytes([[0x78, 0x01], ...blocks, uint32(adler32(data))])
}

const PNG_SIGNATURE: ReadonlyArray<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]

const BIT_DEPTH = 8
const COLOR_TYPE_RGBA = 6

const pngBytes = (
  width: number,
  height: number,
  fills: ReadonlyArray<Fill>,
): Uint8Array =>
  concatBytes([
    PNG_SIGNATURE,
    chunk(
      'IHDR',
      Uint8Array.from([
        ...uint32(width),
        ...uint32(height),
        BIT_DEPTH,
        COLOR_TYPE_RGBA,
        0,
        0,
        0,
      ]),
    ),
    chunk('IDAT', zlibStored(scanlinesOf(width, height, fills))),
    chunk('IEND', new Uint8Array(0)),
  ])

export const pngDataUrl: {
  (height: number, fills: ReadonlyArray<Fill>): (width: number) => string
  (width: number, height: number, fills: ReadonlyArray<Fill>): string
} = Function.dual(
  3,
  (width: number, height: number, fills: ReadonlyArray<Fill>): string =>
    `data:image/png;base64,${Base64.encode(pngBytes(width, height, fills))}`,
)
