import { Option } from 'effect'

import { isPanelOpen } from '#app/menuState.ts'
import type { Model } from '#app/model.ts'
import { maybeRerollFor, rerollMission } from '#features/missions/missions.ts'
import { stepWhen } from '#shared/stepWhen.ts'

import { openMissions } from './home.ts'
import { tapSound, unlockAudio } from './sound.ts'
import { combine, defineHandlers, modelStep } from './step.ts'

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
