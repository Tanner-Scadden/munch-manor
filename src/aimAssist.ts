import { Array, Option, Order, pipe } from 'effect'

import { type Level, hasLineOfSight } from './arena'
import type { Camera } from './camera'
import type { Vector, Zombie } from './worldSchema'
import { ZombieAction, ZombieState } from './worldSchema'

// AIM ASSIST

// NOTE: a phone sees a zoomed window, and a thumb on a stick aims coarser
// than a mouse, so on touch, upright or on its side, a held trigger bends
// the aim a few degrees onto the zombie it is already almost on. Only
// a zombie inside the camera's view, in the line of sight, and within reach
// pulls. Inside innerRadians the aim lands on it; from there to
// outerRadians the pull fades to nothing, so the aim never jumps. It reads
// only the input and the world, so the same frame always bends the same way.
export const AIM_ASSIST = {
  innerRadians: 0.12,
  outerRadians: 0.2,
  reachPx: 140,
} as const

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

const pullOf = (offset: number): number => {
  const size = Math.abs(offset)
  const { innerRadians, outerRadians } = AIM_ASSIST
  return size <= innerRadians
    ? offset
    : offset *
        Math.max(0, (outerRadians - size) / (outerRadians - innerRadians))
}

export const assistAim = (
  level: Level,
  camera: Camera,
  from: Vector,
  zombies: ReadonlyArray<Zombie>,
  aim: Vector,
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
        distance <= AIM_ASSIST.reachPx &&
        Math.abs(offset) < AIM_ASSIST.outerRadians,
    ),
    Array.sort(byPull),
    Array.findFirst(({ zombie }) => hasLineOfSight(level, from, zombie)),
    Option.match({
      onNone: () => aim,
      onSome: ({ offset }) => {
        const angle = aimAngle + pullOf(offset)
        return { x: Math.cos(angle), y: Math.sin(angle) }
      },
    }),
  )
}
