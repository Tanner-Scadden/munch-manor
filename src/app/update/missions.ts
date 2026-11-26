import { Option } from 'effect'

import { maybeRerollFor, rerollMission } from '../../features/missions/missions'
import { stepWhen } from '../../shared/stepWhen'
import { isPanelOpen } from '../menuState'
import type { Model } from '../model'
import { openMissions } from './home'
import { tapSound, unlockAudio } from './sound'
import { combine, defineHandlers, modelStep } from './step'

const canReroll = (model: Model, slot: number): boolean =>
  isPanelOpen(model, 'Missions') && Option.isSome(maybeRerollFor(model, slot))

export const missionHandlers = defineHandlers({
  ClickedMissionsButton: combine([unlockAudio, tapSound, openMissions]),

  ClickedRerollButton: ($, { slot }) =>
    stepWhen(
      (model: Model) => canReroll(model, slot),
      combine([modelStep(model => rerollMission(model, slot)), tapSound]),
    )($),
})
