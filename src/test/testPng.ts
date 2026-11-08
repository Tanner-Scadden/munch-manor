import { Array, Option, Result, String, pipe } from 'effect'
import { Base64 } from 'effect/encoding'

import { type Rgba, rasterOf } from '../art/png'
import { spriteContentOf } from '../art/sprite'

// NOTE: reads back the PNG data URLs that src/art/png.ts writes, and the
// stand-ins tests draw instead, for tests. It only knows that writer's shape:
// one IDAT chunk of stored deflate blocks and unfiltered RGBA scanlines.

type DecodedPng = Readonly<{
  width: number
  height: number
  pixels: ReadonlyArray<Rgba>
}>

const PNG_PREFIX = 'data:image/png;base64,'

const readUint32 = (bytes: Uint8Array, at: number): number =>
  (((bytes[at] ?? 0) << 24) |
    ((bytes[at + 1] ?? 0) << 16) |
    ((bytes[at + 2] ?? 0) << 8) |
    (bytes[at + 3] ?? 0)) >>>
  0

const asciiAt = (bytes: Uint8Array, at: number): string =>
  globalThis.String.fromCharCode(...bytes.subarray(at, at + 4))

type Chunk = Readonly<{ type: string; data: Uint8Array }>

const chunksFrom = (bytes: Uint8Array, at: number): ReadonlyArray<Chunk> => {
  if (at >= bytes.length) {
    return []
  }

  const length = readUint32(bytes, at)
  const chunk = {
    type: asciiAt(bytes, at + 4),
    data: bytes.subarray(at + 8, at + 8 + length),
  }
  return [chunk, ...chunksFrom(bytes, at + 12 + length)]
}

const storedBlocks = (zlib: Uint8Array, at: number): ReadonlyArray<number> => {
  const isFinal = ((zlib[at] ?? 0) & 1) === 1
  const length = (zlib[at + 1] ?? 0) | ((zlib[at + 2] ?? 0) << 8)
  const block = Array.fromIterable(zlib.subarray(at + 5, at + 5 + length))
  return isFinal ? block : [...block, ...storedBlocks(zlib, at + 5 + length)]
}

// NOTE: tests run in stand-in mode (src/test/vitest-setup.ts), where a sprite's
// source names its key and its pixels are kept in src/art/sprite.ts.
const standInPng = (src: string): Option.Option<DecodedPng> =>
  Option.map(spriteContentOf(src), ({ width, height, fills }) => {
    const raster = rasterOf(width, height, fills)
    return {
      width,
      height,
      pixels: Array.makeBy(width * height, index => ({
        r: raster[index * 4] ?? 0,
        g: raster[index * 4 + 1] ?? 0,
        b: raster[index * 4 + 2] ?? 0,
        a: raster[index * 4 + 3] ?? 0,
      })),
    }
  })

export const decodePng = (src: string): Option.Option<DecodedPng> => {
  if (!String.startsWith(PNG_PREFIX)(src)) {
    return standInPng(src)
  }

  return pipe(
    Base64.decode(String.slice(PNG_PREFIX.length)(src)),
    Result.getSuccess,
    Option.flatMap(bytes => {
      const chunks = chunksFrom(bytes, 8)
      return Option.all({
        header: Array.findFirst(chunks, ({ type }) => type === 'IHDR'),
        image: Array.findFirst(chunks, ({ type }) => type === 'IDAT'),
      })
    }),
    Option.map(({ header, image }) => {
      const width = readUint32(header.data, 0)
      const height = readUint32(header.data, 4)
      const raw = storedBlocks(image.data, 2)
      const rowLength = 1 + width * 4
      return {
        width,
        height,
        pixels: Array.makeBy(width * height, index => {
          const at =
            Math.floor(index / width) * rowLength + 1 + (index % width) * 4
          return {
            r: raw[at] ?? 0,
            g: raw[at + 1] ?? 0,
            b: raw[at + 2] ?? 0,
            a: raw[at + 3] ?? 0,
          }
        }),
      }
    }),
  )
}

const hexPair = (value: number): string =>
  String.padStart(2, '0')(value.toString(16))

export const hexOf = ({ r, g, b }: Rgba): string =>
  `#${hexPair(r)}${hexPair(g)}${hexPair(b)}`

export const imageColors = (src: string): ReadonlyArray<string> =>
  Option.match(decodePng(src), {
    onNone: () => [],
    onSome: ({ pixels }) =>
      pipe(
        pixels,
        Array.filter(({ a }) => a > 0),
        Array.map(hexOf),
        Array.dedupe,
      ),
  })
