import { Option, String } from 'effect'

// The prebuilt sprite images (docs/IMAGES_PLAN.md). A production build packs
// every sprite the game builds as it loads into a few PNG files and a
// manifest that finds a sprite by its content key, so the game draws a
// cropped region of a prebuilt file instead of encoding a PNG for each
// sprite. A key the manifest does not hold is encoded as before.

// NOTE: where a sprite sits: which source file, and its box in it.
export type AtlasEntry = readonly [
  source: number,
  x: number,
  y: number,
  width: number,
  height: number,
]

// NOTE: a key that maps to null is a sprite that draws nothing.
export type SpriteAtlas = Readonly<{
  sources: ReadonlyArray<string>
  entries: Readonly<Record<string, AtlasEntry | null>>
}>

// NOTE: `Encode` builds a PNG data URL for every sprite the atlas lacks, as
// the browser needs. `StandIn` builds none: each sprite gets a placeholder
// source named by its key, and its content is kept so tests and the atlas
// generator can read its pixels.
export type SpriteMode = 'Encode' | 'StandIn'

const EMPTY_ATLAS: SpriteAtlas = { sources: [], entries: {} }

const state: { atlas: SpriteAtlas; mode: SpriteMode } = {
  atlas: EMPTY_ATLAS,
  mode: 'Encode',
}

// NOTE: both must run before any module that builds sprites, since most
// sprites are built as their modules load.
export const useSpriteAtlas = (atlas: SpriteAtlas): void => {
  state.atlas = atlas
}

export const useSpriteMode = (mode: SpriteMode): void => {
  state.mode = mode
}

export const spriteMode = (): SpriteMode => state.mode

export type AtlasHit = Readonly<{
  src: string
  x: number
  y: number
  width: number
  height: number
}>

// NOTE: Some with Some for a prebuilt sprite, Some with None for one that
// draws nothing, None for a key the atlas does not hold.
export const atlasLookup = (
  key: string,
): Option.Option<Option.Option<AtlasHit>> => {
  const entry = state.atlas.entries[key]
  if (entry === undefined) {
    return Option.none()
  }
  if (entry === null) {
    return Option.some(Option.none())
  }
  const [source, x, y, width, height] = entry
  return Option.map(Option.fromNullishOr(state.atlas.sources[source]), src =>
    Option.some({ src, x, y, width, height }),
  )
}

// KEYS

// NOTE: cyrb53, a 53 bit string hash, as 11 base 36 digits. 1,500 keys
// collide with a chance near one in ten billion, and the generator checks.
export const spriteKeyOf = (text: string): string => {
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = Option.getOrElse(String.charCodeAt(text, index), () => 0)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^
    Math.imul(second ^ (second >>> 13), 3266489909)
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^
    Math.imul(first ^ (first >>> 13), 3266489909)
  const hash = 4294967296 * (2097151 & second) + (first >>> 0)
  return String.padStart(11, '0')(hash.toString(36))
}

// STAND-INS

const STAND_IN_PREFIX = 'data:image/x-sprite;key='

// NOTE: a data URL, so happy-dom loads it at once as it does the real ones,
// and the painter draws it.
export const standInSource = (key: string): string =>
  `${STAND_IN_PREFIX}${key},`

export const standInKeyOf = (src: string): Option.Option<string> =>
  String.startsWith(STAND_IN_PREFIX)(src)
    ? Option.some(String.slice(STAND_IN_PREFIX.length, -1)(src))
    : Option.none()
