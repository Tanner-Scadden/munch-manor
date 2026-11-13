import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

// NOTE: the home menu's mission card, which opens the missions panel, and
// the panel's reroll dice on one slot. Their handlers are in
// src/app/update/missions.ts.
export const missionCases = {
  ClickedMissionsButton: {},
  ClickedRerollButton: { slot: Schema.Finite },
}
export const MissionMessage = defineMessageUnion(missionCases)
export type MissionMessage = typeof MissionMessage.Type
