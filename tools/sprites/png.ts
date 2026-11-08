import { Array } from 'effect'
import { deflateSync, inflateSync } from 'node:zlib'

// A compressed PNG writer for the sprite atlas, and the reader that checks
// it. The game's own writer (src/art/png.ts) stores scanlines uncompressed, which
// is fine for one small sprite at runtime; a file shipped with the build is
// worth compressing. Pixels with alpha 0 are written as transparent black,
// as the game's writer leaves them.

export type Raster = Readonly<{
  width: number
  height: number
  // RGBA, row after row
  pixels: Uint8Array
}>

const CRC_TABLE = globalThis.Array.from({ length: 256 }, (_, byte) => {
  let crc = byte
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const uint32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value >>> 0)
  return bytes
}

const chunk = (type: string, data: Uint8Array): Buffer => {
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  return Buffer.concat([uint32(data.length), typed, uint32(crc32(typed))])
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const COLOR_TYPE_INDEXED = 3
const COLOR_TYPE_RGBA = 6

const header = (width: number, height: number, colorType: number): Buffer =>
  chunk(
    'IHDR',
    Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, colorType, 0, 0, 0]),
    ]),
  )

const FILTER_NONE = 0
const FILTER_SUB = 1
const FILTER_UP = 2

const filtered = (
  rows: ReadonlyArray<Uint8Array>,
  bytesPerPixel: number,
  filter: number,
): Buffer => {
  const lines = Array.map(rows, (row, y) => {
    const above = rows[y - 1]
    const line = new Uint8Array(row.length + 1)
    line[0] = filter
    for (let index = 0; index < row.length; index++) {
      const value = row[index] ?? 0
      const left =
        index >= bytesPerPixel ? (row[index - bytesPerPixel] ?? 0) : 0
      const up = above?.[index] ?? 0
      line[index + 1] =
        filter === FILTER_SUB
          ? (value - left) & 0xff
          : filter === FILTER_UP
            ? (value - up) & 0xff
            : value
    }
    return line
  })
  return Buffer.concat(lines)
}

// NOTE: the smallest of the three simple filters for the whole image, at
// zlib's best level. Deterministic for one zlib.
const imageData = (
  rows: ReadonlyArray<Uint8Array>,
  bytesPerPixel: number,
): Buffer => {
  const candidates = Array.map(
    Array.make(FILTER_NONE, FILTER_SUB, FILTER_UP),
    filter => deflateSync(filtered(rows, bytesPerPixel, filter), { level: 9 }),
  )
  return Array.reduce(
    Array.tailNonEmpty(candidates),
    Array.headNonEmpty(candidates),
    (best, next) => (next.length < best.length ? next : best),
  )
}

const rowsOf = (
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): ReadonlyArray<Uint8Array> =>
  globalThis.Array.from({ length: height }, (_, y) =>
    bytes.subarray(y * width * bytesPerPixel, (y + 1) * width * bytesPerPixel),
  )

const PALETTE_MAX = 256

// NOTE: every distinct color, transparent pixels as one, in order of first
// appearance, or undefined past 256.
const paletteOf = (
  raster: Raster,
):
  | Readonly<{ colors: ReadonlyArray<number>; indices: Uint8Array }>
  | undefined => {
  const indexByColor = new Map<number, number>()
  const indices = new Uint8Array(raster.width * raster.height)
  const view = new DataView(raster.pixels.buffer, raster.pixels.byteOffset)
  for (let pixel = 0; pixel < indices.length; pixel++) {
    const rgba = view.getUint32(pixel * 4)
    const color = (rgba & 0xff) === 0 ? 0 : rgba
    let index = indexByColor.get(color)
    if (index === undefined) {
      if (indexByColor.size === PALETTE_MAX) {
        return undefined
      }
      index = indexByColor.size
      indexByColor.set(color, index)
    }
    indices[pixel] = index
  }
  return { colors: [...indexByColor.keys()], indices }
}

const clearedRgba = (raster: Raster): Uint8Array => {
  const pixels = Uint8Array.from(raster.pixels)
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] === 0) {
      pixels.fill(0, at, at + 4)
    }
  }
  return pixels
}

// NOTE: an indexed PNG when the image has 256 colors or fewer, which is
// about a third smaller for pixel art, else RGBA.
export const encodePng = (raster: Raster): Buffer => {
  const { width, height } = raster
  const palette = paletteOf(raster)
  const end = chunk('IEND', new Uint8Array(0))
  if (palette === undefined) {
    const rows = rowsOf(clearedRgba(raster), width, height, 4)
    return Buffer.concat([
      SIGNATURE,
      header(width, height, COLOR_TYPE_RGBA),
      chunk('IDAT', imageData(rows, 4)),
      end,
    ])
  }
  const rgb = Buffer.concat(
    Array.map(palette.colors, color =>
      Buffer.from([
        (color >>> 24) & 0xff,
        (color >>> 16) & 0xff,
        (color >>> 8) & 0xff,
      ]),
    ),
  )
  const alpha = Buffer.from(Array.map(palette.colors, color => color & 0xff))
  return Buffer.concat([
    SIGNATURE,
    header(width, height, COLOR_TYPE_INDEXED),
    chunk('PLTE', rgb),
    chunk('tRNS', alpha),
    chunk('IDAT', imageData(rowsOf(palette.indices, width, height, 1), 1)),
    end,
  ])
}

// READING

type Chunks = Readonly<Record<string, Buffer>>

const chunksOf = (png: Buffer): Chunks => {
  const found: Record<string, Buffer> = {}
  for (let at = SIGNATURE.length; at < png.length;) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString('ascii')
    const data = png.subarray(at + 8, at + 8 + length)
    const previous = found[type]
    found[type] =
      type === 'IDAT' && previous !== undefined
        ? Buffer.concat([previous, data])
        : data
    at += 12 + length
  }
  return found
}

const unfiltered = (
  data: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array => {
  const stride = width * bytesPerPixel
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)] ?? 0
    for (let index = 0; index < stride; index++) {
      const value = data[y * (stride + 1) + 1 + index] ?? 0
      const left =
        index >= bytesPerPixel
          ? (out[y * stride + index - bytesPerPixel] ?? 0)
          : 0
      const up = y > 0 ? (out[(y - 1) * stride + index] ?? 0) : 0
      if (
        filter !== FILTER_NONE &&
        filter !== FILTER_SUB &&
        filter !== FILTER_UP
      ) {
        throw new Error(`unexpected PNG filter ${filter}`)
      }
      out[y * stride + index] =
        filter === FILTER_SUB
          ? (value + left) & 0xff
          : filter === FILTER_UP
            ? (value + up) & 0xff
            : value
    }
  }
  return out
}

// NOTE: reads back what encodePng writes, to check the atlas before it
// ships.
export const decodePng = (png: Buffer): Raster => {
  const chunks = chunksOf(png)
  const ihdr = chunks['IHDR']
  const idat = chunks['IDAT']
  if (ihdr === undefined || idat === undefined) {
    throw new Error('not a PNG this writer made')
  }
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const colorType = ihdr[9]
  const data = inflateSync(idat)
  if (colorType === COLOR_TYPE_RGBA) {
    return { width, height, pixels: unfiltered(data, width, height, 4) }
  }
  const indices = unfiltered(data, width, height, 1)
  const rgb = chunks['PLTE'] ?? Buffer.alloc(0)
  const alpha = chunks['tRNS'] ?? Buffer.alloc(0)
  const pixels = new Uint8Array(width * height * 4)
  indices.forEach((index, pixel) => {
    pixels[pixel * 4] = rgb[index * 3] ?? 0
    pixels[pixel * 4 + 1] = rgb[index * 3 + 1] ?? 0
    pixels[pixel * 4 + 2] = rgb[index * 3 + 2] ?? 0
    pixels[pixel * 4 + 3] = alpha[index] ?? 255
  })
  return { width, height, pixels }
}
