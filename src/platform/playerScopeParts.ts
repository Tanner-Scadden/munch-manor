import { Schema } from 'effect'

import { MutationRejected } from '@munch/sync-engine'

export const PLAYER_SCOPE_KIND = 'player'

export const Count = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)

export const toRejected = (error: Schema.SchemaError) =>
  MutationRejected.make({ reason: error.message })
