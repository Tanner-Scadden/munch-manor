import { Array } from 'effect'

import { UiStruct } from '@effect/ui'

import { advanceGame } from '#app/frame/frame.ts'
import type { Model } from '#app/model.ts'
import { isRunOn } from '#domain/onlineRun.ts'
import { raisePocketCardFrom } from '#features/dare/pocketCard.ts'
import { introSounds, isSkippable } from '#features/intro/introBeat.ts'
import { skipArrival } from '#world/run/arrival.ts'

import { playSounds, uiCue } from './sound.ts'
import { type UpdateStep, toModel } from './step.ts'

export const skipIntro = (model: Model): Model => {
  if (!isSkippable(model)) {
    return model
  }
  const skipped = UiStruct.evolve(model, {
    introSkip: () => 'Skipped' as const,
  })
  return isRunOn(model) ? skipped : skipArrival(skipped)
}

export const playIntroSounds =
  (before: Model): UpdateStep =>
  $ =>
    playSounds(Array.map(introSounds(before, $.model), uiCue))($)

export const advanceIntro =
  (deltaTime: number): UpdateStep =>
  $ =>
    $.combine(
      toModel(raisePocketCardFrom($.model, advanceGame($.model, deltaTime))),
      playIntroSounds($.model),
    )
