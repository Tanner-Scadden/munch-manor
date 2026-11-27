import { Schema } from 'effect'

import { MissionId } from '#shared/records/missionData.ts'

export const MissionRun = Schema.Struct({
  crushBest: Schema.Finite,
  topTier: Schema.Finite,
  fridgePulls: Schema.Finite,
  credited: Schema.Record(Schema.String, Schema.Finite),
})
export type MissionRun = typeof MissionRun.Type

export const noMissionRun: MissionRun = {
  crushBest: 0,
  topTier: 0,
  fridgePulls: 0,
  credited: {},
}

export const MovedMission = Schema.Struct({
  mission: MissionId,
  from: Schema.Finite,
  to: Schema.Finite,
  goal: Schema.Finite,
  isDone: Schema.Boolean,
})
export type MovedMission = typeof MovedMission.Type

export const MissionGain = Schema.Struct({
  moved: Schema.Array(MovedMission),
  bones: Schema.Finite,
  isAllThree: Schema.Boolean,
})
export type MissionGain = typeof MissionGain.Type
