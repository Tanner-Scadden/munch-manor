import { Array, Record } from 'effect'

import { makeValueHasher } from '../../shared/valueHash'
import { World } from '../schema/world'

// The World's hash: each World field hashed by the shared value hasher
// (src/shared/valueHash.ts), named and sorted, so it reads only the World's
// own fields of any Model that holds them. A recorded run keeps the hash of
// its last World (src/platform/recording.ts), and a replay (tools/learn)
// checks that it plays back to the same one.

const WORLD_FIELDS: ReadonlyArray<keyof World> = Array.sort(
  Record.keys(World.fields),
  (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
)

// NOTE: uncached: a run hashes its World once, at its end, so a cache would
// only hold every object of the run alive until then.
export const hashWorld = (world: World): number => {
  const { hashValue, hashNamed } = makeValueHasher({ cached: false })
  return hashNamed(
    Array.map(WORLD_FIELDS, (field): readonly [string, number] => [
      field,
      hashValue(world[field]),
    ]),
  )
}
