import { Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { endOffer } from '../../features/home/home'
import { releaseAll } from '../../input/input'
import { PREPARATION_MS } from '../../shared/constants'
import { modifyFocus } from '../../world/party/party'
import { withWorld } from '../../world/schema/world'
import { FINAL_WAVE } from '../../world/waves/wavePlans'
import { beginPreparation, isRoundActive } from '../../world/waves/waves'
import { type Model, Phase, Purchase, RunMode, ShopState } from '../model'
import { startOrResume } from '../runFlow'
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

export const startWhenAllowed: {
  (mode: RunMode): (model: Model) => Model
  (model: Model, mode: RunMode): Model
} = Function.dual(2, (model: Model, mode: RunMode): Model =>
  canStart(model) ? startOrResume(model, mode) : model,
)

export const keepGoing = (model: Model): Model =>
  Phase.isAnyOf(['Victory'])(model.phase)
    ? withWorld(
        modifyFocus(
          modifyFields(model, {
            mode: () => RunMode.Endless(),
            screenMs: () => 0,
          }),
          { shop: () => ShopState.Away(), purchase: () => Purchase.Idle() },
        ),
        world => beginPreparation(world, FINAL_WAVE + 1, PREPARATION_MS),
      )
    : model

export const keepGoingWhenAllowed = (model: Model): Model =>
  canStart(model) ? keepGoing(model) : model

export const startsRun: {
  (after: Model): (before: Model) => boolean
  (before: Model, after: Model): boolean
} = Function.dual(
  2,
  (before: Model, after: Model): boolean =>
    !isRoundActive(before.phase) &&
    !Phase.isAnyOf(['Paused'])(before.phase) &&
    Phase.isAnyOf(['Preparation'])(after.phase),
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
  Phase.isAnyOf(['Ready', 'Victory', 'GameOver'])(phase)
