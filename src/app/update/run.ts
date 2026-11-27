import { Function } from 'effect'

import { startOrResume } from '#app/frame/runFlow.ts'
import { type Model, Phase, type RunMode } from '#app/model.ts'
import { endOffer } from '#features/end/endOffer.ts'
import { releaseAll } from '#input/input.ts'
import { isRoundActive } from '#world/waves/waves.ts'

import { playStartSoundWhen, unlockAudio } from './sound.ts'
import { type UpdateStep, toModel, withInput } from './step.ts'

export const isPaused = Phase.isAnyOf(['Paused'])

const canStart = (model: Model): boolean =>
  Phase.match(model.phase, {
    Ready: () => true,
    Arriving: () => false,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => true,
    Escaped: () => endOffer(model) === 'MenuAndModes',
    LeftEarly: () => endOffer(model) === 'MenuAndModes',
    GameOver: () => endOffer(model) === 'MenuAndModes',
  })

export const startWhenAllowed: {
  (mode: RunMode): (model: Model) => Model
  (model: Model, mode: RunMode): Model
} = Function.dual(2, (model: Model, mode: RunMode): Model =>
  canStart(model) ? startOrResume(model, mode) : model,
)

export const startsRun: {
  (after: Model): (before: Model) => boolean
  (before: Model, after: Model): boolean
} = Function.dual(
  2,
  (before: Model, after: Model): boolean =>
    !isRoundActive(before.phase) &&
    !Phase.isAnyOf(['Paused', 'Arriving'])(before.phase) &&
    Phase.isAnyOf(['Arriving', 'Preparation'])(after.phase),
)

export const startFromButton =
  (started: Model): UpdateStep =>
  $ =>
    $.combine(
      toModel(withInput(started, releaseAll)),
      unlockAudio,
      playStartSoundWhen(startsRun($.model, started)),
    )

export const isScreenAnimated = (phase: Phase): boolean =>
  Phase.isAnyOf(['Ready', 'Escaped', 'LeftEarly', 'GameOver'])(phase)
