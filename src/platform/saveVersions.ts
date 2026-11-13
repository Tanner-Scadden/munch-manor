import { Array, Option, Schema, Struct } from 'effect'

import { unlocksAt } from '../domain/unlocks'
import { noDareMarks } from '../shared/dareMarkData'
import { noJournal } from '../shared/journalData'
import { StoredAppearance } from '../shared/lookCodes'
import { noMastery } from '../shared/masteryData'
import { noMissions } from '../shared/missionData'
import {
  Calling,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  PlayerSave,
  PreHatAppearance,
  PreSkinAppearance,
  RotationSetting,
  SAVE_VERSION,
  SavedBests,
  SavedBoughtCosmetics,
  SavedDifficulty,
  type SavedDifficultyBests,
  SavedHome,
  SavedOnboarding,
  SavedPowerUps,
  SavedRank,
  SavedRunRecords,
  SavedSettings,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
  noBonuses,
  noSavedRunRecords,
} from '../shared/playerData'
import { noProof } from '../shared/proofData'
import { noRank, rankOf, totalPointsOf } from '../world/heroes/rank'

// The save's older versions and how each is brought to the current one,
// apart from the save's mapping to and from the Model (src/platform/save.ts).
// A new field in PlayerSave (src/shared/playerData.ts) bumps SAVE_VERSION;
// the version before it gets its Schema and its migration here.

const SavedSettingsV2 = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
})
type SavedSettingsV2 = typeof SavedSettingsV2.Type

// NOTE: the settings from version 5 to 6: sharing, and no cursor yet.
const SavedSettingsV5 = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  shareStats: ShareStatsSetting,
})
type SavedSettingsV5 = typeof SavedSettingsV5.Type

const PlayerSaveV1 = Schema.Struct({
  version: Schema.Literal(1),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV2,
  appearance: StoredAppearance,
})
type PlayerSaveV1 = typeof PlayerSaveV1.Type

const PlayerSaveV2 = Schema.Struct({
  version: Schema.Literal(2),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV2,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
})
type PlayerSaveV2 = typeof PlayerSaveV2.Type

const PlayerSaveV3 = Schema.Struct({
  version: Schema.Literal(3),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV2,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
})
type PlayerSaveV3 = typeof PlayerSaveV3.Type

// NOTE: version 4 is the save the live game keeps in localStorage: the home
// menu's fields, and no shareStats yet.
const PlayerSaveV4 = Schema.Struct({
  version: Schema.Literal(4),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV2,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
})
type PlayerSaveV4 = typeof PlayerSaveV4.Type

// NOTE: the pull request preview of local SQLite numbered its save 4 too,
// before the home menu: shareStats and no home. Only the preview ever wrote
// it, to localStorage in a private window. It reads as version 4 with the
// home menu unvisited.
const PlayerSavePreviewV4 = Schema.Struct({
  version: Schema.Literal(4),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV5,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
})
type PlayerSavePreviewV4 = typeof PlayerSavePreviewV4.Type

// NOTE: version 5 is the save before the power-ups seen: the home menu and
// shareStats.
const PlayerSaveV5 = Schema.Struct({
  version: Schema.Literal(5),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV5,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
})
type PlayerSaveV5 = typeof PlayerSaveV5.Type

// NOTE: version 6 is the save before the cursor setting: the power-ups seen,
// and the thin system crosshair for everyone.
const PlayerSaveV6 = Schema.Struct({
  version: Schema.Literal(6),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV5,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
})
type PlayerSaveV6 = typeof PlayerSaveV6.Type

// NOTE: version 7 is the save before the rotation: the cursor setting.
const PlayerSaveV7 = Schema.Struct({
  version: Schema.Literal(7),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
})
type PlayerSaveV7 = typeof PlayerSaveV7.Type

// NOTE: version 8 is the save before the display name: the rotation.
const PlayerSaveV8 = Schema.Struct({
  version: Schema.Literal(8),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
})
type PlayerSaveV8 = typeof PlayerSaveV8.Type

// NOTE: versions 9 and 10 are the saves before the simple look, with the
// display name: 9 with a Female or Male body, and 10 with the many-part
// look that shipped for a few hours on 2026-10-30. Their fields are the
// same; StoredAppearance reads either look.
const PlayerSaveV9 = Schema.Struct({
  version: Schema.Literals([9, 10]),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: StoredAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  name: PlayerName,
})
type PlayerSaveV9 = typeof PlayerSaveV9.Type

// NOTE: version 11 is the save before the run records.
const PlayerSaveV11 = Schema.Struct({
  version: Schema.Literal(11),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: PreHatAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  name: PlayerName,
})
type PlayerSaveV11 = typeof PlayerSaveV11.Type

// NOTE: version 27 is the save before the dare ladder.
const PlayerSaveV27 = Schema.Struct({
  ...Struct.omit(PlayerSave.fields, ['dareMarks']),
  version: Schema.Literal(27),
})
type PlayerSaveV27 = typeof PlayerSaveV27.Type

// NOTE: version 26 is the save before hero and gun mastery. Its look reads
// with the stock prop (Appearance's default).
const PlayerSaveV26 = Schema.Struct({
  ...Struct.omit(PlayerSaveV27.fields, ['mastery']),
  version: Schema.Literal(26),
})
type PlayerSaveV26 = typeof PlayerSaveV26.Type

// NOTE: version 25 is the save before the rank purses. Its bonuses read
// with no purse paid (SavedBonuses' default); they are paid at load.
const PlayerSaveV25 = Schema.Struct({
  ...PlayerSaveV26.fields,
  version: Schema.Literal(25),
})
type PlayerSaveV25 = typeof PlayerSaveV25.Type

// NOTE: version 24 is the save before the Dare Journal.
const PlayerSaveV24 = Schema.Struct({
  ...Struct.omit(PlayerSaveV25.fields, ['journal']),
  version: Schema.Literal(24),
})
type PlayerSaveV24 = typeof PlayerSaveV24.Type

// NOTE: version 23 is the save before the Proof Shelf.
const PlayerSaveV23 = Schema.Struct({
  ...Struct.omit(PlayerSaveV24.fields, ['proof']),
  version: Schema.Literal(23),
})
type PlayerSaveV23 = typeof PlayerSaveV23.Type

// NOTE: version 22 is the save before the daily missions.
const PlayerSaveV22 = Schema.Struct({
  ...Struct.omit(PlayerSaveV23.fields, ['missions']),
  version: Schema.Literal(22),
})
type PlayerSaveV22 = typeof PlayerSaveV22.Type

// NOTE: version 21 is the save before the last run's ending.
const PlayerSaveV21 = Schema.Struct({
  ...Struct.omit(PlayerSaveV22.fields, ['lastRun']),
  version: Schema.Literal(21),
})
type PlayerSaveV21 = typeof PlayerSaveV21.Type

// NOTE: version 20 is the save before the Bones bonuses. Its records read
// with no best run (SavedRunRecord's default).
const PlayerSaveV20 = Schema.Struct({
  ...Struct.omit(PlayerSaveV21.fields, ['bonuses']),
  version: Schema.Literal(20),
})
type PlayerSaveV20 = typeof PlayerSaveV20.Type

// NOTE: version 19 is the save before the RECORD MY RUNS unlock synced.
const PlayerSaveV19 = Schema.Struct({
  ...Struct.omit(PlayerSaveV20.fields, ['recordUnlock']),
  version: Schema.Literal(19),
})
type PlayerSaveV19 = typeof PlayerSaveV19.Type

// NOTE: version 18 is the save before RECORD MY RUNS.
const PlayerSaveV18 = Schema.Struct({
  ...Struct.omit(PlayerSaveV19.fields, ['recordRuns']),
  version: Schema.Literal(18),
})
type PlayerSaveV18 = typeof PlayerSaveV18.Type

// NOTE: version 17 is the save before controllers: no rumble.
const PlayerSaveV17 = Schema.Struct({
  ...Struct.omit(PlayerSaveV18.fields, ['rumble']),
  version: Schema.Literal(17),
})
type PlayerSaveV17 = typeof PlayerSaveV17.Type

// NOTE: version 16 is the save before endless ammo: its onboarding also
// held the ammo tip, which decoding drops.
const PlayerSaveV16 = Schema.Struct({
  ...PlayerSaveV17.fields,
  version: Schema.Literal(16),
})
type PlayerSaveV16 = typeof PlayerSaveV16.Type

// NOTE: version 15 is the save before gun skins and the other earned looks:
// its look has a hat and no skin, and its bought list is the hats.
const PlayerSaveV15 = Schema.Struct({
  version: Schema.Literal(15),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: PreSkinAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  name: PlayerName,
  records: SavedRunRecords,
  rank: SavedRank,
  calling: Calling,
  boughtHats: SavedBoughtCosmetics,
})
type PlayerSaveV15 = typeof PlayerSaveV15.Type

// NOTE: version 14 is the save before hats.
const PlayerSaveV14 = Schema.Struct({
  version: Schema.Literal(14),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: PreHatAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  name: PlayerName,
  records: SavedRunRecords,
  rank: SavedRank,
  calling: Calling,
})
type PlayerSaveV14 = typeof PlayerSaveV14.Type

// NOTE: version 13 is the save before callings.
const PlayerSaveV13 = Schema.Struct({
  version: Schema.Literal(13),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: PreHatAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  name: PlayerName,
  records: SavedRunRecords,
  rank: SavedRank,
})
type PlayerSaveV13 = typeof PlayerSaveV13.Type

// NOTE: version 12 is the save before rank.
const PlayerSaveV12 = Schema.Struct({
  version: Schema.Literal(12),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: PreHatAppearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  name: PlayerName,
  records: SavedRunRecords,
})
type PlayerSaveV12 = typeof PlayerSaveV12.Type

const PlayerSaveJson = Schema.fromJsonString(PlayerSave)

const PlayerSaveV14Json = Schema.fromJsonString(PlayerSaveV14)
const PlayerSaveV15Json = Schema.fromJsonString(PlayerSaveV15)
const PlayerSaveV16Json = Schema.fromJsonString(PlayerSaveV16)
const PlayerSaveV17Json = Schema.fromJsonString(PlayerSaveV17)
const PlayerSaveV27Json = Schema.fromJsonString(PlayerSaveV27)
const PlayerSaveV26Json = Schema.fromJsonString(PlayerSaveV26)
const PlayerSaveV25Json = Schema.fromJsonString(PlayerSaveV25)
const PlayerSaveV24Json = Schema.fromJsonString(PlayerSaveV24)
const PlayerSaveV23Json = Schema.fromJsonString(PlayerSaveV23)
const PlayerSaveV22Json = Schema.fromJsonString(PlayerSaveV22)
const PlayerSaveV21Json = Schema.fromJsonString(PlayerSaveV21)
const PlayerSaveV20Json = Schema.fromJsonString(PlayerSaveV20)
const PlayerSaveV19Json = Schema.fromJsonString(PlayerSaveV19)

const PlayerSaveV18Json = Schema.fromJsonString(PlayerSaveV18)

const PlayerSaveV13Json = Schema.fromJsonString(PlayerSaveV13)

const PlayerSaveV12Json = Schema.fromJsonString(PlayerSaveV12)

const PlayerSaveV11Json = Schema.fromJsonString(PlayerSaveV11)

const PlayerSaveV9Json = Schema.fromJsonString(PlayerSaveV9)

const PlayerSaveV8Json = Schema.fromJsonString(PlayerSaveV8)

const PlayerSaveV7Json = Schema.fromJsonString(PlayerSaveV7)

const PlayerSaveV6Json = Schema.fromJsonString(PlayerSaveV6)

const PlayerSaveV5Json = Schema.fromJsonString(PlayerSaveV5)

const PlayerSaveV4Json = Schema.fromJsonString(PlayerSaveV4)

const PlayerSavePreviewV4Json = Schema.fromJsonString(PlayerSavePreviewV4)

const PlayerSaveV3Json = Schema.fromJsonString(PlayerSaveV3)

const PlayerSaveV2Json = Schema.fromJsonString(PlayerSaveV2)

const PlayerSaveV1Json = Schema.fromJsonString(PlayerSaveV1)

export const unpickedDifficulty: SavedDifficulty = {
  chosen: 'Normal',
  card: 'Unseen',
  nightmare: 'Locked',
}

const noSavedDifficultyBests: SavedDifficultyBests = {
  fastestWinMs: null,
  bestEndlessWave: null,
}

export const noSavedBests: SavedBests = {
  runsPlayed: 0,
  totalKills: 0,
  killsByKind: {},
  byDifficulty: {
    Easy: noSavedDifficultyBests,
    Normal: noSavedDifficultyBests,
    Hard: noSavedDifficultyBests,
    Nightmare: noSavedDifficultyBests,
  },
}

export const unvisitedHome: SavedHome = {
  seenNewsDay: null,
  openedEntries: [],
}

const sharingSettings = (settings: SavedSettingsV2): SavedSettingsV5 => ({
  sound: settings.sound,
  music: settings.music,
  shake: settings.shake,
  shareStats: 'On',
})

// NOTE: a save from before the cursor setting gets the bold cursor, the
// default for a new player too, since the thin one was hard to see.
const boldCursorSettings = (settings: SavedSettingsV5): SavedSettings => ({
  sound: settings.sound,
  music: settings.music,
  shake: settings.shake,
  shareStats: settings.shareStats,
  cursor: 'Bold',
})

const migrateV1 = (save: PlayerSaveV1): PlayerSaveV2 => ({
  version: 2,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: unpickedDifficulty,
})

const migrateV2 = (save: PlayerSaveV2): PlayerSaveV3 => ({
  version: 3,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: noSavedBests,
})

const migrateV3 = (save: PlayerSaveV3): PlayerSaveV4 => ({
  version: 4,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: unvisitedHome,
})

const migrateV4 = (save: PlayerSaveV4): PlayerSaveV5 => ({
  version: 5,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: sharingSettings(save.settings),
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: save.home,
})

const migratePreviewV4 = (save: PlayerSavePreviewV4): PlayerSaveV5 => ({
  version: 5,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: unvisitedHome,
})

const migrateV5 = (save: PlayerSaveV5): PlayerSaveV6 => ({
  version: 6,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: save.home,
  seenPowerUps: [],
})

const migrateV6 = (save: PlayerSaveV6): PlayerSaveV7 => ({
  version: 7,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: boldCursorSettings(save.settings),
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: save.home,
  seenPowerUps: save.seenPowerUps,
})

// NOTE: every save from before the rotation turns as before: landscape.
const migrateV7 = (save: PlayerSaveV7): PlayerSaveV8 => ({
  version: 8,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: save.home,
  seenPowerUps: save.seenPowerUps,
  rotation: 'Landscape',
})

// NOTE: a save from before the display name has no name yet, and shows the
// placeholder until the player picks one.
const migrateV8 = (save: PlayerSaveV8): PlayerSaveV9 => ({
  version: 9,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: save.home,
  seenPowerUps: save.seenPowerUps,
  rotation: save.rotation,
  name: '',
})

// NOTE: a save from before the simple look keeps its look: every older
// version reads it through StoredAppearance (src/shared/playerData.ts) as the
// closest current one, so only the version number moves on.
const migrateV9 = (save: PlayerSaveV9): PlayerSaveV11 => ({
  version: 11,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: save.home,
  seenPowerUps: save.seenPowerUps,
  rotation: save.rotation,
  name: save.name,
})

// NOTE: a save from before the run records has none yet, so its first
// records are set without a NEW BEST.
const migrateV11 = (save: PlayerSaveV11): PlayerSaveV12 => ({
  ...save,
  version: 12,
  records: noSavedRunRecords,
})

// NOTE: a save from before rank has earned none and has not been granted
// the veteran start yet: the first load after the update grants it from the
// kills the save holds (grantVeteranFrom in src/features/end/rankRun.ts), once.
const migrateV12 = (save: PlayerSaveV12): PlayerSaveV13 => ({
  ...save,
  version: 13,
  rank: noRank,
})

// NOTE: a save from before callings picks YOU, the calling with no quirk.
const migrateV13 = (save: PlayerSaveV13): PlayerSaveV14 => ({
  ...save,
  version: 14,
  calling: 'You',
})

// NOTE: a save from before hats is bare headed and has bought none.
const migrateV14 = (save: PlayerSaveV14): PlayerSaveV15 => ({
  ...save,
  version: 15,
  appearance: { ...save.appearance, hat: 'None' },
  boughtHats: [],
})

// NOTE: a save from before gun skins has the stock guns, and its bought
// hats are the first of the cosmetics bought. It has seen every unlock it
// had reached, so NEW badges start fresh from here.
const migrateV15 = ({ boughtHats, ...save }: PlayerSaveV15): PlayerSaveV16 => ({
  ...save,
  version: 16,
  appearance: { ...save.appearance, gunSkin: 'Stock', propStyle: 'Stock' },
  boughtCosmetics: boughtHats,
  seenUnlocks: unlocksAt(rankOf(totalPointsOf(save.rank))),
})

// NOTE: a save from before endless ammo loses only its ammo tip, which
// decoding already dropped.
const migrateV16 = (save: PlayerSaveV16): PlayerSaveV17 => ({
  ...save,
  version: 17,
})

// NOTE: a save from before controllers rumbles, as a new player's does.
const migrateV17 = (save: PlayerSaveV17): PlayerSaveV18 => ({
  ...save,
  version: 18,
  rumble: 'On',
})

// NOTE: a save from before RECORD MY RUNS records nothing.
const migrateV18 = (save: PlayerSaveV18): PlayerSaveV19 => ({
  ...save,
  version: 19,
  recordRuns: 'Off',
})

// NOTE: a save from before the unlock synced reads it as locked. A device
// that unlocked it still holds its own mark, read at boot, which unlocks
// the save then (ReadRecordUnlock in src/app/boot.ts).
const migrateV19 = (save: PlayerSaveV19): PlayerSaveV20 => ({
  ...save,
  version: 20,
  recordUnlock: 'Locked',
})

// NOTE: a save from before the Bones bonuses has had none: its next run of
// the day pays double, and its first escape on each difficulty pays the
// bonus, an escape from before included.
const migrateV20 = (save: PlayerSaveV20): PlayerSaveV21 => ({
  ...save,
  version: 21,
  bonuses: noBonuses,
})

// NOTE: a save from before the friends in the car remembered reads as no
// run yet, so the first intro after the update says nothing new.
const migrateV21 = (save: PlayerSaveV21): PlayerSaveV22 => ({
  ...save,
  version: 22,
  lastRun: 'NoRunYet',
})

// NOTE: a save from before the daily missions has none yet and has played
// no co-op as far as the missions know: its first online run says so.
const migrateV22 = (save: PlayerSaveV22): PlayerSaveV23 => ({
  ...save,
  version: 23,
  missions: noMissions,
})

// NOTE: a save from before the Proof Shelf has an empty shelf: what it
// brought out before then left no stamp.
const migrateV23 = (save: PlayerSaveV23): PlayerSaveV24 => ({
  ...save,
  version: 24,
  proof: noProof,
})

// NOTE: a save from before the Dare Journal starts it empty: the
// milestones it already meets are reached at the next run's end.
const migrateV24 = (save: PlayerSaveV24): PlayerSaveV25 => ({
  ...save,
  version: 25,
  journal: noJournal,
})

// NOTE: a save from before the rank purses has none paid: the purses its
// rank has reached are paid at load, once (src/app/update/purses.ts).
const migrateV25 = (save: PlayerSaveV25): PlayerSaveV26 => ({
  ...save,
  version: 26,
})

// NOTE: a save from before mastery starts every hero's track and every
// gun's kills at none: kills were never kept by gun before.
const migrateV26 = (save: PlayerSaveV26): PlayerSaveV27 => ({
  ...save,
  version: 27,
  mastery: noMastery,
})

// NOTE: a save from before the dare ladder has no mark opened. An escape it
// made already does not count: the ladder starts at the next one.
const migrateV27 = (save: PlayerSaveV27): PlayerSave => ({
  ...save,
  version: SAVE_VERSION,
  dareMarks: noDareMarks,
})

const fromV26 = (save: PlayerSaveV26): PlayerSave =>
  migrateV27(migrateV26(save))

const fromV25 = (save: PlayerSaveV25): PlayerSave => fromV26(migrateV25(save))

const fromV24 = (save: PlayerSaveV24): PlayerSave => fromV25(migrateV24(save))

const fromV23 = (save: PlayerSaveV23): PlayerSave => fromV24(migrateV23(save))

const fromV22 = (save: PlayerSaveV22): PlayerSave => fromV23(migrateV22(save))

const fromV21 = (save: PlayerSaveV21): PlayerSave => fromV22(migrateV21(save))

const fromV20 = (save: PlayerSaveV20): PlayerSave => fromV21(migrateV20(save))

const fromV19 = (save: PlayerSaveV19): PlayerSave => fromV20(migrateV19(save))

const fromV18 = (save: PlayerSaveV18): PlayerSave => fromV19(migrateV18(save))

const fromV17 = (save: PlayerSaveV17): PlayerSave => fromV18(migrateV17(save))

const fromV16 = (save: PlayerSaveV16): PlayerSave => fromV17(migrateV16(save))

const fromV15 = (save: PlayerSaveV15): PlayerSave => fromV16(migrateV15(save))

const fromV13 = (save: PlayerSaveV13): PlayerSave =>
  fromV15(migrateV14(migrateV13(save)))

const fromV12 = (save: PlayerSaveV12): PlayerSave => fromV13(migrateV12(save))

const fromV11 = (save: PlayerSaveV11): PlayerSave => fromV12(migrateV11(save))

const fromV9 = (save: PlayerSaveV9): PlayerSave => fromV11(migrateV9(save))

const fromV8 = (save: PlayerSaveV8): PlayerSave => fromV9(migrateV8(save))

const fromV7 = (save: PlayerSaveV7): PlayerSave => fromV8(migrateV7(save))

const fromV6 = (save: PlayerSaveV6): PlayerSave => fromV7(migrateV6(save))

const fromV5 = (save: PlayerSaveV5): PlayerSave => fromV6(migrateV5(save))

const fromV4 = (save: PlayerSaveV4): PlayerSave => fromV5(migrateV4(save))

const fromV3 = (save: PlayerSaveV3): PlayerSave => fromV4(migrateV3(save))

const fromV2 = (save: PlayerSaveV2): PlayerSave => fromV3(migrateV2(save))

// NOTE: the one list of save versions this build reads, newest first, each
// with its way to the current save. A new version goes at the top, with its
// number in SAVE_VERSION (src/shared/playerData.ts). Renumbering versions after a
// merge happens here and there only. The sync scope's SeededPlayer carries
// the current PlayerSave, so a new version also bumps its mutation version
// in src/platform/playerScope.ts.
const SAVE_VERSIONS: ReadonlyArray<
  Readonly<{
    version: number
    read: (raw: string) => Option.Option<PlayerSave>
  }>
> = [
  { version: SAVE_VERSION, read: Schema.decodeOption(PlayerSaveJson) },
  {
    version: 27,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV27Json)(raw), migrateV27),
  },
  {
    version: 26,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV26Json)(raw), fromV26),
  },
  {
    version: 25,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV25Json)(raw), fromV25),
  },
  {
    version: 24,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV24Json)(raw), fromV24),
  },
  {
    version: 23,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV23Json)(raw), fromV23),
  },
  {
    version: 22,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV22Json)(raw), fromV22),
  },
  {
    version: 21,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV21Json)(raw), fromV21),
  },
  {
    version: 20,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV20Json)(raw), fromV20),
  },
  {
    version: 19,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV19Json)(raw), fromV19),
  },
  {
    version: 18,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV18Json)(raw), fromV18),
  },
  {
    version: 17,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV17Json)(raw), fromV17),
  },
  {
    version: 16,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV16Json)(raw), fromV16),
  },
  {
    version: 15,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV15Json)(raw), fromV15),
  },
  {
    version: 14,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV14Json)(raw), save =>
        fromV15(migrateV14(save)),
      ),
  },
  {
    version: 13,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV13Json)(raw), fromV13),
  },
  {
    version: 12,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV12Json)(raw), fromV12),
  },
  {
    version: 11,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV11Json)(raw), fromV11),
  },
  {
    version: 10,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV9Json)(raw), fromV9),
  },
  {
    version: 8,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV8Json)(raw), fromV8),
  },
  {
    version: 7,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV7Json)(raw), fromV7),
  },
  {
    version: 6,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV6Json)(raw), fromV6),
  },
  {
    version: 5,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV5Json)(raw), fromV5),
  },
  {
    version: 4,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV4Json)(raw), fromV4),
  },
  {
    version: 4,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSavePreviewV4Json)(raw), save =>
        fromV5(migratePreviewV4(save)),
      ),
  },
  {
    version: 3,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV3Json)(raw), fromV3),
  },
  {
    version: 2,
    read: raw => Option.map(Schema.decodeOption(PlayerSaveV2Json)(raw), fromV2),
  },
  {
    version: 1,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV1Json)(raw), save =>
        fromV2(migrateV1(save)),
      ),
  },
]

export const decodeSave = (raw: string): Option.Option<PlayerSave> =>
  Array.reduce(SAVE_VERSIONS, Option.none<PlayerSave>(), (found, { read }) =>
    Option.orElse(found, () => read(raw)),
  )

export const encodeSave = (save: PlayerSave): Option.Option<string> =>
  Schema.encodeOption(PlayerSaveJson)(save)
