import { type AtlasEntry, useSpriteAtlas } from '#art/spriteAtlas.ts'

export const ATLAS_SHEET = 'atlas-sheet.png'

const places = new Map<string, AtlasEntry>()

const placeOf = (key: string): AtlasEntry => {
  const found = places.get(key)
  if (found !== undefined) {
    return found
  }
  const place: AtlasEntry = [0, places.size * 2, 0, 1, 1]
  places.set(key, place)
  return place
}

useSpriteAtlas({
  sources: [ATLAS_SHEET],
  entries: new Proxy<Record<string, AtlasEntry>>(
    {},
    {
      get: (_entries, key) =>
        typeof key === 'string' ? placeOf(key) : undefined,
    },
  ),
  normals: [],
  levels: {},
})
