import { Option } from 'effect'
import { Update } from 'foldkit'

import { maybeRerollFor, rerollMission } from '../../features/missions/missions'
import { stepWhen } from '../../shared/stepWhen'
import { isPanelOpen } from '../menuState'
import type { Model } from '../model'
import { openMissions } from './home'
import { tapSound, unlockAudio } from './sound'
import { combine, defineHandlers, modelStep } from './step'

// NOTE: a slot's dice works only from the open panel, while the day's
// reroll is left and the slot's mission is not done.
const canReroll = (model: Model, slot: number): boolean =>
  isPanelOpen(model, 'Missions') && Option.isSome(maybeRerollFor(model, slot))

// NOTE: the day's missions (src/features/missions/message.ts): the home
// card opens their panel, and a slot's dice spends the day's one reroll.
export const missionHandlers = defineHandlers({
  ClickedMissionsButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, openMissions]),

  ClickedRerollButton: (model, { slot }) =>
    stepWhen(
      (stepModel: Model) => canReroll(stepModel, slot),
      stepModel =>
        combine(stepModel, [
          modelStep(rolled => rerollMission(rolled, slot)),
          tapSound,
        ]),
    )(model),
})
