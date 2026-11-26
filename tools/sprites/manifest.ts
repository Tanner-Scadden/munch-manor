import { Schema } from 'effect'

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

export const AtlasLevels = Schema.Record(
  Schema.String,
  Schema.Array(Schema.Finite),
)

const AtlasNormals = Schema.Array(Schema.NullOr(Schema.String))

export const SpriteAtlasManifest = Schema.Struct({
  sources: Schema.Array(Schema.String),
  normals: AtlasNormals,
  entries: AtlasEntries,
  levels: AtlasLevels,
})

export const SpriteKeys = Schema.Array(Schema.String)
