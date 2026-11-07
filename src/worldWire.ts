import { type Effect, Schema } from 'effect'

import { World } from './world'

// The World as one JSON text and back, for tools that carry a World
// between engines (tools/determinism) and the room that keeps a won run. The
// co-op room's wire is the binary codec in src/worldCodec.ts.

const worldCodec = Schema.toCodecJson(World)
const WorldJson = Schema.fromJsonString(worldCodec)

export const worldToJson: (
  world: World,
) => Effect.Effect<string, Schema.SchemaError> = Schema.encodeEffect(WorldJson)

export const worldFromJson: (
  text: string,
) => Effect.Effect<World, Schema.SchemaError> = Schema.decodeEffect(WorldJson)
