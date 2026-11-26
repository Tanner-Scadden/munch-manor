import { Array } from 'effect'

import { defaultAppearance } from '../domain/clientSchema'
import { everyRoomImage } from '../render/room/room'
import { tallCoverOf } from '../render/room/tallCover'
import { CALLINGS } from '../world/heroes/calling'
import { levelFor } from '../world/level/arena'
import { EVERY_LEVEL_SPEC } from '../world/level/plan'
import { playerSprites } from './appearance'
import { SEAT_LOOKS } from './seatLooks'

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
