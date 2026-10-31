import { modifyFields } from 'foldkit/struct'

import { PREPARATION_MS } from '../constants'
import { endOffer } from '../home'
import { releaseAll } from '../input'
import { type Model, Phase, Purchase, RunMode, ShopState } from '../model'
import { startOrResume } from '../runFlow'
import { FINAL_WAVE } from '../wavePlans'
import { beginPreparation, isRoundActive } from '../waves'
import { withWorld } from '../world'
import { playStartSoundWhen, unlockAudio } from './sound'
import { type UpdateReturn, combine, withInput } from './step'

export const isPaused = Phase.isAnyOf(['Paused'])

const canStart = (model: Model): boolean =>
  Phase.match(model.phase, {
    Ready: () => true,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => true,
    Victory: () => endOffer(model) === 'MenuAndModes',
    GameOver: () => endOffer(model) === 'MenuAndModes',
  })

export const startWhenAllowed = (model: Model, mode: RunMode): Model =>
  canStart(model) ? startOrResume(model, mode) : model

export const keepGoing = (model: Model): Model =>
  Phase.isAnyOf(['Victory'])(model.phase)
    ? withWorld(
        modifyFields(model, {
          mode: () => RunMode.Endless(),
          shop: () => ShopState.Away(),
          purchase: () => Purchase.Idle(),
          screenMs: () => 0,
        }),
        world => beginPreparation(world, FINAL_WAVE + 1, PREPARATION_MS),
      )
    : model

export const keepGoingWhenAllowed = (model: Model): Model =>
  canStart(model) ? keepGoing(model) : model

export const startsRun = (before: Model, after: Model): boolean =>
  !isRoundActive(before.phase) &&
  !Phase.isAnyOf(['Paused'])(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase)

export const startFromButton = (before: Model, started: Model): UpdateReturn =>
  combine(withInput(started, releaseAll), [
    unlockAudio,
    playStartSoundWhen(startsRun(before, started)),
  ])

export const isScreenAnimated = (phase: Phase): boolean =>
  Phase.isAnyOf(['Ready', 'Victory', 'GameOver'])(phase)
