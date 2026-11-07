import { Schema } from 'effect'

// NOTE: the atlas manifest ./build.ts writes and ./vitePlugin.ts reads, as
// a Schema of src/spriteAtlas.ts's SpriteAtlas, so the JSON goes through it.
const AtlasEntry = Schema.Tuple([
  Schema.Finite,
  Schema.Finite,
  Schema.Finite,
  Schema.Finite,
  Schema.Finite,
])

export const AtlasEntries = Schema.Record(
  Schema.String,
  Schema.NullOr(AtlasEntry),
)

export const SpriteAtlasManifest = Schema.Struct({
  sources: Schema.Array(Schema.String),
  entries: AtlasEntries,
})

// NOTE: what `build.ts --keys` prints: every sprite key.
export const SpriteKeys = Schema.Array(Schema.String)
