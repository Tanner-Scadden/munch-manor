import { Array } from 'effect'

import type { Model } from '../../src/app/model'
import { makeValueHasher } from '../../src/shared/valueHash'
import { gameplayEntriesOf } from './fields'

export type GameplayHasher = Readonly<{
  hashValue: (value: unknown) => number
  hashModel: (model: Model) => number
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
