import { Function } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { playedDifficultyOf } from '#platform/analyticsRun.ts'
import type { SavedDareMarks } from '#shared/dareMarkData.ts'
import type { Difficulty } from '#shared/playerData.ts'
import { MAX_MARK, clampMark } from '#world/run/dareLadder.ts'
import { hasJustWon } from '#world/run/difficulty.ts'

import { isDareTaken } from './beatMyRun.ts'
import { playedMarkOf } from './onlineRun.ts'

export const bestMarkOn: {
  (difficulty: Difficulty): (marks: SavedDareMarks) => number
  (marks: SavedDareMarks, difficulty: Difficulty): number
} = Function.dual(2, (marks: SavedDareMarks, difficulty: Difficulty): number =>
  clampMark(marks[difficulty]),
)

export const nextMarkOf: {
  (best: number): (mark: number) => number
  (mark: number, best: number): number
} = Function.dual(2, (mark: number, best: number): number =>
  mark >= best ? 0 : mark + 1,
)

export const fitDareMark = (model: Model): Model => {
  if (isDareTaken(model)) {
    return model
  }
  const best = bestMarkOn(model.dareMarks, model.difficulty.chosen)
  return model.dareMark > best
    ? UiStruct.evolve(model, { dareMark: () => best })
    : model
}

export const climbLadder: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  if (!hasJustWon(before, after)) {
    return after
  }
  const difficulty = playedDifficultyOf(after)
  const opened = Math.min(MAX_MARK, playedMarkOf(after) + 1)
  return opened > after.dareMarks[difficulty]
    ? UiStruct.evolve(after, {
        dareMarks: marks => ({ ...marks, [difficulty]: opened }),
      })
    : after
})
