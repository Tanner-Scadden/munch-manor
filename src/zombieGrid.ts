import { type Grid, buildGrid } from './grid'
import type { Zombie } from './worldSchema'
import { ZOMBIE_KINDS, bodyRadiusOf, isGrounded, statsOf } from './zombies'

// NOTE: the widest any two zombie bodies, or a zombie and a bullet, reach
// from each other is the largest body radius of any kind (the boss's) twice.
// A cell that side means a query of that reach touches at most a 3 by 3 block.
export const MAX_BODY_RADIUS_PX = Math.max(
  ...Object.values(ZOMBIE_KINDS).map(({ bodyRadius }) => bodyRadius),
)

// NOTE: the grid of the zombies that bullets, bursts, and the crowd can reach,
// built fresh for one step.
export const groundedGrid = (zombies: ReadonlyArray<Zombie>): Grid =>
  buildGrid(zombies, isGrounded, 2 * MAX_BODY_RADIUS_PX)

// NOTE: what the crowd's inner loops read of each zombie, by its index in the
// list, laid out in typed arrays for one step: where it stands, how big its
// body is, how heavy, and which it is. The zombies stay the objects they are;
// these are read off them once, so a loop over neighbors touches no object and
// allocates nothing. Like the grid, they are made for one step and dropped.
export type ZombieColumns = Readonly<{
  grid: Grid
  xs: Float64Array
  ys: Float64Array
  radii: Float64Array
  masses: Float64Array
  ids: Int32Array
}>

export const groundedColumns = (
  zombies: ReadonlyArray<Zombie>,
): ZombieColumns => {
  const size = zombies.length
  const xs = new Float64Array(size)
  const ys = new Float64Array(size)
  const radii = new Float64Array(size)
  const masses = new Float64Array(size)
  const ids = new Int32Array(size)
  for (let index = 0; index < size; index++) {
    const zombie = zombies[index]
    if (zombie !== undefined) {
      xs[index] = zombie.x
      ys[index] = zombie.y
      radii[index] = bodyRadiusOf(zombie)
      masses[index] = statsOf(zombie).mass
      ids[index] = zombie.id
    }
  }
  return { grid: groundedGrid(zombies), xs, ys, radii, masses, ids }
}
