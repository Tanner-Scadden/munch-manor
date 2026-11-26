import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

export const missionCases = {
  ClickedMissionsButton: {},
  ClickedRerollButton: { slot: Schema.Finite },
}
export const MissionMessage = UiSchema.TaggedEnum(missionCases)
export type MissionMessage = typeof MissionMessage.Type
