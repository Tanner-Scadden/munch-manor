import { type AtlasEntry, useSpriteAtlas } from './spriteAtlas'

// NOTE: the setup of src/atlasHtml.scene.test.ts, which runs in a project of
// its own (vitest.config.ts) so no other test sees this atlas. As in a
// production build, every sprite is a cropped region of one shared sheet, so
// HTML that shows a sprite by its own `src` shows the whole sheet instead.
// The atlas must be in place before any module builds a sprite, which most
// do as they load, so it is set here and not in the test.
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
})
