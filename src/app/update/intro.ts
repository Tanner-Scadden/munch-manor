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

// The intro in update (its beats are src/features/intro/introBeat.ts, its
// clock src/world/run/arrival.ts): a press skips to the slam, and each frame
// runs the arrival clock and plays the beats' sounds.

// NOTE: any key or tap skips to the slam, never past it. Alone, the World's
// clock jumps there. In an online run the room's clock decides the slam for
// the whole crew, so only this player's drawing skips, to the door, and
// waits there.
export const skipIntro = (model: Model): Model => {
  if (!isSkippable(model)) {
    return model
  }
  const skipped = UiStruct.evolve(model, {
    introSkip: () => 'Skipped' as const,
  })
  return isRunOn(model) ? skipped : skipArrival(skipped)
}

// NOTE: the sounds of the beats the arrival clock passed, from `before`.
export const playIntroSounds =
  (before: Model): UpdateStep =>
  $ =>
    playSounds(Array.map(introSounds(before, $.model), uiCue))($)

// NOTE: one frame of single player's intro: the World's ticks run only the
// arrival clock (src/world/step/simulation.ts), and the slam begins the
// first break with the dare card out of your pocket.
export const advanceIntro =
  (deltaTime: number): UpdateStep =>
  $ =>
    $.combine(
      toModel(raisePocketCardFrom($.model, advanceGame($.model, deltaTime))),
      playIntroSounds($.model),
    )
