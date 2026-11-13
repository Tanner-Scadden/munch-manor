import { Schema } from 'effect'

import { MissionId } from '../../shared/missionData'

// The daily missions' client Schemas: what a run tallies toward them as it
// plays, and what the end card shows of the missions it moved. The saved
// record is src/shared/missionData.ts's SavedMissions.

// NOTE: what a run tallies from its own frame events, which the World does
// not keep (the rest a run's missions read off the World when it pays):
// the most zombies one chandelier drop crushed, the top tier a gun of the
// player's own reached, and the fridge's pulls. `credited` is each
// mission's count already paid this run, so a win that keeps going into
// endless pays only what it adds when it ends again.
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

// NOTE: one of the day's missions a run moved: its count before and after
// toward its goal, and whether the run finished it (its Bones paid).
export const MovedMission = Schema.Struct({
  mission: MissionId,
  from: Schema.Finite,
  to: Schema.Finite,
  goal: Schema.Finite,
  isDone: Schema.Boolean,
})
export type MovedMission = typeof MovedMission.Type

// NOTE: what the end card's mission bars show: each mission the run moved,
// the Bones the missions paid, and whether it finished the day's three.
export const MissionGain = Schema.Struct({
  moved: Schema.Array(MovedMission),
  bones: Schema.Finite,
  isAllThree: Schema.Boolean,
})
export type MissionGain = typeof MissionGain.Type
