import { Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { TILE_PLAYER_SOLID, hasTileFlag, levelOf } from '../level/arena'
import { boxCenter, distanceToBox } from '../level/tileGrid'
import { tileIndexAt } from '../level/tileQueries'
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

const RULES = TOOL_RULES.Shelf

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
                UiStruct.evolve(each, {
                  x: () => through.x,
                  y: () => through.y,
                }),
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
