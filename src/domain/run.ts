import { Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import { isObjectFirst } from '../shared/dualArgs'
import {
  type Difficulty,
  type DifficultyBests,
  Phase,
} from '../world/schema/worldSchema'

// What several features read of where a run stands: home, in a run, or on
// an end screen; the bests a run writes; and the feedback ask.

// PHASES

export const isOnHome = Phase.isAnyOf(['Ready'])

export const isInRun = Phase.isAnyOf(['Preparation', 'Wave', 'Paused'])

export const isEndScreen = Phase.isAnyOf(['Victory', 'GameOver'])

// BESTS

export const withBests: {
  (
    toBests: (bests: DifficultyBests) => DifficultyBests,
    chosen?: Difficulty,
  ): (model: Model) => Model
  (
    model: Model,
    toBests: (bests: DifficultyBests) => DifficultyBests,
    chosen?: Difficulty,
  ): Model
} = Function.dual(
  isObjectFirst,
  (
    model: Model,
    toBests: (bests: DifficultyBests) => DifficultyBests,
    chosen: Difficulty = model.difficulty.chosen,
  ): Model =>
    modifyFields(model, {
      bests: bests =>
        modifyFields(bests, {
          byDifficulty: byDifficulty =>
            modifyFields(byDifficulty, {
              Easy: current => (chosen === 'Easy' ? toBests(current) : current),
              Normal: current =>
                chosen === 'Normal' ? toBests(current) : current,
              Hard: current => (chosen === 'Hard' ? toBests(current) : current),
              Nightmare: current =>
                chosen === 'Nightmare' ? toBests(current) : current,
            }),
        }),
    }),
)

// FEEDBACK

// NOTE: the end screens ask for feedback only on a player's first few runs.
// The run on the end screen is already counted, so a first run shows 1.
export const FEEDBACK_RUNS = 3

export const isAskingForFeedback = (model: Model): boolean =>
  model.bests.runsPlayed <= FEEDBACK_RUNS
