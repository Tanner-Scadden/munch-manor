import { Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import { playedDifficultyOf } from '../platform/analyticsRun'
import { isDareTaken } from './beatMyRun'
import type { SavedDareMarks } from '../shared/dareMarkData'
import type { Difficulty } from '../shared/playerData'
import { MAX_MARK, clampMark } from '../world/run/dareLadder'
import { hasJustWon } from '../world/run/difficulty'
import { playedMarkOf } from './onlineRun'

// The dare ladder as the player climbs it (docs/PROGRESSION_PLAN.md, pillar
// E): the best mark opened on each difficulty, saved and synced
// (src/shared/dareMarkData.ts), and the pick for the next run held to it.
// The rules a mark turns on are the World's (src/world/run/dareLadder.ts).

// NOTE: the highest mark this player may pick on a difficulty.
export const bestMarkOn: {
  (difficulty: Difficulty): (marks: SavedDareMarks) => number
  (marks: SavedDareMarks, difficulty: Difficulty): number
} = Function.dual(2, (marks: SavedDareMarks, difficulty: Difficulty): number =>
  clampMark(marks[difficulty]),
)

// NOTE: the mark after this one, round again past the best opened, for a
// press that steps the lobby's pick.
export const nextMarkOf: {
  (best: number): (mark: number) => number
  (mark: number, best: number): number
} = Function.dual(2, (mark: number, best: number): number =>
  mark >= best ? 0 : mark + 1,
)

// NOTE: the pick held to what the picked difficulty has opened, as the
// difficulty changes or a save comes in. A friend's dare holds its own mark
// (src/domain/beatMyRun.ts).
export const fitDareMark = (model: Model): Model => {
  if (isDareTaken(model)) {
    return model
  }
  const best = bestMarkOn(model.dareMarks, model.difficulty.chosen)
  return model.dareMark > best
    ? modifyFields(model, { dareMark: () => best })
    : model
}

// NOTE: an escape opens the next mark on the difficulty it was played on:
// an escape with no mark opens mark 1, and one at mark N opens N + 1, up to
// the ladder's top. A co-op crew's escape counts for each player at the
// room's mark, each on their own ladder.
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
    ? modifyFields(after, {
        dareMarks: marks => ({ ...marks, [difficulty]: opened }),
      })
    : after
})
