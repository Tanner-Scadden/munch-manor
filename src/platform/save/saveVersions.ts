import { Array, Option, Schema, Struct } from 'effect'

import { unlocksAt } from '#domain/unlocks.ts'
import { noDareMarks } from '#shared/records/dareMarkData.ts'
import { noJournal } from '#shared/records/journalData.ts'
import { StoredAppearance } from '#shared/records/lookCodes.ts'
import { noMastery } from '#shared/records/masteryData.ts'
import { noMissions } from '#shared/records/missionData.ts'
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
  noSavedBests,
  noSavedRunRecords,
} from '#shared/records/playerData.ts'
import { noProof } from '#shared/records/proofData.ts'
import { noRank, rankOf, totalPointsOf } from '#world/heroes/rank.ts'

const SavedSettingsV2 = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
})
type SavedSettingsV2 = typeof SavedSettingsV2.Type

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

const PlayerSaveV27 = Schema.Struct({
  ...Struct.omit(PlayerSave.fields, ['dareMarks']),
  version: Schema.Literal(27),
})
type PlayerSaveV27 = typeof PlayerSaveV27.Type

const PlayerSaveV26 = Schema.Struct({
  ...Struct.omit(PlayerSaveV27.fields, ['mastery']),
  version: Schema.Literal(26),
})
type PlayerSaveV26 = typeof PlayerSaveV26.Type

const PlayerSaveV25 = Schema.Struct({
  ...PlayerSaveV26.fields,
  version: Schema.Literal(25),
})
type PlayerSaveV25 = typeof PlayerSaveV25.Type

const PlayerSaveV24 = Schema.Struct({
  ...Struct.omit(PlayerSaveV25.fields, ['journal']),
  version: Schema.Literal(24),
})
type PlayerSaveV24 = typeof PlayerSaveV24.Type

const PlayerSaveV23 = Schema.Struct({
  ...Struct.omit(PlayerSaveV24.fields, ['proof']),
  version: Schema.Literal(23),
})
type PlayerSaveV23 = typeof PlayerSaveV23.Type

const PlayerSaveV22 = Schema.Struct({
  ...Struct.omit(PlayerSaveV23.fields, ['missions']),
  version: Schema.Literal(22),
})
type PlayerSaveV22 = typeof PlayerSaveV22.Type

const PlayerSaveV21 = Schema.Struct({
  ...Struct.omit(PlayerSaveV22.fields, ['lastRun']),
  version: Schema.Literal(21),
})
type PlayerSaveV21 = typeof PlayerSaveV21.Type

const PlayerSaveV20 = Schema.Struct({
  ...Struct.omit(PlayerSaveV21.fields, ['bonuses']),
  version: Schema.Literal(20),
})
type PlayerSaveV20 = typeof PlayerSaveV20.Type

const PlayerSaveV19 = Schema.Struct({
  ...Struct.omit(PlayerSaveV20.fields, ['recordUnlock']),
  version: Schema.Literal(19),
})
type PlayerSaveV19 = typeof PlayerSaveV19.Type

const PlayerSaveV18 = Schema.Struct({
  ...Struct.omit(PlayerSaveV19.fields, ['recordRuns']),
  version: Schema.Literal(18),
})
type PlayerSaveV18 = typeof PlayerSaveV18.Type

const PlayerSaveV17 = Schema.Struct({
  ...Struct.omit(PlayerSaveV18.fields, ['rumble']),
  version: Schema.Literal(17),
})
type PlayerSaveV17 = typeof PlayerSaveV17.Type

const PlayerSaveV16 = Schema.Struct({
  ...PlayerSaveV17.fields,
  version: Schema.Literal(16),
})
type PlayerSaveV16 = typeof PlayerSaveV16.Type

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

const migrateV11 = (save: PlayerSaveV11): PlayerSaveV12 => ({
  ...save,
  version: 12,
  records: noSavedRunRecords,
})

const migrateV12 = (save: PlayerSaveV12): PlayerSaveV13 => ({
  ...save,
  version: 13,
  rank: noRank,
})

const migrateV13 = (save: PlayerSaveV13): PlayerSaveV14 => ({
  ...save,
  version: 14,
  calling: 'You',
})

const migrateV14 = (save: PlayerSaveV14): PlayerSaveV15 => ({
  ...save,
  version: 15,
  appearance: { ...save.appearance, hat: 'None' },
  boughtHats: [],
})

const migrateV15 = ({ boughtHats, ...save }: PlayerSaveV15): PlayerSaveV16 => ({
  ...save,
  version: 16,
  appearance: { ...save.appearance, gunSkin: 'Stock', propStyle: 'Stock' },
  boughtCosmetics: boughtHats,
  seenUnlocks: unlocksAt(rankOf(totalPointsOf(save.rank))),
})

const migrateV16 = (save: PlayerSaveV16): PlayerSaveV17 => ({
  ...save,
  version: 17,
})

const migrateV17 = (save: PlayerSaveV17): PlayerSaveV18 => ({
  ...save,
  version: 18,
  rumble: 'On',
})

const migrateV18 = (save: PlayerSaveV18): PlayerSaveV19 => ({
  ...save,
  version: 19,
  recordRuns: 'Off',
})

const migrateV19 = (save: PlayerSaveV19): PlayerSaveV20 => ({
  ...save,
  version: 20,
  recordUnlock: 'Locked',
})

const migrateV20 = (save: PlayerSaveV20): PlayerSaveV21 => ({
  ...save,
  version: 21,
  bonuses: noBonuses,
})

const migrateV21 = (save: PlayerSaveV21): PlayerSaveV22 => ({
  ...save,
  version: 22,
  lastRun: 'NoRunYet',
})

const migrateV22 = (save: PlayerSaveV22): PlayerSaveV23 => ({
  ...save,
  version: 23,
  missions: noMissions,
})

const migrateV23 = (save: PlayerSaveV23): PlayerSaveV24 => ({
  ...save,
  version: 24,
  proof: noProof,
})

const migrateV24 = (save: PlayerSaveV24): PlayerSaveV25 => ({
  ...save,
  version: 25,
  journal: noJournal,
})

const migrateV25 = (save: PlayerSaveV25): PlayerSaveV26 => ({
  ...save,
  version: 26,
})

const migrateV26 = (save: PlayerSaveV26): PlayerSaveV27 => ({
  ...save,
  version: 27,
  mastery: noMastery,
})

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
