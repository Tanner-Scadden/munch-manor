import { Array, Function } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { isObjectFirst } from '#shared/dualArgs.ts'
import type { Level } from '#world/level/arena.ts'
import { isPending } from '#world/run/lessons.ts'
import {
  type Difficulty,
  type DifficultyBests,
  Phase,
} from '#world/schema/worldSchema.ts'
import { roundWave } from '#world/waves/waves.ts'

export const isOnHome = Phase.isAnyOf(['Ready'])

export const isInRun = Phase.isAnyOf(['Preparation', 'Wave', 'Paused'])

export const isEndScreen = Phase.isAnyOf(['Escaped', 'LeftEarly', 'GameOver'])

export const isGuided = (run: Model): boolean =>
  roundWave(run.phase) === 1 &&
  (isPending(run.lessons.move) || isPending(run.lessons.fire))

export const roomsOf = (level: Level): { found: number; total: number } => {
  const boarded = Array.filter(level.exits, ({ opener }) => opener === 'Boards')
  return {
    found: 1 + Array.length(Array.filter(boarded, ({ isOpen }) => isOpen)),
    total: 1 + boarded.length,
  }
}

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
    UiStruct.evolve(model, {
      bests: bests =>
        UiStruct.evolve(bests, {
          byDifficulty: byDifficulty =>
            UiStruct.evolve(byDifficulty, {
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

export const FEEDBACK_RUNS = 3

export const isAskingForFeedback = (model: Model): boolean =>
  model.bests.runsPlayed <= FEEDBACK_RUNS
