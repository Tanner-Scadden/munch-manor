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

// The daily missions' mutations in the player scope
// (src/platform/playerScope.ts), apart from the scope so its file stays one
// job. Shared with the sync Worker, like the scope, so it imports only
// `effect`, the sync engine, and src/shared/.

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

// NOTE: a run's progress on a day's missions (src/shared/missionData.ts),
// as increments by mission, each capped at its goal, so runs on two linked
// devices the same day add up. A later day starts the record afresh; a
// count for a day older than the record's adds nothing. `coop` marks the
// player as one who has played an online co-op run, for good.
/** @stability unstable */
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

// NOTE: the day's three as first rolled. The first device's stand, so a
// gate the player passes later that day changes no device's three.
/** @stability unstable */
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

// NOTE: the day's one free reroll. The first device's stands.
/** @stability unstable */
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

// NOTE: a mission done on `day` pays its Bones (MISSION_BONES, read here
// and never from the args) once, and only once its count has met its
// goal in this scope, so two devices that both finish it are paid once.
/** @stability unstable */
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

// NOTE: all three of a day's missions done: ALL_THREE_BONES once, and the
// day stamped for the Proof Shelf, once three claims stand in this scope.
/** @stability unstable */
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
