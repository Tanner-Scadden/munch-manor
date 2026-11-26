import { Array, Record } from 'effect'

import { makeValueHasher } from '../../shared/valueHash'
import { World } from '../schema/world'

const WORLD_FIELDS: ReadonlyArray<keyof World> = Array.sort(
  Record.keys(World.fields),
  (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
)

export const hashWorld = (world: World): number => {
  const { hashValue, hashNamed } = makeValueHasher({ cached: false })
  return hashNamed(
    Array.map(WORLD_FIELDS, (field): readonly [string, number] => [
      field,
      hashValue(world[field]),
    ]),
  )
}
