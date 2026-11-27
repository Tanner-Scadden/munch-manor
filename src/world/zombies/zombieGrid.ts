import { Array, Record } from 'effect'

import type { Zombie } from '#world/schema/worldSchema.ts'
import { type Grid, buildGrid } from '#world/step/grid.ts'

import { ZOMBIE_KINDS, bodyRadiusOf, isGrounded, statsOf } from './zombies.ts'

export const MAX_BODY_RADIUS_PX = Math.max(
  ...Array.map(Record.values(ZOMBIE_KINDS), ({ bodyRadius }) => bodyRadius),
)

export const groundedGrid = (zombies: ReadonlyArray<Zombie>): Grid =>
  buildGrid(zombies, isGrounded, 2 * MAX_BODY_RADIUS_PX)

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
  return {
    grid: buildGrid(zombies, isGrounded, MAX_BODY_RADIUS_PX),
    xs,
    ys,
    radii,
    masses,
    ids,
  }
}
