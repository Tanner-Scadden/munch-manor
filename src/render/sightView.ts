import { Option } from 'effect'

import { MS_PER_SECOND } from '../shared/constants'
import { firingStats, withLaserSight } from '../world/gear/powerups'
import {
  type WeaponStats,
  heldTier,
  heldWeapon,
  isWieldingMelee,
} from '../world/gear/weapons'
import { type Level, levelOf } from '../world/level/arena'
import { findReach } from '../world/level/tileQueries'
import { focusOf } from '../world/party/party'
import type { Vector } from '../world/schema/entitySchema'
import type { World } from '../world/schema/world'
import { addVectors, scaleVector } from '../world/step/geometry'
import * as Draw from './draw'

// NOTE: the sight is a shop upgrade for the run, and it shows for any aim,
// keys or pointer. A gun that shoots straight gets a laser line, and one that
// scatters gets a fan as wide as its spread. Both stop at the first wall or
// doorway, as the shots would, and both reach as far as a shot flies.

const LASER_COLOR = 'rgba(255, 58, 63, 0.55)'
const FAN_FILL = 'rgba(255, 58, 63, 0.12)'
const FAN_EDGE_COLOR = 'rgba(255, 58, 63, 0.35)'

// NOTE: the knife and the Pan fire nothing, so the sight goes dark while
// the melee slot is in hand.
const hasSight = (model: World): boolean =>
  focusOf(model).laserSight === 'Fitted' &&
  !isWieldingMelee(focusOf(model).player)

const rangeOf = (stats: WeaponStats): number =>
  (stats.bulletSpeed * stats.bulletLifetimeMs) / MS_PER_SECOND

const rotated = ({ x, y }: Vector, angle: number): Vector => ({
  x: x * Math.cos(angle) - y * Math.sin(angle),
  y: x * Math.sin(angle) + y * Math.cos(angle),
})

const reachAlong = (
  level: Level,
  from: Vector,
  direction: Vector,
  length: number,
): Vector =>
  findReach(level, from, addVectors(from, scaleVector(direction, length)))

const laserShapes = (from: Vector, to: Vector): ReadonlyArray<Draw.Shape> => [
  Draw.Path({
    instructions: [
      Draw.MoveTo({ x: from.x, y: from.y }),
      Draw.LineTo({ x: to.x, y: to.y }),
    ],
    stroke: LASER_COLOR,
    lineWidth: 1,
  }),
]

const fanShapes = (
  from: Vector,
  left: Vector,
  right: Vector,
): ReadonlyArray<Draw.Shape> => [
  Draw.Path({
    instructions: [
      Draw.MoveTo({ x: from.x, y: from.y }),
      Draw.LineTo({ x: left.x, y: left.y }),
      Draw.LineTo({ x: right.x, y: right.y }),
      Draw.Close(),
    ],
    fill: FAN_FILL,
    stroke: FAN_EDGE_COLOR,
    lineWidth: 1,
  }),
]

export const aimSightShapes = (model: World): ReadonlyArray<Draw.Shape> => {
  if (!hasSight(model)) {
    return []
  }

  return Option.match(focusOf(model).intent.maybeAim, {
    onNone: () => [],
    onSome: aim => {
      const { player } = focusOf(model)
      const level = levelOf(model)
      const stats = withLaserSight(
        firingStats(
          focusOf(model).boosts,
          heldWeapon(player.arsenal),
          heldTier(player),
        ),
      )
      const muzzle = addVectors(player, scaleVector(aim, stats.muzzleReach))
      const range = rangeOf(stats)
      if (stats.spread <= 0) {
        return laserShapes(muzzle, reachAlong(level, muzzle, aim, range))
      } else {
        const halfSpread = stats.spread / 2
        return fanShapes(
          muzzle,
          reachAlong(level, muzzle, rotated(aim, -halfSpread), range),
          reachAlong(level, muzzle, rotated(aim, halfSpread), range),
        )
      }
    },
  })
}
