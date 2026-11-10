import { Function } from 'effect'

import { endOffer } from '../../features/end/endOffer'
import { releaseAll } from '../../input/input'
import { isRoundActive } from '../../world/waves/waves'
import { type Model, Phase, type RunMode } from '../model'
import { startOrResume } from '../runFlow'
import { playStartSoundWhen, unlockAudio } from './sound'
import { type UpdateReturn, combine, withInput } from './step'

export const isPaused = Phase.isAnyOf(['Paused'])

const canStart = (model: Model): boolean =>
  Phase.match(model.phase, {
    Ready: () => true,
    Arriving: () => false,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => true,
    Escaped: () => endOffer(model) === 'MenuAndModes',
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

export const startFromButton: {
  (started: Model): (before: Model) => UpdateReturn
  (before: Model, started: Model): UpdateReturn
} = Function.dual(2, (before: Model, started: Model): UpdateReturn =>
  combine(withInput(started, releaseAll), [
    unlockAudio,
    playStartSoundWhen(startsRun(before, started)),
  ]),
)

export const isScreenAnimated = (phase: Phase): boolean =>
  Phase.isAnyOf(['Ready', 'Escaped', 'GameOver'])(phase)
