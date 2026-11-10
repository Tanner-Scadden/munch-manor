import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { START_SPOT } from '../../../src/test/testing'
import { type Level, levelFor, roomAt } from '../../../src/world/level/arena'
import { MANOR_SPEC } from '../../../src/world/level/plan'
import type { Vector } from './basics'
import { routeTo } from './route'

// NOTE: the bot's way over the floor (route.ts) through the whole house:
// the next point of each step is where it stands for the next, until it
// reaches the goal or runs out of steps.
const MAX_STEPS = 400

const walk = (
  level: Level,
  from: Vector,
  goal: Vector,
): ReadonlyArray<Vector> => {
  const path: Array<Vector> = [from]
  let here = from
  for (let step = 0; step < MAX_STEPS; step++) {
    if (here.x === goal.x && here.y === goal.y) {
      return path
    }
    here = routeTo(level, here, goal)
    path.push(here)
  }
  return path
}

const lastOf = (path: ReadonlyArray<Vector>): Vector =>
  path[path.length - 1] ?? START_SPOT

const roomsOn = (level: Level, path: ReadonlyArray<Vector>) =>
  Array.dedupe(Array.map(path, point => roomAt(level, point).id))

const CELLAR = { x: 900, y: 125 }
const PARLOUR = { x: -200, y: 160 }

describe('the bot finds its way', () => {
  test('from the table through the library into the cellar', () => {
    const level = levelFor(MANOR_SPEC, ['East', 'Far'])
    const path = walk(level, START_SPOT, CELLAR)
    expect(lastOf(path)).toEqual(CELLAR)
    expect(roomsOn(level, path)).toEqual(['Dining', 'Library', 'Cellar'])
  })

  test('into the parlour', () => {
    const level = levelFor(MANOR_SPEC, ['West'])
    expect(lastOf(walk(level, START_SPOT, PARLOUR))).toEqual(PARLOUR)
  })

  test('through the swung shelf, a shorter way into the library', () => {
    const from = { x: 330, y: 140 }
    const goal = { x: 385, y: 135 }
    const shut = walk(levelFor(MANOR_SPEC, ['East']), from, goal)
    const swung = walk(levelFor(MANOR_SPEC, ['East', 'Secret']), from, goal)
    expect(lastOf(shut)).toEqual(goal)
    expect(lastOf(swung)).toEqual(goal)
    expect(swung.length).toBeLessThan(shut.length)
  })
})
