import { Array } from 'effect'

import { playerSprites } from '#art/appearance.ts'
import { SEAT_LOOKS } from '#art/seatLooks.ts'
import { defaultAppearance } from '#domain/clientSchema.ts'
import { everyRoomImage } from '#render/room/room.ts'
import { tallCoverOf } from '#render/room/tallCover.ts'
import { CALLINGS } from '#world/heroes/calling.ts'
import { levelFor } from '#world/level/arena.ts'
import { EVERY_LEVEL_SPEC } from '#world/level/plan.ts'

export const precompileSprites = (): void => {
  Array.forEach(CALLINGS, calling => playerSprites(defaultAppearance, calling))
  Array.forEach(SEAT_LOOKS, look =>
    Array.forEach(CALLINGS, calling => playerSprites(look, calling)),
  )
  Array.forEach(EVERY_LEVEL_SPEC, spec => {
    everyRoomImage(spec)
    tallCoverOf(levelFor(spec))
  })
}
