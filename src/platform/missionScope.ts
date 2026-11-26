import { Array, Effect, Option, Schema, pipe } from 'effect'
import { SqlClient } from 'effect/sql'

import { type ApplyContext, defineMutation } from '@munch/sync-engine'

import { DayStamp } from '../shared/dayStamp'
import {
  ALL_THREE_BONES,
  MissionReroll,
  SavedMissions,
  addProgress,
  bonesOfMission,
  claimMission,
  freezeOn,
  rerollOn,
  stampDay,
} from '../shared/missionData'
import { Count, PLAYER_SCOPE_KIND, toRejected } from './playerScopeParts'

const MissionsRow = Schema.Struct({
  missions: Schema.fromJsonString(SavedMissions),
})

const encodeMissions = Schema.encodeEffect(Schema.fromJsonString(SavedMissions))

const readMissions = (context: ApplyContext) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT missions FROM ${context.table('player')} WHERE id = 1`
    return pipe(
      Array.head(rows),
      Option.flatMap(Schema.decodeUnknownOption(MissionsRow)),
      Option.map(row => row.missions),
    )
  })

const writeMissions = (
  context: ApplyContext,
  missions: SavedMissions,
  bones: number,
) =>
  Effect.gen(function* () {
    const json = yield* Effect.mapError(encodeMissions(missions), toRejected)
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE ${context.table('player')} SET
      missions = ${json},
      rank_bones = rank_bones + ${bones}
      WHERE id = 1`
  })

const MAX_MISSION_COUNT = 1000

export const ProgressedMissions = defineMutation({
  name: 'ProgressedMissions',
  version: 1,
  args: Schema.Struct({
    day: DayStamp,
    progress: Schema.Record(
      Schema.String,
      Count.check(Schema.isLessThanOrEqualTo(MAX_MISSION_COUNT)),
    ),
    coop: Schema.Boolean,
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ day, progress, coop }, context) =>
    Effect.gen(function* () {
      const maybeKept = yield* readMissions(context)
      if (Option.isNone(maybeKept)) {
        return
      }
      const added = addProgress(maybeKept.value, day, progress)
      yield* writeMissions(
        context,
        coop ? { ...added, hasPlayedCoop: true } : added,
        0,
      )
    }),
})

export const RolledMissions = defineMutation({
  name: 'RolledMissions',
  version: 1,
  args: Schema.Struct({ day: DayStamp, rolled: Schema.Array(Schema.String) }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ day, rolled }, context) =>
    Effect.gen(function* () {
      const maybeKept = yield* readMissions(context)
      if (Option.isNone(maybeKept)) {
        return
      }
      yield* writeMissions(context, freezeOn(maybeKept.value, day, rolled), 0)
    }),
})

export const RerolledMission = defineMutation({
  name: 'RerolledMission',
  version: 1,
  args: Schema.Struct({ day: DayStamp, reroll: MissionReroll }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ day, reroll }, context) =>
    Effect.gen(function* () {
      const maybeKept = yield* readMissions(context)
      if (Option.isNone(maybeKept)) {
        return
      }
      yield* writeMissions(context, rerollOn(maybeKept.value, day, reroll), 0)
    }),
})

export const ClaimedMission = defineMutation({
  name: 'ClaimedMission',
  version: 1,
  args: Schema.Struct({ day: DayStamp, mission: Schema.String }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ day, mission }, context) =>
    Effect.gen(function* () {
      const maybeKept = yield* readMissions(context)
      const maybeClaimed = Option.flatMap(maybeKept, claimMission(day, mission))
      if (Option.isNone(maybeClaimed)) {
        return
      }
      yield* writeMissions(context, maybeClaimed.value, bonesOfMission(mission))
    }),
})

export const StampedMissionDay = defineMutation({
  name: 'StampedMissionDay',
  version: 1,
  args: Schema.Struct({ day: DayStamp }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ day }, context) =>
    Effect.gen(function* () {
      const maybeKept = yield* readMissions(context)
      const maybeStamped = Option.flatMap(maybeKept, stampDay(day))
      if (Option.isNone(maybeStamped)) {
        return
      }
      yield* writeMissions(context, maybeStamped.value, ALL_THREE_BONES)
    }),
})
