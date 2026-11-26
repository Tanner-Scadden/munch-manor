import { Array, Function, Option, Order, pipe } from 'effect'

import { type Camera, isInView } from '#render/camera/camera.ts'
import * as DetMath from '#shared/detMath.ts'
import type { Level } from '#world/level/arena.ts'
import { hasLineOfSight } from '#world/level/tileQueries.ts'
import type { Vector, Zombie } from '#world/schema/worldSchema.ts'
import { ZombieAction, ZombieState } from '#world/schema/worldSchema.ts'

export type AimAssistStrength = Readonly<{
  innerRadians: number
  outerRadians: number
  reachPx: number
}>

export const AIM_ASSIST = {
  Touch: { innerRadians: 0.08, outerRadians: 0.14, reachPx: 120 },
  Gamepad: { innerRadians: 0.05, outerRadians: 0.11, reachPx: 110 },
} as const satisfies Readonly<Record<string, AimAssistStrength>>

const OUT_OF_REACH = ZombieAction.isAnyOf(['Burrowed', 'Carried', 'Flying'])

type Pull = Readonly<{ zombie: Zombie; offset: number; distance: number }>

const byPull: Order.Order<Pull> = Order.combine(
  Order.mapInput(Order.Number, ({ offset }: Pull) => Math.abs(offset)),
  Order.mapInput(Order.Number, ({ distance }: Pull) => distance),
)

const angleBetween = (from: number, to: number): number =>
  DetMath.atan2(DetMath.sin(to - from), DetMath.cos(to - from))

const pullOf = (offset: number, strength: AimAssistStrength): number => {
  const size = Math.abs(offset)
  const { innerRadians, outerRadians } = strength
  return size <= innerRadians
    ? offset
    : offset *
        Math.max(0, (outerRadians - size) / (outerRadians - innerRadians))
}

export const assistAim: {
  (
    camera: Camera,
    from: Vector,
    zombies: ReadonlyArray<Zombie>,
    aim: Vector,
    strength: AimAssistStrength,
  ): (level: Level) => Vector
  (
    level: Level,
    camera: Camera,
    from: Vector,
    zombies: ReadonlyArray<Zombie>,
    aim: Vector,
    strength: AimAssistStrength,
  ): Vector
} = Function.dual(
  6,
  (
    level: Level,
    camera: Camera,
    from: Vector,
    zombies: ReadonlyArray<Zombie>,
    aim: Vector,
    strength: AimAssistStrength,
  ): Vector => {
    const aimAngle = DetMath.atan2(aim.y, aim.x)
    return pipe(
      zombies,
      Array.filter(
        zombie =>
          ZombieState.isAnyOf(['Walking'])(zombie.state) &&
          !OUT_OF_REACH(zombie.action) &&
          isInView(camera, zombie),
      ),
      Array.map((zombie): Pull => ({
        zombie,
        offset: angleBetween(
          aimAngle,
          DetMath.atan2(zombie.y - from.y, zombie.x - from.x),
        ),
        distance: DetMath.hypot(zombie.x - from.x, zombie.y - from.y),
      })),
      Array.filter(
        ({ offset, distance }) =>
          distance <= strength.reachPx &&
          Math.abs(offset) < strength.outerRadians,
      ),
      Array.sort(byPull),
      Array.findFirst(({ zombie }) => hasLineOfSight(level, from, zombie)),
      Option.match({
        onNone: () => aim,
        onSome: ({ offset }) => {
          const angle = aimAngle + pullOf(offset, strength)
          return { x: DetMath.cos(angle), y: DetMath.sin(angle) }
        },
      }),
    )
  },
)
