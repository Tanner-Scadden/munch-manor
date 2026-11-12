// The gameplay hash: one 32 bit number for the World and Gate fields of a
// Model (see fields.ts), equal in two runs exactly when their gameplay state
// is equal bit for bit, in any engine. The canonical form and the cache are
// the shared value hasher's (src/shared/valueHash.ts), which a recorded run
// hashes its last World with too (src/platform/recording.ts). The test
// compares the cached and uncached hashers to catch an update that mutates
// the Model in place.

import { Array } from 'effect'

import type { Model } from '../../src/app/model'
import { makeValueHasher } from '../../src/shared/valueHash'
import { gameplayEntriesOf } from './fields'

export type GameplayHasher = Readonly<{
  // The hash of any value in the canonical form.
  hashValue: (value: unknown) => number
  // The gameplay hash of a Model: its hashed fields by name, in sorted order.
  hashModel: (model: Model) => number
  // Each hashed field's own hash, to name the field that diverged.
  fieldHashes: (model: Model) => ReadonlyArray<readonly [string, number]>
}>

export const makeGameplayHasher = (
  options: Readonly<{ cached: boolean }> = { cached: true },
): GameplayHasher => {
  const { hashValue, hashNamed } = makeValueHasher(options)

  const fieldHashes = (
    model: Model,
  ): ReadonlyArray<readonly [string, number]> =>
    Array.map(gameplayEntriesOf(model), ([field, value]) => [
      field,
      hashValue(value),
    ])

  const hashModel = (model: Model): number => hashNamed(fieldHashes(model))

  return { hashValue, hashModel, fieldHashes }
}
