import { Array, Option, String } from 'effect'

export type AtlasEntry = readonly [
  source: number,
  x: number,
  y: number,
  width: number,
  height: number,
]

export type SpriteAtlas = Readonly<{
  sources: ReadonlyArray<string>
  normals: ReadonlyArray<string | null>
  entries: Readonly<Record<string, AtlasEntry | null>>
  levels: Readonly<Record<string, ReadonlyArray<number>>>
}>

export type SpriteMode = 'Encode' | 'StandIn'

const EMPTY_ATLAS: SpriteAtlas = {
  sources: [],
  entries: {},
  normals: [],
  levels: {},
}

const state: { atlas: SpriteAtlas; mode: SpriteMode } = {
  atlas: EMPTY_ATLAS,
  mode: 'Encode',
}

export const useSpriteAtlas = (atlas: SpriteAtlas): void => {
  state.atlas = atlas
}

export const useSpriteMode = (mode: SpriteMode): void => {
  state.mode = mode
}

export const spriteMode = (): SpriteMode => state.mode

export const atlasRoomSources = (
  specId: string,
): Option.Option<ReadonlyArray<string>> =>
  Option.map(Option.fromNullishOr(state.atlas.levels[specId]), indices =>
    Array.getSomes(
      Array.map(indices, index => Array.get(state.atlas.sources, index)),
    ),
  )

export const atlasNormalOf = (src: string): Option.Option<string> =>
  Option.flatMap(
    Array.findFirstIndex(state.atlas.sources, s => s === src),
    index => Option.fromNullishOr(state.atlas.normals[index]),
  )

export type AtlasHit = Readonly<{
  src: string
  x: number
  y: number
  width: number
  height: number
}>

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

const STAND_IN_PREFIX = 'data:image/x-sprite;key='

export const standInSource = (key: string): string =>
  `${STAND_IN_PREFIX}${key},`

export const standInKeyOf = (src: string): Option.Option<string> =>
  String.startsWith(STAND_IN_PREFIX)(src)
    ? Option.some(String.slice(STAND_IN_PREFIX.length, -1)(src))
    : Option.none()
