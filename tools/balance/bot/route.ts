import { Array, Function, Option } from 'effect'

import { isStandableTile } from '../../../src/features/bots/dareSearch'
import { PLAYER_RADIUS } from '../../../src/shared/constants'
import {
  type Level,
  hasClearPath,
  tileCenter,
  tileIndex,
  tileIndexAt,
  tileOfIndex,
} from '../../../src/world/level/arena'
import { type Vector } from './basics'

// THE WAY THERE

// The bot walks straight lines where it can. Where furniture or a wall is in
// the way (the dining room's party table, the kitchen's doorway), it walks
// to the next tile on the shortest way over the floor a player can stand on,
// never the yard, found by a search out from the goal. Each search is kept
// for its level and goal tile, so a bot walking to one spot searches once.

export const isInKitchen = (point: Vector) => point.y < -2

const UNREACHED = -1
const KEPT_SEARCHES = 64

const searches = new Map<string, Int32Array>()

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

// NOTE: a diagonal step only where both tiles beside it are floor too, so
// the bot never cuts a corner it would catch on.
const canStep = (
  level: Level,
  column: number,
  row: number,
  stepColumn: number,
  stepRow: number,
): boolean =>
  isStandableTile(level, column + stepColumn, row + stepRow) &&
  (stepColumn === 0 ||
    stepRow === 0 ||
    (isStandableTile(level, column + stepColumn, row) &&
      isStandableTile(level, column, row + stepRow)))

const searchFrom = (level: Level, goalIndex: number): Int32Array => {
  const key = `${level.key}:${goalIndex}`
  const kept = searches.get(key)
  if (kept !== undefined) {
    return kept
  }
  const steps = new Int32Array(level.tileCount).fill(UNREACHED)
  steps[goalIndex] = 0
  const queue = [goalIndex]
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head] ?? goalIndex
    const { column, row } = tileOfIndex(level, index)
    for (const [stepColumn, stepRow] of STEPS) {
      if (canStep(level, column, row, stepColumn, stepRow)) {
        const next = tileIndex(level, column + stepColumn, row + stepRow)
        if (steps[next] === UNREACHED) {
          steps[next] = (steps[index] ?? 0) + 1
          queue.push(next)
        }
      }
    }
  }
  if (searches.size >= KEPT_SEARCHES) {
    searches.clear()
  }
  searches.set(key, steps)
  return steps
}

// The next point to walk to on the way to goal.
export const routeTo: {
  (from: Vector, goal: Vector): (level: Level) => Vector
  (level: Level, from: Vector, goal: Vector): Vector
} = Function.dual(3, (level: Level, from: Vector, goal: Vector): Vector => {
  if (hasClearPath(level, from, goal, PLAYER_RADIUS)) {
    return goal
  }
  const steps = searchFrom(level, tileIndexAt(level, goal))
  const here = tileOfIndex(level, tileIndexAt(level, from))
  const stepsAt = (index: number): number => steps[index] ?? UNREACHED
  return Option.match(
    Array.reduce(
      STEPS,
      Option.none<Readonly<{ index: number; count: number }>>(),
      (best, [stepColumn, stepRow]) => {
        if (!canStep(level, here.column, here.row, stepColumn, stepRow)) {
          return best
        }
        const index = tileIndex(
          level,
          here.column + stepColumn,
          here.row + stepRow,
        )
        const count = stepsAt(index)
        return count === UNREACHED ||
          Option.exists(best, current => current.count <= count)
          ? best
          : Option.some({ index, count })
      },
    ),
    {
      onNone: () => goal,
      onSome: ({ index }) => tileCenter(tileOfIndex(level, index)),
    },
  )
})
