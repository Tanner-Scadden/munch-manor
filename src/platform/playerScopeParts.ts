import { Schema } from 'effect'

import { MutationRejected } from '@munch/sync-engine'

// What the player scope's modules share (src/platform/playerScope.ts and
// the modules split from it, src/platform/missionScope.ts): the scope's
// kind, a count that is a whole number, and a Schema error as a refusal.
// Shared with the sync Worker, so it imports only `effect` and the sync
// engine.

export const PLAYER_SCOPE_KIND = 'player'

export const Count = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)

export const toRejected = (error: Schema.SchemaError) =>
  MutationRejected.make({ reason: error.message })
