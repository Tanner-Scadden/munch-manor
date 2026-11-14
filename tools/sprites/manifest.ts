import { Schema } from 'effect'

// NOTE: the atlas manifest ./build.ts writes and ./vitePlugin.ts reads, as
// a Schema of src/art/spriteAtlas.ts's SpriteAtlas, so the JSON goes through it.
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

// NOTE: each level spec's id to the files holding its room images.
export const AtlasLevels = Schema.Record(
  Schema.String,
  Schema.Array(Schema.Finite),
)

// NOTE: each source's normal map, in the same order, null for a room's.
const AtlasNormals = Schema.Array(Schema.NullOr(Schema.String))

export const SpriteAtlasManifest = Schema.Struct({
  sources: Schema.Array(Schema.String),
  normals: AtlasNormals,
  entries: AtlasEntries,
  levels: AtlasLevels,
})

// NOTE: what `build.ts --keys` prints: every sprite key.
export const SpriteKeys = Schema.Array(Schema.String)
