import { Array, Record } from 'effect'

import { defaultAppearance } from '../domain/clientSchema'
import { occludersOf } from '../render/occluders'
import { roomShapes } from '../render/room/room'
import { CALLINGS } from '../world/heroes/calling'
import { LEVEL_SPECS, type LevelSpec, levelFor } from '../world/level/arena'
import type { ExitId } from '../world/schema/entitySchema'
import { playerSprites } from './appearance'
import { SEAT_LOOKS } from './seatLooks'

// NOTE: most sprites are built as their modules load, and the atlas
// generator (tools/sprites/build.ts) finds them by loading the modules. These
// are the ones built later, on first use: the starting look's frames in each calling's prop, the
// looks co-op teammates wear by seat in each calling's prop, and
// the room of every level with every set of exits open, with the occluders
// cut from it. A sprite built lazily belongs here, or it is encoded at
// runtime instead of drawn from the atlas, and tools/sprites/atlas.test.ts fails.

const NO_ITEMS: ReadonlyArray<ReadonlyArray<never>> = [[]]

const subsetsOf = <A>(
  items: ReadonlyArray<A>,
): ReadonlyArray<ReadonlyArray<A>> =>
  Array.reduce(
    items,
    NO_ITEMS,
    (subsets: ReadonlyArray<ReadonlyArray<A>>, item) => [
      ...subsets,
      ...Array.map(subsets, subset => Array.append(subset, item)),
    ],
  )

const levelStatesOf = (spec: LevelSpec) =>
  Array.map(
    subsetsOf(Array.map(spec.exits, ({ id }): ExitId => id)),
    openExits => levelFor(spec, openExits),
  )

export const precompileSprites = (): void => {
  Array.forEach(CALLINGS, calling => playerSprites(defaultAppearance, calling))
  Array.forEach(SEAT_LOOKS, look =>
    Array.forEach(CALLINGS, calling => playerSprites(look, calling)),
  )
  Array.forEach(Record.values(LEVEL_SPECS), spec =>
    Array.forEach(levelStatesOf(spec), level => {
      roomShapes(level)
      occludersOf(level)
    }),
  )
}
