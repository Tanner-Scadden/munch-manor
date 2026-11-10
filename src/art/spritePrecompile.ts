import { Array, Record } from 'effect'

import { defaultAppearance } from '../domain/clientSchema'
import { everyRoomImage } from '../render/room/room'
import { CALLINGS } from '../world/heroes/calling'
import { LEVEL_SPECS } from '../world/level/plan'
import { playerSprites } from './appearance'
import { SEAT_LOOKS } from './seatLooks'

// NOTE: most sprites are built as their modules load, and the atlas
// generator (tools/sprites/build.ts) finds them by loading the modules. These
// are the ones built later, on first use: the starting look's frames in each
// calling's prop, the looks co-op teammates wear by seat in each calling's
// prop, and every level's room images, each room with each set of its own
// exits open (the occluders are crops of those images). A sprite built
// lazily belongs here, or it is encoded at runtime instead of drawn from the
// atlas, and tools/sprites/atlas.test.ts fails.

export const precompileSprites = (): void => {
  Array.forEach(CALLINGS, calling => playerSprites(defaultAppearance, calling))
  Array.forEach(SEAT_LOOKS, look =>
    Array.forEach(CALLINGS, calling => playerSprites(look, calling)),
  )
  Array.forEach(Record.values(LEVEL_SPECS), spec => {
    everyRoomImage(spec)
  })
}
