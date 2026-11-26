import { type Effect, Schema } from 'effect'

import { World } from '../schema/world'

const worldCodec = Schema.toCodecJson(World)
const WorldJson = Schema.fromJsonString(worldCodec)

export const worldToJson: (
  world: World,
) => Effect.Effect<string, Schema.SchemaError> = Schema.encodeEffect(WorldJson)

export const worldFromJson: (
  text: string,
) => Effect.Effect<World, Schema.SchemaError> = Schema.decodeEffect(WorldJson)
