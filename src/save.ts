import {
  Array,
  Data,
  Effect,
  Option,
  Record,
  Result,
  Schema,
  pipe,
} from 'effect'
import { modifyFields } from 'foldkit/struct'

import { callingForRun } from './calling'
import { playerOfCalling } from './callingPlayer'
import { lookInOwnedHat } from './closet'
import {
  AmmoTip,
  DebutCard,
  type DifficultyBests,
  DifficultyCard,
  type KillCounts,
  Lesson,
  type Lessons,
  type Model,
  PickupKind,
  type PlayerBests,
  Tour,
  TrapHint,
  ZombieKind,
  freshLessons,
  noPractice,
} from './model'
import {
  Calling,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  PlayerSave,
  PreHatAppearance,
  RotationSetting,
  SAVE_VERSION,
  SavedBests,
  SavedDifficulty,
  type SavedDifficultyBests,
  SavedHome,
  type SavedLesson,
  type SavedLessons,
  SavedOnboarding,
  SavedPowerUps,
  SavedRank,
  type SavedRunRecord,
  SavedRunRecords,
  SavedSettings,
  type SavedTrapHint,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
  StoredAppearance,
  noSavedRunRecords,
} from './playerData'
import { cleanName } from './profile'
import { noRank, rankOf, totalPointsOf } from './rank'

export {
  PlayerSave,
  SAVE_VERSION,
  SavedBests,
  SavedDifficulty,
  SavedHome,
  SavedLesson,
  SavedRunRecords,
  SavedTrapHint,
} from './playerData'

// SAVE

// NOTE: the PlayerSave is one record per player, plain data, shaped like the
// player scope in PLATFORM.md. It is stored as the player row in on-device
// SQLite (see src/store.ts). SAVE_KEY is the localStorage copy it used to
// live in: imported into SQLite once, then kept read-only as a fallback for
// one release. A new field goes in here with a version bump, and decodeSave
// migrates or drops the older version.
export const SAVE_KEY = 'munch-manor:save'

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
// version reads it through StoredAppearance (src/playerData.ts) as the
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
// kills the save holds (grantVeteranFrom in src/rankRun.ts), once.
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
const migrateV14 = (save: PlayerSaveV14): PlayerSave => ({
  ...save,
  version: SAVE_VERSION,
  appearance: { ...save.appearance, hat: 'None' },
  boughtHats: [],
})

const fromV13 = (save: PlayerSaveV13): PlayerSave =>
  migrateV14(migrateV13(save))

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
// number in SAVE_VERSION (src/playerData.ts). Renumbering versions after a
// merge happens here and there only. The sync scope's SeededPlayer carries
// the current PlayerSave, so a new version also bumps its mutation version
// in src/playerScope.ts.
const SAVE_VERSIONS: ReadonlyArray<
  Readonly<{
    version: number
    read: (raw: string) => Option.Option<PlayerSave>
  }>
> = [
  { version: SAVE_VERSION, read: Schema.decodeOption(PlayerSaveJson) },
  {
    version: 14,
    read: raw =>
      Option.map(Schema.decodeOption(PlayerSaveV14Json)(raw), migrateV14),
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

export const isSameSave = Schema.toEquivalence(PlayerSave)

// FROM THE MODEL

const savedLesson = (lesson: Lesson): SavedLesson =>
  Lesson.isAnyOf(['Learned'])(lesson) ? 'Learned' : 'Pending'

const savedTrapHint = (hint: TrapHint): SavedTrapHint =>
  TrapHint.isAnyOf(['Seen'])(hint) ? 'Seen' : 'Unseen'

const savedDifficultyBests = (
  bests: DifficultyBests,
): SavedDifficultyBests => ({
  fastestWinMs: Option.getOrNull(bests.maybeFastestWinMs),
  bestEndlessWave: Option.getOrNull(bests.maybeBestEndlessWave),
})

const savedRunRecord = (bests: DifficultyBests): SavedRunRecord => ({
  furthestWave: Option.getOrNull(bests.maybeFurthestWave),
  mostKills: Option.getOrNull(bests.maybeMostKills),
})

const savedRunRecords = (bests: PlayerBests): SavedRunRecords => ({
  Easy: savedRunRecord(bests.byDifficulty.Easy),
  Normal: savedRunRecord(bests.byDifficulty.Normal),
  Hard: savedRunRecord(bests.byDifficulty.Hard),
  Nightmare: savedRunRecord(bests.byDifficulty.Nightmare),
})

const savedBests = (bests: PlayerBests): SavedBests => ({
  runsPlayed: bests.runsPlayed,
  totalKills: bests.totalKills,
  killsByKind: Record.filter(bests.killsByKind, count => count > 0),
  byDifficulty: {
    Easy: savedDifficultyBests(bests.byDifficulty.Easy),
    Normal: savedDifficultyBests(bests.byDifficulty.Normal),
    Hard: savedDifficultyBests(bests.byDifficulty.Hard),
    Nightmare: savedDifficultyBests(bests.byDifficulty.Nightmare),
  },
})

// NOTE: every Model field saveOf reads. Most Messages, every frame among
// them, leave all of these as the same references, so the save needs no
// rebuilding or comparing. Keep this in step with saveOf.
export const SAVED_FIELDS = [
  'lessons',
  'trapHint',
  'ammoTip',
  'introducedKinds',
  'homeScreenTip',
  'soundSetting',
  'musicSetting',
  'shakeSetting',
  'shareStats',
  'cursorSetting',
  'appearance',
  'difficulty',
  'difficultyCard',
  'bests',
  'home',
  'seenPowerUps',
  'rotationSetting',
  'playerName',
  'rank',
  'calling',
  'boughtHats',
] as const satisfies ReadonlyArray<keyof Model>

export const hasSaveFieldsChanged = (before: Model, after: Model): boolean =>
  Array.some(SAVED_FIELDS, field => before[field] !== after[field])

export const saveOf = (model: Model): PlayerSave => ({
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: savedLesson(model.lessons.move),
      fire: savedLesson(model.lessons.fire),
      startWave: savedLesson(model.lessons.startWave),
      shop: savedLesson(model.lessons.shop),
      swap: savedLesson(model.lessons.swap),
      pickup: savedLesson(model.lessons.pickup),
      timedBreaks: savedLesson(model.lessons.timedBreaks),
      openBreak: savedLesson(model.lessons.openBreak),
    },
    trapHint: savedTrapHint(model.trapHint),
    ammoTip: AmmoTip.isAnyOf(['Unseen'])(model.ammoTip) ? 'Unseen' : 'Seen',
    introducedKinds: model.introducedKinds,
  },
  homeScreenTip: model.homeScreenTip,
  settings: {
    sound: model.soundSetting,
    music: model.musicSetting,
    shake: model.shakeSetting,
    shareStats: model.shareStats,
    cursor: model.cursorSetting,
  },
  appearance: model.appearance,
  difficulty: {
    chosen: model.difficulty.chosen,
    card: DifficultyCard.isAnyOf(['Seen'])(model.difficultyCard)
      ? 'Seen'
      : 'Unseen',
    nightmare: model.difficulty.nightmare === 'Locked' ? 'Locked' : 'Unlocked',
  },
  bests: savedBests(model.bests),
  home: {
    seenNewsDay: Option.getOrNull(model.home.maybeSeenNewsDay),
    openedEntries: model.home.openedEntries,
  },
  seenPowerUps: model.seenPowerUps,
  rotation: model.rotationSetting,
  name: model.playerName,
  records: savedRunRecords(model.bests),
  rank: model.rank,
  calling: model.calling,
  boughtHats: model.boughtHats,
})

// INTO THE MODEL

const restoreLesson =
  (saved: SavedLesson) =>
  (lesson: Lesson): Lesson =>
    saved === 'Learned' ? Lesson.Learned({ atMs: 0 }) : lesson

const restoreLessons = (lessons: Lessons, saved: SavedLessons): Lessons =>
  modifyFields(lessons, {
    move: restoreLesson(saved.move),
    fire: restoreLesson(saved.fire),
    startWave: restoreLesson(saved.startWave),
    shop: restoreLesson(saved.shop),
    swap: restoreLesson(saved.swap),
    pickup: restoreLesson(saved.pickup),
    timedBreaks: restoreLesson(saved.timedBreaks),
    openBreak: restoreLesson(saved.openBreak),
  })

const isZombieKind = Schema.is(ZombieKind)

// NOTE: kinds are kept as strings in the save, so a renamed or removed kind
// is dropped here instead of throwing the whole save away.
const knownKinds = (kinds: ReadonlyArray<string>): ReadonlyArray<ZombieKind> =>
  Array.filterMap(kinds, kind =>
    isZombieKind(kind) ? Result.succeed(kind) : Result.failVoid,
  )

const isPickupKind = Schema.is(PickupKind)

const knownPowerUps = (
  kinds: ReadonlyArray<string>,
): ReadonlyArray<PickupKind> =>
  Array.filterMap(kinds, kind =>
    isPickupKind(kind) ? Result.succeed(kind) : Result.failVoid,
  )

const restoreDifficultyBests = (
  saved: SavedDifficultyBests,
  record: SavedRunRecord,
): DifficultyBests => ({
  maybeFastestWinMs: Option.fromNullishOr(saved.fastestWinMs),
  maybeBestEndlessWave: Option.fromNullishOr(saved.bestEndlessWave),
  maybeFurthestWave: Option.fromNullishOr(record.furthestWave),
  maybeMostKills: Option.fromNullishOr(record.mostKills),
})

const savedKillsOf =
  (killsByKind: Readonly<Record<string, number>>) =>
  (kind: ZombieKind): number =>
    Option.getOrElse(Record.get(killsByKind, kind), () => 0)

// NOTE: only the known kinds are read back, the same way, so the count of a
// renamed or removed kind is dropped. The total stays as it was saved.
const restoreKills = (
  killsByKind: Readonly<Record<string, number>>,
): KillCounts => {
  const killsOf = savedKillsOf(killsByKind)
  return {
    Shambler: killsOf('Shambler'),
    Runner: killsOf('Runner'),
    Tank: killsOf('Tank'),
    Exploder: killsOf('Exploder'),
    Thrower: killsOf('Thrower'),
    Crawler: killsOf('Crawler'),
    Boss: killsOf('Boss'),
  }
}

const restoreBests = (
  saved: SavedBests,
  records: SavedRunRecords,
): PlayerBests => ({
  runsPlayed: saved.runsPlayed,
  totalKills: saved.totalKills,
  killsByKind: restoreKills(saved.killsByKind),
  byDifficulty: {
    Easy: restoreDifficultyBests(saved.byDifficulty.Easy, records.Easy),
    Normal: restoreDifficultyBests(saved.byDifficulty.Normal, records.Normal),
    Hard: restoreDifficultyBests(saved.byDifficulty.Hard, records.Hard),
    Nightmare: restoreDifficultyBests(
      saved.byDifficulty.Nightmare,
      records.Nightmare,
    ),
  },
})

export const restoreSave = (model: Model, save: PlayerSave): Model =>
  modifyFields(model, {
    lessons: lessons => restoreLessons(lessons, save.onboarding.lessons),
    trapHint: hint =>
      save.onboarding.trapHint === 'Seen' ? TrapHint.Seen() : hint,
    ammoTip: tip => (save.onboarding.ammoTip === 'Seen' ? AmmoTip.Seen() : tip),
    introducedKinds: kinds =>
      Array.union(kinds, knownKinds(save.onboarding.introducedKinds)),
    homeScreenTip: tip =>
      save.homeScreenTip === 'Dismissed' ? 'Dismissed' : tip,
    soundSetting: () => save.settings.sound,
    musicSetting: () => save.settings.music,
    shakeSetting: () => save.settings.shake,
    shareStats: () => save.settings.shareStats,
    cursorSetting: () => save.settings.cursor,
    // NOTE: a hat worn but not owned (a purchase another device's Bones
    // outran) comes off.
    appearance: () =>
      lookInOwnedHat(
        save.appearance,
        save.boughtHats,
        rankOf(totalPointsOf(save.rank)),
      ),
    difficulty: setting =>
      modifyFields(setting, {
        chosen: () => save.difficulty.chosen,
        nightmare: nightmare =>
          save.difficulty.nightmare === 'Unlocked' && nightmare === 'Locked'
            ? 'Unlocked'
            : nightmare,
      }),
    difficultyCard: card =>
      save.difficulty.card === 'Seen' ? DifficultyCard.Seen() : card,
    bests: () => restoreBests(save.bests, save.records),
    home: home =>
      modifyFields(home, {
        maybeSeenNewsDay: () => Option.fromNullishOr(save.home.seenNewsDay),
        openedEntries: opened =>
          Array.union(opened, knownKinds(save.home.openedEntries)),
      }),
    seenPowerUps: seen => Array.union(seen, knownPowerUps(save.seenPowerUps)),
    rotationSetting: () => save.rotation,
    playerName: () => cleanName(save.name),
    rank: () => save.rank,
    calling: () => save.calling,
    boughtHats: () => save.boughtHats,
    // NOTE: the player at home wears the calling the next run starts with.
    // A save that syncs in mid-run leaves the run's player alone.
    player: player =>
      model.phase._tag === 'Ready'
        ? playerOfCalling(
            callingForRun(save.calling, rankOf(totalPointsOf(save.rank))),
          )
        : player,
  })

// RESET

// NOTE: the reset forgets only the tutorial: the lessons, the zombie cards,
// and the power-ups explained. The look, the settings, the difficulty, and
// the bests and kills are kept.
export const forgetTutorial = (model: Model): Model =>
  modifyFields(model, {
    lessons: () => freshLessons,
    practice: () => noPractice,
    trapHint: () => TrapHint.Unseen(),
    ammoTip: () => AmmoTip.Unseen(),
    firstBreakQuest: () => Tour.Waiting(),
    kitchenTour: () => Tour.Waiting(),
    introducedKinds: () => [],
    debutCard: () => DebutCard.Hidden(),
    seenPowerUps: () => [],
  })

// LEGACY STORAGE

export class SaveStorageError extends Data.TaggedError('SaveStorageError')<{
  readonly reason: string
}> {}

const toStorageError = (error: unknown): SaveStorageError =>
  new SaveStorageError({ reason: String(error) })

// NOTE: the localStorage copy of the save, from before SQLite. Only
// src/store.ts calls these: once to import it, and as the fallback when
// SQLite cannot keep the save. A save that is absent, corrupted, or from
// another version reads as no save.
//
// NOTE: kept for one release only. SQLite on OPFS shipped to production on
// 2026-10-29, so any release from 2026-10-30 on may remove these two, the
// SAVE_KEY import, and the localStorage backend in src/store.ts. Without
// them a browser that opens SQLite in memory keeps the save for the tab
// only. PLATFORM.md ("The fallback, for one release") says the same.
export const readLegacySave: Effect.Effect<
  Option.Option<PlayerSave>,
  SaveStorageError
> = pipe(
  Effect.try({
    try: () => Option.fromNullishOr(localStorage.getItem(SAVE_KEY)),
    catch: toStorageError,
  }),
  Effect.map(Option.flatMap(decodeSave)),
)

export const writeLegacySave = (
  save: PlayerSave,
): Effect.Effect<void, SaveStorageError> =>
  pipe(
    encodeSave(save),
    Option.match({
      onNone: () => Effect.void,
      onSome: json =>
        Effect.try({
          try: () => localStorage.setItem(SAVE_KEY, json),
          catch: toStorageError,
        }),
    }),
  )
