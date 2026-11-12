import { Array, Function, Option, Order, pipe } from 'effect'

import type { Camera } from '../render/camera'
import type { Level } from '../world/level/arena'
import { hasLineOfSight } from '../world/level/tileQueries'
import type { Vector, Zombie } from '../world/schema/worldSchema'
import { ZombieAction, ZombieState } from '../world/schema/worldSchema'

// AIM ASSIST

// NOTE: a phone sees a zoomed window, and a thumb on a stick aims coarser
// than a mouse, so on touch, upright or on its side, and on a controller's
// right stick, a held trigger bends the aim a few degrees onto the zombie it
// is already almost on. Only a zombie inside the camera's view, in the line
// of sight, and within reach pulls. Inside innerRadians the aim lands on
// it; from there to outerRadians the pull fades to nothing, so the aim
// never jumps. It reads only the input and the world, so the same frame
// always bends the same way.
export type AimAssistStrength = Readonly<{
  innerRadians: number
  outerRadians: number
  reachPx: number
}>

// NOTE: each device's own strength, gentle on both: it helps, it never
// plays for you. A pad sees the whole room, not a phone's zoomed window,
// and a stick held in two hands is steadier than a thumb on glass, so its
// pull is weaker than touch's and reaches less far. Touch came down from
// 0.12, 0.2, and 140 px with the owner on 2026-11-11.
export const AIM_ASSIST = {
  Touch: { innerRadians: 0.08, outerRadians: 0.14, reachPx: 120 },
  Gamepad: { innerRadians: 0.05, outerRadians: 0.11, reachPx: 110 },
} as const satisfies Readonly<Record<string, AimAssistStrength>>

const OUT_OF_REACH = ZombieAction.isAnyOf(['Burrowed', 'Carried', 'Flying'])

type Pull = Readonly<{ zombie: Zombie; offset: number; distance: number }>

// NOTE: the zombie closest to the aim pulls, the nearer one on a tie.
const byPull: Order.Order<Pull> = Order.combine(
  Order.mapInput(Order.Number, ({ offset }: Pull) => Math.abs(offset)),
  Order.mapInput(Order.Number, ({ distance }: Pull) => distance),
)

const angleBetween = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

const isInView = (camera: Camera, zombie: Zombie): boolean =>
  zombie.x >= camera.x &&
  zombie.x <= camera.x + camera.width &&
  zombie.y >= camera.y &&
  zombie.y <= camera.y + camera.height

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
    const aimAngle = Math.atan2(aim.y, aim.x)
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
          Math.atan2(zombie.y - from.y, zombie.x - from.x),
        ),
        distance: Math.hypot(zombie.x - from.x, zombie.y - from.y),
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
          return { x: Math.cos(angle), y: Math.sin(angle) }
        },
      }),
    )
  },
)
