import { Array, Function, Option, Record, Result, Schema, pipe } from 'effect'

import { UiSchema } from '@effect/ui'

import { DayStamp } from '../shared/dayStamp'
import { SavedJournal, journalAdded } from '../shared/journalData'
import { SavedMastery, masteryAdded } from '../shared/masteryData'
import {
  ALL_THREE_BONES,
  MissionReroll,
  type SavedMissions,
  bonesOfMission,
} from '../shared/missionData'
import {
  Appearance,
  Calling,
  Difficulty,
  FIRST_ESCAPE_BONES,
  HomeScreenTip,
  PlayerName,
  PlayerSave,
  RecordRunsSetting,
  RotationSetting,
  RumbleSetting,
  RunEnding,
  SavedBestsByDifficulty,
  SavedCard,
  SavedHome,
  SavedOnboarding,
  SavedPowerUps,
  SavedRunRecords,
  SavedSeenUnlocks,
  SavedSettings,
} from '../shared/playerData'
import { ProofEntry, shelvedSince } from '../shared/proofData'
import { purseBonesAt } from '../shared/rankCurve'

export const PlayerChange = UiSchema.TaggedEnum({
  ChangedSettings: { settings: SavedSettings },
  ChangedRotation: { rotation: RotationSetting },
  ChangedRumble: { rumble: RumbleSetting },
  ChangedRecordRuns: { recordRuns: RecordRunsSetting },
  ChangedName: { name: PlayerName },
  ChangedAppearance: { appearance: Appearance },
  UnlockedNightmare: {},
  UnlockedRecording: {},
  ChangedDifficulty: { chosen: Difficulty, card: SavedCard },
  ChangedOnboarding: {
    onboarding: SavedOnboarding,
    homeScreenTip: HomeScreenTip,
  },
  ChangedHome: { home: SavedHome },
  SawPowerUps: { kinds: SavedPowerUps },
  SawUnlocks: { ids: SavedSeenUnlocks },
  ForgotPowerUps: {},
  RecordedRun: {
    runs: Schema.Finite,
    totalKills: Schema.Finite,
    kills: Schema.Record(Schema.String, Schema.Finite),
    bests: SavedBestsByDifficulty,
  },
  ReachedRecords: { records: SavedRunRecords },
  ChangedCalling: { calling: Calling },
  EarnedRank: { points: Schema.Finite, bones: Schema.Finite },
  GrantedVeteranRank: { points: Schema.Finite, bones: Schema.Finite },
  BoughtCosmetic: { id: Schema.String },
  DoubledFirstRun: { day: DayStamp, bones: Schema.Finite },
  EscapedFirst: { difficulty: Difficulty },
  EndedRun: { lastRun: RunEnding },
  ProgressedMissions: {
    day: DayStamp,
    progress: Schema.Record(Schema.String, Schema.Finite),
    coop: Schema.Boolean,
  },
  RolledMissions: { day: DayStamp, rolled: Schema.Array(Schema.String) },
  RerolledMission: { day: DayStamp, reroll: MissionReroll },
  ClaimedMission: { day: DayStamp, mission: Schema.String },
  StampedMissionDay: { day: DayStamp },
  ShelvedProof: { entry: ProofEntry },
  KeptJournal: { added: SavedJournal },
  GainedMastery: { added: SavedMastery },
  ClimbedDareLadder: { difficulty: Difficulty, mark: Schema.Finite },
  PaidRankPurse: { rank: Schema.Finite },
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

type BonusChanges = Readonly<{
  changes: ReadonlyArray<PlayerChange>
  bonusBones: number
}>

const bonusChanges = (
  before: PlayerSave,
  after: PlayerSave,
  earnedBones: number,
): BonusChanges => {
  const escapes = Array.filter(
    after.bonuses.escapedOn,
    difficulty => !Array.contains(before.bonuses.escapedOn, difficulty),
  )
  const escapeBones = escapes.length * FIRST_ESCAPE_BONES
  const maybeDoubledDay = Option.filter(
    Option.fromNullishOr(after.bonuses.doubledDay),
    day => day !== before.bonuses.doubledDay,
  )
  const doubleBones = Option.isSome(maybeDoubledDay)
    ? Math.floor(Math.max(0, earnedBones - escapeBones) / 2)
    : 0
  return {
    changes: [
      ...Array.map(escapes, difficulty =>
        PlayerChange.EscapedFirst({ difficulty }),
      ),
      ...Option.match(maybeDoubledDay, {
        onNone: () => [],
        onSome: day => [
          PlayerChange.DoubledFirstRun({ day, bones: doubleBones }),
        ],
      }),
    ],
    bonusBones: Math.min(earnedBones, escapeBones + doubleBones),
  }
}

type MissionChanges = Readonly<{
  changes: ReadonlyArray<PlayerChange>
  missionBones: number
}>

const progressAdded = (
  before: SavedMissions,
  after: SavedMissions,
): Record<string, number> =>
  before.day === after.day
    ? killsAdded(before.progress, after.progress)
    : Record.filter(after.progress, count => count > 0)

const missionChanges = (
  before: SavedMissions,
  after: SavedMissions,
): MissionChanges => {
  if (after.day === null) {
    return { changes: [], missionBones: 0 }
  }
  const day = after.day
  const isNewDay = before.day !== day
  const progress = progressAdded(before, after)
  const isCoopNew = after.hasPlayedCoop && !before.hasPlayedCoop
  const claims = Array.filter(
    after.claimed,
    id => isNewDay || !Array.contains(before.claimed, id),
  )
  const stamps = Array.filter(
    after.stampedDays,
    stamped => !Array.contains(before.stampedDays, stamped),
  )
  return {
    changes: [
      ...changeWhen(!Record.isEmptyRecord(progress) || isCoopNew, () =>
        PlayerChange.ProgressedMissions({ day, progress, coop: isCoopNew }),
      ),
      ...(Array.isReadonlyArrayNonEmpty(after.rolled) &&
      (isNewDay || Array.isReadonlyArrayEmpty(before.rolled))
        ? [PlayerChange.RolledMissions({ day, rolled: after.rolled })]
        : []),
      ...(after.reroll !== null && (isNewDay || before.reroll === null)
        ? [PlayerChange.RerolledMission({ day, reroll: after.reroll })]
        : []),
      ...Array.map(claims, mission =>
        PlayerChange.ClaimedMission({ day, mission }),
      ),
      ...Array.map(stamps, stamped =>
        PlayerChange.StampedMissionDay({ day: stamped }),
      ),
    ],
    missionBones:
      Array.reduce(claims, 0, (total, id) => total + bonesOfMission(id)) +
      stamps.length * ALL_THREE_BONES,
  }
}

const newPursesOf = (
  before: PlayerSave,
  after: PlayerSave,
): ReadonlyArray<number> =>
  Array.filter(
    after.bonuses.purses,
    rank => !Array.contains(before.bonuses.purses, rank),
  )

const bonesOfPurses = (ranks: ReadonlyArray<number>): number =>
  Array.reduce(
    ranks,
    0,
    (total, rank) => total + Option.getOrElse(purseBonesAt(rank), () => 0),
  )

export const changesBetween: {
  (after: PlayerSave): (before: PlayerSave) => ReadonlyArray<PlayerChange>
  (before: PlayerSave, after: PlayerSave): ReadonlyArray<PlayerChange>
} = Function.dual(
  2,
  (before: PlayerSave, after: PlayerSave): ReadonlyArray<PlayerChange> => {
    const runs = after.bests.runsPlayed - before.bests.runsPlayed
    const totalKills = after.bests.totalKills - before.bests.totalKills
    const kills = killsAdded(before.bests.killsByKind, after.bests.killsByKind)
    const missions = missionChanges(before.missions, after.missions)
    const purses = newPursesOf(before, after)
    const earnedBones = Math.max(
      0,
      after.rank.earnedBones -
        before.rank.earnedBones -
        missions.missionBones -
        bonesOfPurses(purses),
    )
    const bonus = bonusChanges(before, after, earnedBones)
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
        changeWhen(before.rumble !== after.rumble, () =>
          PlayerChange.ChangedRumble({ rumble: after.rumble }),
        ),
        changeWhen(before.recordRuns !== after.recordRuns, () =>
          PlayerChange.ChangedRecordRuns({ recordRuns: after.recordRuns }),
        ),
        changeWhen(
          before.recordUnlock === 'Locked' && after.recordUnlock === 'Unlocked',
          () => PlayerChange.UnlockedRecording(),
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
        Array.isReadonlyArrayNonEmpty(
          Array.filter(
            after.seenUnlocks,
            id => !Array.contains(before.seenUnlocks, id),
          ),
        )
          ? [PlayerChange.SawUnlocks({ ids: after.seenUnlocks })]
          : [],
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
        changeWhen(before.lastRun !== after.lastRun, () =>
          PlayerChange.EndedRun({ lastRun: after.lastRun }),
        ),
        changeWhen(before.calling !== after.calling, () =>
          PlayerChange.ChangedCalling({ calling: after.calling }),
        ),
        changeWhen(
          after.rank.earnedPoints > before.rank.earnedPoints ||
            earnedBones > bonus.bonusBones,
          () =>
            PlayerChange.EarnedRank({
              points: Math.max(
                0,
                after.rank.earnedPoints - before.rank.earnedPoints,
              ),
              bones: earnedBones - bonus.bonusBones,
            }),
        ),
        bonus.changes,
        missions.changes,
        Array.map(shelvedSince(before.proof, after.proof), entry =>
          PlayerChange.ShelvedProof({ entry }),
        ),
        Array.map(journalAdded(before.journal, after.journal), added =>
          PlayerChange.KeptJournal({ added }),
        ),
        Array.map(masteryAdded(before.mastery, after.mastery), added =>
          PlayerChange.GainedMastery({ added }),
        ),
        Array.filterMap(Difficulty.literals, difficulty =>
          after.dareMarks[difficulty] > before.dareMarks[difficulty]
            ? Result.succeed(
                PlayerChange.ClimbedDareLadder({
                  difficulty,
                  mark: after.dareMarks[difficulty],
                }),
              )
            : Result.failVoid,
        ),
        Array.map(
          Array.filter(
            after.boughtCosmetics,
            hat => !Array.contains(before.boughtCosmetics, hat),
          ),
          id => PlayerChange.BoughtCosmetic({ id }),
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
        Array.map(purses, rank => PlayerChange.PaidRankPurse({ rank })),
      ],
      Array.flatten,
    )
  },
)

const refreshed = (change: PlayerChange, save: PlayerSave): PlayerChange =>
  PlayerChange.match(change, {
    ChangedSettings: () =>
      PlayerChange.ChangedSettings({ settings: save.settings }),
    ChangedRotation: () =>
      PlayerChange.ChangedRotation({ rotation: save.rotation }),
    ChangedRumble: () => PlayerChange.ChangedRumble({ rumble: save.rumble }),
    ChangedRecordRuns: () =>
      PlayerChange.ChangedRecordRuns({ recordRuns: save.recordRuns }),
    ChangedName: () => PlayerChange.ChangedName({ name: save.name }),
    ChangedAppearance: () =>
      PlayerChange.ChangedAppearance({ appearance: save.appearance }),
    UnlockedNightmare: () => change,
    UnlockedRecording: () => change,
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
    SawUnlocks: () => PlayerChange.SawUnlocks({ ids: save.seenUnlocks }),
    ForgotPowerUps: () => change,
    RecordedRun: run =>
      PlayerChange.RecordedRun({ ...run, bests: save.bests.byDifficulty }),
    ReachedRecords: () =>
      PlayerChange.ReachedRecords({ records: save.records }),
    ChangedCalling: () =>
      PlayerChange.ChangedCalling({ calling: save.calling }),
    EarnedRank: () => change,
    BoughtCosmetic: () => change,
    DoubledFirstRun: () => change,
    EscapedFirst: () => change,
    EndedRun: () => PlayerChange.EndedRun({ lastRun: save.lastRun }),
    ProgressedMissions: () => change,
    RolledMissions: () => change,
    RerolledMission: () => change,
    ClaimedMission: () => change,
    StampedMissionDay: () => change,
    ShelvedProof: () => change,
    KeptJournal: () => change,
    GainedMastery: () => change,
    ClimbedDareLadder: () => change,
    PaidRankPurse: () => change,
    GrantedVeteranRank: () =>
      PlayerChange.GrantedVeteranRank({
        points: save.rank.veteranPoints,
        bones: save.rank.veteranBones,
      }),
  })

const isSetOnce = (change: PlayerChange): boolean =>
  !PlayerChange.isAnyOf([
    'RecordedRun',
    'SawPowerUps',
    'ForgotPowerUps',
    'EarnedRank',
    'BoughtCosmetic',
    'DoubledFirstRun',
    'EscapedFirst',
    'ProgressedMissions',
    'RolledMissions',
    'RerolledMission',
    'ClaimedMission',
    'StampedMissionDay',
    'ShelvedProof',
    'KeptJournal',
    'GainedMastery',
    'ClimbedDareLadder',
    'PaidRankPurse',
  ])(change)

const keepFirstSets = (
  unsaved: ReadonlyArray<PlayerChange>,
  changes: ReadonlyArray<PlayerChange>,
  save: PlayerSave,
): ReadonlyArray<PlayerChange> => {
  const seen = new Set<PlayerChange['_tag']>()
  return Array.filter(
    [...Array.map(unsaved, change => refreshed(change, save)), ...changes],
    change => {
      if (!isSetOnce(change)) {
        return true
      }
      if (seen.has(change._tag)) {
        return false
      }
      seen.add(change._tag)
      return true
    },
  )
}

export const withUnsavedChanges: {
  (
    changes: ReadonlyArray<PlayerChange>,
    save: PlayerSave,
  ): (unsaved: ReadonlyArray<PlayerChange>) => ReadonlyArray<PlayerChange>
  (
    unsaved: ReadonlyArray<PlayerChange>,
    changes: ReadonlyArray<PlayerChange>,
    save: PlayerSave,
  ): ReadonlyArray<PlayerChange>
} = Function.dual(
  3,
  (
    unsaved: ReadonlyArray<PlayerChange>,
    changes: ReadonlyArray<PlayerChange>,
    save: PlayerSave,
  ): ReadonlyArray<PlayerChange> =>
    Array.isReadonlyArrayEmpty(unsaved)
      ? changes
      : keepFirstSets(unsaved, changes, save),
)

export const SyncState = UiSchema.TaggedEnum({
  LocalOnly: {},
  Connecting: {},
  Synced: {},
  Offline: {},
})
export type SyncState = typeof SyncState.Type

export const syncStateText = (state: SyncState): string =>
  SyncState.match(state, {
    LocalOnly: () => 'Saved on this device',
    Connecting: () => 'Connecting',
    Synced: () => 'Synced',
    Offline: () => 'Offline, will sync',
  })

export const StoreEvent = UiSchema.TaggedEnum({
  SyncedSave: { save: PlayerSave },
  SyncStatus: { state: SyncState },
})
export type StoreEvent = typeof StoreEvent.Type

export const LinkProblem = Schema.Literals([
  'WrongCode',
  'TooManyTries',
  'Offline',
  'Unavailable',
])
export type LinkProblem = typeof LinkProblem.Type

export { PlayerSave }
