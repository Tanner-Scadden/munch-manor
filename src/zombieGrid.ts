import { type Grid, buildGrid } from './grid'
import type { Zombie } from './worldSchema'
import { ZOMBIE_KINDS, isGrounded } from './zombies'

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
