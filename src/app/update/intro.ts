import { Array } from 'effect'

import { UiStruct } from '@effect/ui'

import { isRunOn } from '../../domain/onlineRun'
import { raisePocketCardFrom } from '../../features/dare/pocketCard'
import { introSounds, isSkippable } from '../../features/intro/introBeat'
import { skipArrival } from '../../world/run/arrival'
import { advanceGame } from '../frame'
import type { Model } from '../model'
import { playSounds, uiCue } from './sound'
import { type UpdateStep, toModel } from './step'

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
