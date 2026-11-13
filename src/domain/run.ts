import { Array, Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import { isObjectFirst } from '../shared/dualArgs'
import type { Level } from '../world/level/arena'
import { isPending } from '../world/run/lessons'
import {
  type Difficulty,
  type DifficultyBests,
  Phase,
} from '../world/schema/worldSchema'
import { roundWave } from '../world/waves/waves'

// What several features read of where a run stands: home, in a run, or on
// an end screen; the rooms opened; the bests a run writes; and the feedback
// ask.

// PHASES

export const isOnHome = Phase.isAnyOf(['Ready'])

export const isInRun = Phase.isAnyOf(['Preparation', 'Wave', 'Paused'])

export const isEndScreen = Phase.isAnyOf(['Escaped', 'GameOver'])

// NOTE: a run still on the practice gate (wave 1 with the basics not yet
// tried, even paused) pays nothing, Bones or missions: the tutorial is not
// a run to rank.
export const isGuided = (run: Model): boolean =>
  roundWave(run.phase) === 1 &&
  (isPending(run.lessons.move) || isPending(run.lessons.fire))

// ROOMS

// NOTE: the rooms opened out of the rooms on the map, read from the level's
// boarded exits (the start room plus one for each). The library's secret
// shelf is a way between two rooms, not a room. The break's rooms counter
// and the pause screen read it.
export const roomsOf = (level: Level): { found: number; total: number } => {
  const boarded = Array.filter(level.exits, ({ opener }) => opener === 'Boards')
  return {
    found: 1 + Array.length(Array.filter(boarded, ({ isOpen }) => isOpen)),
    total: 1 + boarded.length,
  }
}

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
