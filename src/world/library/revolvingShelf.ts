import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  TILE_PLAYER_SOLID,
  boxCenter,
  distanceToBox,
  hasTileFlag,
  levelOf,
  tileIndexAt,
} from '../level/arena'
import {
  forEachSeat,
  isStanding,
  modifySeat,
  seatStateAt,
} from '../party/party'
import type { World } from '../schema/world'
import { knockDownWhere } from '../stations/knockDown'
import { stationBoxOf } from '../stations/stationSpots'
import { TOOL_RULES } from '../stations/toolRules'
import { directionBetween } from '../step/geometry'
import { isGrounded } from '../zombies/zombies'

// The secret shelf, once it has swung open (src/world/library/secretShelf.ts),
// is also a revolving shelf (docs/ROOM_RESEARCH.md, "Decided" 6), a room
// tool on a short cooldown. Worked (a still player in its doorway or beside
// it, src/world/stations/stations.ts), it spins: whoever worked it comes
// out the same distance on the other side of the wall, and every zombie
// near it is flung away and dazed a moment, no damage. A quick way out of a
// crowd at the shelf, and a shove for the one who stays.

const RULES = TOOL_RULES.Shelf

// NOTE: a spin: workers through the wall, zombies flung.
export const spinShelf = (world: World): World => {
  const level = levelOf(world)
  return Option.match(stationBoxOf(level, 'Shelf'), {
    onNone: () => world,
    onSome: box => {
      const center = boxCenter(box)
      const spun = forEachSeat(world, (current, slot) => {
        const { seat, player } = seatStateAt(current, slot)
        const through = { x: 2 * center.x - player.x, y: player.y }
        return isStanding(seat) &&
          distanceToBox(player, box) <= RULES.reachPx &&
          !hasTileFlag(level, tileIndexAt(level, through), TILE_PLAYER_SOLID)
          ? modifySeat(current, slot, {
              player: each =>
                modifyFields(each, { x: () => through.x, y: () => through.y }),
            })
          : current
      })
      return knockDownWhere(spun, zombie =>
        isGrounded(zombie) &&
        zombie.kind !== 'Boss' &&
        distanceToBox(zombie, box) <= RULES.shovePx
          ? Option.some({
              damage: 0,
              direction: Option.getOrElse(
                directionBetween(center, zombie),
                () => ({ x: zombie.x < center.x ? -1 : 1, y: 0 }),
              ),
              knockbackSpeed: RULES.shoveSpeed,
              dazeMs: RULES.dazeMs,
            })
          : Option.none(),
      )
    },
  })
}
