import { Array, Option, Record, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import {
  Appearance,
  Calling,
  Difficulty,
  HomeScreenTip,
  PlayerName,
  PlayerSave,
  RotationSetting,
  SavedBestsByDifficulty,
  SavedCard,
  SavedHome,
  SavedOnboarding,
  SavedPowerUps,
  SavedRunRecords,
  SavedSettings,
} from './playerData'

// NOTE: what changed in the player's save, as the player scope's mutations
// (src/playerScope.ts) will record it. `update` computes these from the
// save before and after a Message, so it stays pure; the store runs them
// through the sync engine. A finished run is an increment, not the new
// totals, so runs recorded on two devices both count. The power-ups seen
// are added, never written whole, so a kind seen on any device stays seen;
// only the tutorial reset forgets them.

export const PlayerChange = defineTaggedUnion({
  ChangedSettings: { settings: SavedSettings },
  ChangedRotation: { rotation: RotationSetting },
  ChangedName: { name: PlayerName },
  ChangedAppearance: { appearance: Appearance },
  UnlockedNightmare: {},
  ChangedDifficulty: { chosen: Difficulty, card: SavedCard },
  ChangedOnboarding: {
    onboarding: SavedOnboarding,
    homeScreenTip: HomeScreenTip,
  },
  ChangedHome: { home: SavedHome },
  SawPowerUps: { kinds: SavedPowerUps },
  ForgotPowerUps: {},
  RecordedRun: {
    runs: Schema.Number,
    totalKills: Schema.Number,
    kills: Schema.Record(Schema.String, Schema.Number),
    bests: SavedBestsByDifficulty,
  },
  ReachedRecords: { records: SavedRunRecords },
  ChangedCalling: { calling: Calling },
  EarnedRank: { points: Schema.Number, bones: Schema.Number },
  GrantedVeteranRank: { points: Schema.Number, bones: Schema.Number },
})
export type PlayerChange = typeof PlayerChange.Type

const sameSettings = Schema.toEquivalence(SavedSettings)
const sameAppearance = Schema.toEquivalence(Appearance)
const sameOnboarding = Schema.toEquivalence(SavedOnboarding)
const sameBests = Schema.toEquivalence(SavedBestsByDifficulty)
const sameHome = Schema.toEquivalence(SavedHome)
const sameRecords = Schema.toEquivalence(SavedRunRecords)

const killsAdded = (
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Record<string, number> =>
  Record.filter(
    Record.map(
      after,
      (count, kind) =>
        count - Option.getOrElse(Record.get(before, kind), () => 0),
    ),
    added => added > 0,
  )

const powerUpChanges = (
  before: SavedPowerUps,
  after: SavedPowerUps,
): ReadonlyArray<PlayerChange> => {
  const isForgotten = Array.some(before, kind => !Array.contains(after, kind))
  const seen = isForgotten
    ? after
    : Array.filter(after, kind => !Array.contains(before, kind))
  return [
    ...(isForgotten ? [PlayerChange.ForgotPowerUps()] : []),
    ...(Array.isReadonlyArrayNonEmpty(seen)
      ? [PlayerChange.SawPowerUps({ kinds: seen })]
      : []),
  ]
}

const changeWhen = (
  isChanged: boolean,
  change: () => PlayerChange,
): ReadonlyArray<PlayerChange> => (isChanged ? [change()] : [])

export const changesBetween = (
  before: PlayerSave,
  after: PlayerSave,
): ReadonlyArray<PlayerChange> => {
  const runs = after.bests.runsPlayed - before.bests.runsPlayed
  const totalKills = after.bests.totalKills - before.bests.totalKills
  const kills = killsAdded(before.bests.killsByKind, after.bests.killsByKind)
  const isRunRecorded =
    runs > 0 ||
    totalKills > 0 ||
    !Record.isEmptyRecord(kills) ||
    !sameBests(before.bests.byDifficulty, after.bests.byDifficulty)
  return pipe(
    [
      changeWhen(!sameSettings(before.settings, after.settings), () =>
        PlayerChange.ChangedSettings({ settings: after.settings }),
      ),
      changeWhen(before.rotation !== after.rotation, () =>
        PlayerChange.ChangedRotation({ rotation: after.rotation }),
      ),
      changeWhen(before.name !== after.name, () =>
        PlayerChange.ChangedName({ name: after.name }),
      ),
      changeWhen(!sameAppearance(before.appearance, after.appearance), () =>
        PlayerChange.ChangedAppearance({ appearance: after.appearance }),
      ),
      changeWhen(
        before.difficulty.nightmare === 'Locked' &&
          after.difficulty.nightmare === 'Unlocked',
        () => PlayerChange.UnlockedNightmare(),
      ),
      changeWhen(
        before.difficulty.chosen !== after.difficulty.chosen ||
          before.difficulty.card !== after.difficulty.card,
        () =>
          PlayerChange.ChangedDifficulty({
            chosen: after.difficulty.chosen,
            card: after.difficulty.card,
          }),
      ),
      changeWhen(
        !sameOnboarding(before.onboarding, after.onboarding) ||
          before.homeScreenTip !== after.homeScreenTip,
        () =>
          PlayerChange.ChangedOnboarding({
            onboarding: after.onboarding,
            homeScreenTip: after.homeScreenTip,
          }),
      ),
      changeWhen(!sameHome(before.home, after.home), () =>
        PlayerChange.ChangedHome({ home: after.home }),
      ),
      powerUpChanges(before.seenPowerUps, after.seenPowerUps),
      changeWhen(isRunRecorded, () =>
        PlayerChange.RecordedRun({
          runs: Math.max(runs, 0),
          totalKills: Math.max(totalKills, 0),
          kills,
          bests: after.bests.byDifficulty,
        }),
      ),
      changeWhen(!sameRecords(before.records, after.records), () =>
        PlayerChange.ReachedRecords({ records: after.records }),
      ),
      changeWhen(before.calling !== after.calling, () =>
        PlayerChange.ChangedCalling({ calling: after.calling }),
      ),
      changeWhen(
        after.rank.earnedPoints > before.rank.earnedPoints ||
          after.rank.earnedBones > before.rank.earnedBones,
        () =>
          PlayerChange.EarnedRank({
            points: Math.max(
              0,
              after.rank.earnedPoints - before.rank.earnedPoints,
            ),
            bones: Math.max(
              0,
              after.rank.earnedBones - before.rank.earnedBones,
            ),
          }),
      ),
      changeWhen(
        after.rank.isVeteranGranted &&
          (!before.rank.isVeteranGranted ||
            after.rank.veteranPoints !== before.rank.veteranPoints ||
            after.rank.veteranBones !== before.rank.veteranBones),
        () =>
          PlayerChange.GrantedVeteranRank({
            points: after.rank.veteranPoints,
            bones: after.rank.veteranBones,
          }),
      ),
    ],
    Array.flatten,
  )
}

// NOTE: a write the store could not make is sent again with the next one.
// A change that sets a field is resent with what the field holds now, so a
// retry never puts back an older value. A finished run is an increment, so
// it is resent as it was, once. One change per field is enough.
const refreshed = (change: PlayerChange, save: PlayerSave): PlayerChange =>
  PlayerChange.match(change, {
    ChangedSettings: () =>
      PlayerChange.ChangedSettings({ settings: save.settings }),
    ChangedRotation: () =>
      PlayerChange.ChangedRotation({ rotation: save.rotation }),
    ChangedName: () => PlayerChange.ChangedName({ name: save.name }),
    ChangedAppearance: () =>
      PlayerChange.ChangedAppearance({ appearance: save.appearance }),
    UnlockedNightmare: () => change,
    ChangedDifficulty: () =>
      PlayerChange.ChangedDifficulty({
        chosen: save.difficulty.chosen,
        card: save.difficulty.card,
      }),
    ChangedOnboarding: () =>
      PlayerChange.ChangedOnboarding({
        onboarding: save.onboarding,
        homeScreenTip: save.homeScreenTip,
      }),
    ChangedHome: () => PlayerChange.ChangedHome({ home: save.home }),
    SawPowerUps: () => PlayerChange.SawPowerUps({ kinds: save.seenPowerUps }),
    ForgotPowerUps: () => change,
    RecordedRun: run =>
      PlayerChange.RecordedRun({ ...run, bests: save.bests.byDifficulty }),
    ReachedRecords: () =>
      PlayerChange.ReachedRecords({ records: save.records }),
    ChangedCalling: () =>
      PlayerChange.ChangedCalling({ calling: save.calling }),
    EarnedRank: () => change,
    GrantedVeteranRank: () =>
      PlayerChange.GrantedVeteranRank({
        points: save.rank.veteranPoints,
        bones: save.rank.veteranBones,
      }),
  })

// NOTE: a finished run counts each time it is sent, and the power-ups seen
// and forgotten must keep their order, so those are all kept. Every other
// change sets its field to what it holds now, so one of each is enough.
const isSetOnce = (change: PlayerChange): boolean =>
  !PlayerChange.isAnyOf([
    'RecordedRun',
    'SawPowerUps',
    'ForgotPowerUps',
    'EarnedRank',
  ])(change)

export const withUnsavedChanges = (
  unsaved: ReadonlyArray<PlayerChange>,
  changes: ReadonlyArray<PlayerChange>,
  save: PlayerSave,
): ReadonlyArray<PlayerChange> =>
  Array.isReadonlyArrayEmpty(unsaved)
    ? changes
    : Array.reduce(
        [...Array.map(unsaved, change => refreshed(change, save)), ...changes],
        Array.empty<PlayerChange>(),
        (kept, change) =>
          isSetOnce(change) &&
          Array.some(kept, other => other._tag === change._tag)
            ? kept
            : Array.append(kept, change),
      )

// STATUS

// NOTE: what SETTINGS says about sync. LocalOnly is a build with no sync
// server, such as `bun dev` or the itch.io zip. Devices counts this player's
// linked devices, this one included.
export const SyncState = defineTaggedUnion({
  LocalOnly: {},
  Connecting: {},
  Synced: { devices: Schema.Number },
  Offline: { devices: Schema.Number },
})
export type SyncState = typeof SyncState.Type

export const syncStateText = (state: SyncState): string =>
  SyncState.match(state, {
    LocalOnly: () => 'Saved on this device',
    Connecting: () => 'Connecting',
    Synced: ({ devices }) =>
      devices > 1 ? `Synced. Linked to ${devices} devices` : 'Synced',
    Offline: () => 'Offline, will sync',
  })

// NOTE: how far this device has got with the player scope, as the sync
// engine's ScopeStatus says it (the engine loads lazily, so the game keeps
// its own copy of the shape). SyncState is the connection; this is the
// data. Ready and not fresh is progress cached from an earlier session,
// shown while the device connects or stays offline.
export const PlayerScopeStatus = defineTaggedUnion({
  Idle: {},
  Loading: {},
  Ready: { seq: Schema.Number, fresh: Schema.Boolean },
  Failed: { reason: Schema.String },
})
export type PlayerScopeStatus = typeof PlayerScopeStatus.Type

// NOTE: what the store hears from the sync engine: a save that changed
// because of another device or the server, the sync status line, and how
// far the player scope has loaded.
export const StoreEvent = defineTaggedUnion({
  SyncedSave: { save: PlayerSave },
  SyncStatus: { state: SyncState },
  ScopeStatus: { status: PlayerScopeStatus },
})
export type StoreEvent = typeof StoreEvent.Type

// NOTE: SETTINGS' Devices line, from the connection and the scope together.
export const devicesStatusText = (
  state: SyncState,
  scope: PlayerScopeStatus,
): string => {
  if (state._tag === 'LocalOnly') {
    return syncStateText(state)
  } else if (scope._tag === 'Failed') {
    return 'Sync is not working on this device'
  } else if (
    state._tag === 'Connecting' &&
    scope._tag === 'Ready' &&
    !scope.fresh
  ) {
    return 'Connecting. Showing saved progress'
  } else {
    return syncStateText(state)
  }
}

// NOTE: whether the last run this device finished has reached the server.
// Waiting holds the RecordedRun's mutation id, so a settlement for an older
// run never overwrites a newer one.
export const RunSettled = defineTaggedUnion({
  Confirmed: { seq: Schema.Number },
  Rejected: { reason: Schema.String },
})
export type RunSettled = typeof RunSettled.Type

export const LastRunSync = defineTaggedUnion({
  NoRun: {},
  Waiting: { id: Schema.String },
  Confirmed: { seq: Schema.Number },
  Rejected: { reason: Schema.String },
})
export type LastRunSync = typeof LastRunSync.Type

// LINKING

export const LinkProblem = Schema.Literals([
  'WrongCode',
  'TooManyTries',
  'Offline',
  'Unavailable',
])
export type LinkProblem = typeof LinkProblem.Type

// NOTE: SETTINGS' "Link another device" (this device shows a code) and
// "Use a code" (this device types one in and joins that player).
export const LinkFlow = defineTaggedUnion({
  Idle: {},
  Requesting: {},
  Showing: { code: Schema.String },
  Entering: { code: Schema.String },
  Redeeming: { code: Schema.String },
  Linked: {},
  Failed: { problem: LinkProblem },
})
export type LinkFlow = typeof LinkFlow.Type

export const linkProblemText = (problem: LinkProblem): string => {
  if (problem === 'WrongCode') {
    return 'That code did not work. Check it and try again.'
  } else if (problem === 'TooManyTries') {
    return 'Too many tries. Wait a few minutes, then try again.'
  } else if (problem === 'Offline') {
    return 'Could not reach the server. Try again when you are online.'
  } else {
    return 'Linking is not available right now.'
  }
}

export { PlayerSave }
