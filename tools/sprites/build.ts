import {
  Array,
  Clock,
  Console,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Predicate,
  Record,
  Result,
  Schema,
  String,
} from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { normalPixelsOf } from '../../src/art/atlas/normalMap'
import { rasterOf } from '../../src/art/atlas/png'
import {
  type AtlasEntry,
  type SpriteAtlas,
  standInKeyOf,
  useSpriteMode,
} from '../../src/art/atlas/spriteAtlas'
import { encodeJson, readJsonFile } from '../json'
import { SpriteAtlasManifest, SpriteKeys } from './manifest'
import { packShelves } from './pack'
import { type Raster, decodePng, encodePng } from './png'

Object.assign(globalThis, { __BUILD_ID__: 'sprites' })

useSpriteMode('StandIn')

const { spriteContents } = await import('../../src/art/sprite')
await import('../../src/app/view')
await import('../../src/app/main')
await import('../../src/app/boot')
const { precompileSprites } =
  await import('../../src/art/atlas/spritePrecompile')
precompileSprites()
const { everyRoomImage } = await import('../../src/render/room/room')
const { EVERY_LEVEL_SPEC } = await import('../../src/world/level/plan')

const contents = spriteContents()
const keys = Array.sort([...contents.keys()], String.Order)

const PreviousManifest = Schema.Struct({
  sources: Schema.Array(Schema.String),
  normals: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
})

const filesOf = (
  manifest: Readonly<{
    sources: ReadonlyArray<string>
    normals?: ReadonlyArray<string | null>
  }>,
): ReadonlyArray<string> => [
  ...manifest.sources,
  ...Array.filter(manifest.normals ?? [], Predicate.isNotNull),
]

const GENERATOR_VERSION = 5
const MANIFEST_FILE = 'manifest.json'
const SIGNATURE_FILE = 'signature.txt'

class DigestFailed extends Schema.TaggedError<
  DigestFailed,
  { readonly brand: unique symbol }
>()('DigestFailed', { message: Schema.String }) {}

class AtlasMismatch extends Schema.TaggedError<
  AtlasMismatch,
  { readonly brand: unique symbol }
>()('AtlasMismatch', { message: Schema.String }) {}

const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const sha256 = (
  ...parts: ReadonlyArray<Uint8Array>
): Effect.Effect<string, DigestFailed> =>
  Effect.gen(function* () {
    const whole = new Uint8Array(
      Array.reduce(parts, 0, (total, part) => total + part.length),
    )
    Array.reduce(parts, 0, (offset, part) => {
      whole.set(part, offset)
      return offset + part.length
    })
    const digest = yield* Effect.tryPromise({
      try: () => globalThis.crypto.subtle.digest('SHA-256', whole),
      catch: error => DigestFailed.make({ message: globalThis.String(error) }),
    })
    return Array.join(
      Array.map(Array.fromIterable(new Uint8Array(digest)), byte =>
        String.padStart(2, '0')(byte.toString(16)),
      ),
      '',
    )
  })

type Image = Readonly<{
  keys: ReadonlyArray<string>
  raster: Raster
  hash: string
}>

const imagesOf = Effect.gen(function* () {
  const imagesByHash = new Map<
    string,
    { keys: Array<string>; raster: Raster }
  >()
  for (const key of keys) {
    const content = contents.get(key)
    if (content === undefined) {
      continue
    }
    const pixels = rasterOf(content.width, content.height, content.fills)
    const hash = yield* sha256(
      textBytes(`${content.width}x${content.height}`),
      pixels,
    )
    const found = imagesByHash.get(hash)
    if (found === undefined) {
      imagesByHash.set(hash, {
        keys: [key],
        raster: { width: content.width, height: content.height, pixels },
      })
    } else {
      found.keys.push(key)
    }
  }
  const images: ReadonlyArray<Image> = Array.sort(
    Array.map([...imagesByHash.entries()], ([hash, image]) => ({
      hash,
      keys: image.keys,
      raster: image.raster,
    })),
    (first: Image, second: Image) => (first.hash < second.hash ? -1 : 1),
  )
  return images
})

const OWN_FILE_AREA = 16_384
const isOwnFile = ({ raster }: Image) =>
  raster.width * raster.height > OWN_FILE_AREA

const ATLAS_WIDTH = 1024
const FRAME = 1

type Sheet = Readonly<{
  raster: Raster
  placed: ReadonlyArray<Placed>
  frame: number
}>
type Placed = Readonly<{ image: Image; x: number; y: number }>

const clamp = (value: number, high: number): number =>
  Math.min(Math.max(value, 0), high)

const sheetOf = (
  width: number,
  height: number,
  placed: ReadonlyArray<Placed>,
  frame: number,
): Sheet => {
  const pixels = new Uint8Array(width * height * 4)
  for (const { image, x, y } of placed) {
    const { raster } = image
    for (let row = -frame; row < raster.height + frame; row++) {
      const sourceRow = clamp(row, raster.height - 1)
      for (let column = -frame; column < raster.width + frame; column++) {
        const from =
          (sourceRow * raster.width + clamp(column, raster.width - 1)) * 4
        pixels.set(
          raster.pixels.subarray(from, from + 4),
          ((y + row) * width + x + column) * 4,
        )
      }
    }
  }
  return { raster: { width, height, pixels }, placed, frame }
}

type Packed = Readonly<{
  width: number
  height: number
  sheets: ReadonlyArray<Readonly<{ name: string; sheet: Sheet }>>
}>

const sheetsOf = (images: ReadonlyArray<Image>): Packed => {
  const atlasImages = Array.filter(images, image => !isOwnFile(image))
  const packed = packShelves(
    Array.map(atlasImages, image => ({
      item: image,
      width: image.raster.width + 2 * FRAME,
      height: image.raster.height + 2 * FRAME,
    })),
    ATLAS_WIDTH,
    0,
  )
  return {
    width: packed.width,
    height: packed.height,
    sheets: [
      {
        name: 'sprites',
        sheet: sheetOf(
          packed.width,
          packed.height,
          Array.map(packed.placed, ({ item, x, y }) => ({
            image: item,
            x: x + FRAME,
            y: y + FRAME,
          })),
          FRAME,
        ),
      },
      ...Array.map(Array.filter(images, isOwnFile), (image, index) => ({
        name: `sprite-${index}`,
        sheet: sheetOf(
          image.raster.width,
          image.raster.height,
          [{ image, x: 0, y: 0 }],
          0,
        ),
      })),
    ],
  }
}

const normalSheetOf = ({ raster, placed, frame }: Sheet): Raster =>
  sheetOf(
    raster.width,
    raster.height,
    Array.map(placed, ({ image, x, y }) => ({
      image: { ...image, raster: normalRasterOf(image.raster) },
      x,
      y,
    })),
    frame,
  ).raster

const normalRasterOf = (raster: Raster): Raster => ({
  width: raster.width,
  height: raster.height,
  pixels: new Uint8Array(
    normalPixelsOf({
      pixels: new Uint8ClampedArray(raster.pixels),
      width: raster.width,
      height: raster.height,
    }).buffer,
  ),
})

const samePixels = (sheet: Raster, { image, x, y }: Placed): boolean => {
  const { raster } = image
  for (let row = 0; row < raster.height; row++) {
    for (let column = 0; column < raster.width * 4; column++) {
      const want = raster.pixels[row * raster.width * 4 + column] ?? 0
      const alpha =
        raster.pixels[row * raster.width * 4 + (column - (column % 4)) + 3] ?? 0
      const got = sheet.pixels[((y + row) * sheet.width + x) * 4 + column] ?? 0
      if (got !== (alpha === 0 ? 0 : want)) {
        return false
      }
    }
  }
  return true
}

const fileNameOf = (
  name: string,
  png: Uint8Array,
): Effect.Effect<string, DigestFailed> =>
  Effect.map(sha256(png), hash => `${name}-${String.slice(0, 10)(hash)}.png`)

const fileExists = (
  fs: FileSystem.FileSystem,
  path: string,
): Effect.Effect<boolean> =>
  fs.exists(path).pipe(Effect.orElseSucceed(() => false))

const writeAtlas = (outDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const started = yield* Clock.currentTimeMillis
    const signature = yield* sha256(
      textBytes(`${GENERATOR_VERSION}\n${Array.join(keys, '\n')}`),
    )
    const signaturePath = path.join(outDir, SIGNATURE_FILE)
    const previousSignature = (yield* fileExists(fs, signaturePath))
      ? yield* fs.readFileString(signaturePath)
      : undefined
    const hasManifest = yield* fileExists(fs, path.join(outDir, MANIFEST_FILE))
    if (previousSignature === signature && hasManifest) {
      yield* Console.log(
        `sprites: ${keys.length} sprites unchanged, reused ${outDir}`,
      )
      return
    }

    const images = yield* imagesOf
    const { width, height, sheets } = sheetsOf(images)

    yield* fs.makeDirectory(outDir, { recursive: true })
    const entries: Record<string, AtlasEntry> = {}
    const fileNames: Array<string> = []
    let bytes = 0
    for (const [source, { name, sheet }] of sheets.entries()) {
      const png = encodePng(sheet.raster)
      const decoded = decodePng(png)
      for (const placed of sheet.placed) {
        if (!samePixels(decoded, placed)) {
          return yield* AtlasMismatch.make({
            message: `sprites: ${placed.image.keys[0]} does not read back from ${name}`,
          })
        }
        for (const key of placed.image.keys) {
          entries[key] = [
            source,
            placed.x,
            placed.y,
            placed.image.raster.width,
            placed.image.raster.height,
          ]
        }
      }
      const fileName = yield* fileNameOf(name, png)
      yield* fs.writeFile(path.join(outDir, fileName), png)
      fileNames.push(fileName)
      bytes += png.length
    }

    const levels = levelSourcesOf(entries)
    const roomSources = new Set(Array.flatten(Record.values(levels)))
    const normalNames: Array<string | null> = []
    for (const [source, { name, sheet }] of sheets.entries()) {
      if (roomSources.has(source)) {
        normalNames.push(null)
        continue
      }
      const png = encodePng(normalSheetOf(sheet))
      const fileName = yield* fileNameOf(`${name}-normal`, png)
      yield* fs.writeFile(path.join(outDir, fileName), png)
      normalNames.push(fileName)
      bytes += png.length
    }

    const manifest: SpriteAtlas = {
      sources: fileNames,
      normals: normalNames,
      entries,
      levels,
    }
    const manifestPath = path.join(outDir, MANIFEST_FILE)
    const previousFiles: ReadonlyArray<string> = (yield* fileExists(
      fs,
      manifestPath,
    ))
      ? yield* Effect.map(readJsonFile(PreviousManifest, manifestPath), filesOf)
      : []
    yield* fs.writeFileString(
      `${manifestPath}.next`,
      `${encodeJson(SpriteAtlasManifest)(manifest)}\n`,
    )
    yield* fs.rename(`${manifestPath}.next`, manifestPath)
    yield* fs.writeFileString(signaturePath, signature)
    const files = yield* fs.readDirectory(outDir)
    for (const file of files) {
      if (
        String.endsWith('.png')(file) &&
        !Array.contains(filesOf(manifest), file) &&
        !Array.contains(previousFiles, file)
      ) {
        yield* fs.remove(path.join(outDir, file))
      }
    }
    const finished = yield* Clock.currentTimeMillis
    yield* Console.log(
      `sprites: ${keys.length} sprites, ${images.length} distinct, in ${sheets.length} files (atlas ${width}x${height}), ${Math.round(bytes / 1024)} KB, ${Math.round(finished - started)} ms`,
    )
  })

const levelSourcesOf = (
  entries: Readonly<Record<string, AtlasEntry>>,
): Record<string, ReadonlyArray<number>> =>
  Record.fromEntries(
    Array.map(EVERY_LEVEL_SPEC, spec => [
      spec.id,
      Array.sort(
        Array.dedupe(
          Array.filterMap(everyRoomImage(spec), shape =>
            shape._tag === 'Image'
              ? Option.match(
                  Option.flatMap(standInKeyOf(shape.src), key =>
                    Option.fromNullishOr(entries[key]),
                  ),
                  {
                    onNone: () => Result.failVoid,
                    onSome: ([source]) => Result.succeed(source),
                  },
                )
              : Result.failVoid,
          ),
        ),
        Order.Number,
      ),
    ]),
  )

class Usage extends Schema.TaggedError<
  Usage,
  { readonly brand: unique symbol }
>()('Usage', { message: Schema.String }) {}

const program = Effect.gen(function* () {
  const args = Array.drop(process.argv, 2)
  if (Array.contains(args, '--keys')) {
    yield* Console.log(encodeJson(SpriteKeys)(keys))
    return
  }
  const maybeOutDir = Array.head(args)
  if (Option.isNone(maybeOutDir)) {
    return yield* Usage.make({
      message: 'usage: bun tools/sprites/build.ts <out dir> | --keys',
    })
  }
  yield* writeAtlas(maybeOutDir.value)
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
