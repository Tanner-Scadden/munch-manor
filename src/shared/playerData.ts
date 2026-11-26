import { Array, Effect, Function, type Option, Record, Schema } from 'effect'

import { SavedDareMarks } from './dareMarkData'
import { DayStamp } from './dayStamp'
import { SavedJournal } from './journalData'
import { SavedMastery } from './masteryData'
import { SavedMissions } from './missionData'
import { SavedProof } from './proofData'

export const SoundSetting = Schema.Literals(['On', 'Muted'])
export type SoundSetting = typeof SoundSetting.Type

export const MusicSetting = Schema.Literals(['On', 'Off'])
export type MusicSetting = typeof MusicSetting.Type

export const HomeScreenTip = Schema.Literals(['Unseen', 'Dismissed'])
export type HomeScreenTip = typeof HomeScreenTip.Type

export const ShakeSetting = Schema.Literals(['On', 'Off'])
export type ShakeSetting = typeof ShakeSetting.Type

export const CursorSetting = Schema.Literals(['Thin', 'Bold'])
export type CursorSetting = typeof CursorSetting.Type

export const ShareStatsSetting = Schema.Literals(['On', 'Off'])
export type ShareStatsSetting = typeof ShareStatsSetting.Type

export const RotationSetting = Schema.Literals(['Landscape', 'Auto'])
export type RotationSetting = typeof RotationSetting.Type

export const RumbleSetting = Schema.Literals(['On', 'Off'])
export type RumbleSetting = typeof RumbleSetting.Type

export const RecordRunsSetting = Schema.Literals(['On', 'Off'])
export type RecordRunsSetting = typeof RecordRunsSetting.Type

export const RecordUnlock = Schema.Literals(['Locked', 'Unlocked'])
export type RecordUnlock = typeof RecordUnlock.Type

export const Calling = Schema.Literals([
  'You',
  'Handyman',
  'TrackStar',
  'PennyPincher',
  'LineCook',
])
export type Calling = typeof Calling.Type

export const callingOfCode = (code: string): Option.Option<Calling> =>
  Schema.decodeUnknownOption(Calling)(code)

export const Difficulty = Schema.Literals([
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
])
export type Difficulty = typeof Difficulty.Type

export const Body = Schema.Literals(['Slim', 'Broad'])
export type Body = typeof Body.Type

export const HairStyle = Schema.Literals([
  'Short',
  'Long',
  'Ponytail',
  'Curly',
  'Mohawk',
  'Bald',
])
export type HairStyle = typeof HairStyle.Type

export const HairColor = Schema.Literals([
  'Black',
  'Brown',
  'Blonde',
  'Red',
  'Grey',
  'Pink',
])
export type HairColor = typeof HairColor.Type

export const SkinTone = Schema.Literals([
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Brown',
  'Deep',
])
export type SkinTone = typeof SkinTone.Type

export const FreeShirtColor = Schema.Literals([
  'Blue',
  'Red',
  'Yellow',
  'Teal',
  'Pink',
  'Purple',
])
export type FreeShirtColor = typeof FreeShirtColor.Type

const EarlyGiftShirtColor = Schema.Literals(['Gold', 'Glow'])
const LateGiftShirtColor = Schema.Literals(['Frost', 'Ember'])

export const GiftShirtColor = Schema.Literals([
  ...EarlyGiftShirtColor.literals,
  ...LateGiftShirtColor.literals,
])
export type GiftShirtColor = typeof GiftShirtColor.Type

const SoldShirtColor = Schema.Literals(['Midnight', 'Coral'])
type SoldShirtColor = typeof SoldShirtColor.Type

export const ShirtColor = Schema.Literals([
  ...FreeShirtColor.literals,
  ...EarlyGiftShirtColor.literals,
  ...SoldShirtColor.literals,
  ...LateGiftShirtColor.literals,
])
export type ShirtColor = typeof ShirtColor.Type

export const Outfit = Schema.Literals(['Tee', 'Hoodie', 'Dress', 'Overalls'])
export type Outfit = typeof Outfit.Type

export const FreePrint = Schema.Literals(['Plain', 'Stripes', 'Rainbow'])
export type FreePrint = typeof FreePrint.Type

export const GiftPrint = Schema.Literals(['Polka', 'Checker'])
export type GiftPrint = typeof GiftPrint.Type

const SoldPrint = Schema.Literals(['Skull', 'Flames'])
type SoldPrint = typeof SoldPrint.Type

export const Print = Schema.Literals([
  ...FreePrint.literals,
  ...GiftPrint.literals,
  ...SoldPrint.literals,
])
export type Print = typeof Print.Type

const EarlyGiftGunSkin = Schema.Literals(['Gold', 'Slime'])
const LateGiftGunSkin = Schema.Literals(['Frost', 'Ember'])

export const GiftGunSkin = Schema.Literals([
  ...EarlyGiftGunSkin.literals,
  ...LateGiftGunSkin.literals,
])
export type GiftGunSkin = typeof GiftGunSkin.Type

const SoldGunSkin = Schema.Literals(['Candy', 'Bone', 'Neon'])
type SoldGunSkin = typeof SoldGunSkin.Type

export const GunSkin = Schema.Literals([
  'Stock',
  ...EarlyGiftGunSkin.literals,
  ...SoldGunSkin.literals,
  ...LateGiftGunSkin.literals,
])
export type GunSkin = typeof GunSkin.Type

export const PropStyle = Schema.Literals([
  'Stock',
  'Silver',
  'Night',
  'Ember',
  'Gold',
])
export type PropStyle = typeof PropStyle.Type

export const GiftHat = Schema.Literals([
  'PartyHat',
  'BucketHat',
  'PomBeanie',
  'PropellerCap',
  'CowboyHat',
  'HornedHelmet',
  'TopHat',
  'PirateHat',
  'WitchHat',
  'TrafficCone',
])
export type GiftHat = typeof GiftHat.Type

export const SoldHat = Schema.Literals([
  'Colander',
  'Fez',
  'BunnyEars',
  'Plunger',
  'Lampshade',
  'PumpkinHead',
])
export type SoldHat = typeof SoldHat.Type

export const Hat = Schema.Literals([
  'None',
  ...GiftHat.literals,
  ...SoldHat.literals,
])
export type Hat = typeof Hat.Type

const HAT_GIFT_RANKS: Readonly<Record<GiftHat, number>> = {
  PartyHat: 2,
  BucketHat: 4,
  PomBeanie: 5,
  PropellerCap: 7,
  CowboyHat: 8,
  HornedHelmet: 9,
  TopHat: 11,
  PirateHat: 12,
  WitchHat: 13,
  TrafficCone: 14,
}

const HAT_PRICES: Readonly<Record<SoldHat, number>> = {
  Colander: 40,
  Fez: 50,
  BunnyEars: 50,
  Plunger: 60,
  Lampshade: 70,
  PumpkinHead: 80,
}

export const CosmeticKind = Schema.Literals(['Hat', 'Shirt', 'Print', 'Skin'])
export type CosmeticKind = typeof CosmeticKind.Type

const KIND_PREFIXES: Readonly<Record<CosmeticKind, string>> = {
  Hat: '',
  Shirt: 'shirt:',
  Print: 'print:',
  Skin: 'skin:',
}

export const cosmeticIdOf: {
  (name: string): (kind: CosmeticKind) => string
  (kind: CosmeticKind, name: string): string
} = Function.dual(
  2,
  (kind: CosmeticKind, name: string): string => `${KIND_PREFIXES[kind]}${name}`,
)

const idsOf = (
  kind: CosmeticKind,
  names: ReadonlyArray<string>,
  value: number,
): Readonly<Record<string, number>> =>
  Record.fromEntries(
    Array.map(names, name => [cosmeticIdOf(kind, name), value]),
  )

const SHIRT_PRICE = 20
const PRINT_PRICE = 20
const SKIN_PRICE = 60

export const heroIdOf = (calling: string): string => `hero:${calling}`

const HERO_PRICES: Readonly<Record<string, number>> = {
  [heroIdOf('Handyman')]: 60,
  [heroIdOf('TrackStar')]: 100,
  [heroIdOf('PennyPincher')]: 150,
  [heroIdOf('LineCook')]: 200,
}

export const COSMETIC_PRICES: Readonly<Record<string, number>> = {
  ...HAT_PRICES,
  ...HERO_PRICES,
  ...idsOf('Shirt', SoldShirtColor.literals, SHIRT_PRICE),
  ...idsOf('Print', SoldPrint.literals, PRINT_PRICE),
  ...idsOf('Skin', SoldGunSkin.literals, SKIN_PRICE),
}

export const COSMETIC_GIFT_RANKS: Readonly<Record<string, number>> = {
  ...HAT_GIFT_RANKS,
  'shirt:Gold': 16,
  'print:Polka': 17,
  'skin:Gold': 18,
  'shirt:Glow': 19,
  'print:Checker': 20,
  'skin:Slime': 22,
  'shirt:Frost': 25,
  'skin:Frost': 30,
  'shirt:Ember': 35,
  'skin:Ember': 40,
}

export const PreHatAppearance = Schema.Struct({
  body: Body,
  hairStyle: HairStyle,
  hairColor: HairColor,
  skinTone: SkinTone,
  shirtColor: ShirtColor,
  outfit: Outfit,
  print: Print,
  beard: Schema.Boolean,
  glasses: Schema.Boolean,
})
export type PreHatAppearance = typeof PreHatAppearance.Type

export const PreSkinAppearance = Schema.Struct({
  ...PreHatAppearance.fields,
  hat: Hat,
})
export type PreSkinAppearance = typeof PreSkinAppearance.Type

export const Appearance = Schema.Struct({
  ...PreSkinAppearance.fields,
  gunSkin: GunSkin,
  propStyle: PropStyle.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<PropStyle>('Stock')),
  ),
})
export type Appearance = typeof Appearance.Type

export const SAVE_VERSION = 28

export const SavedLesson = Schema.Literals(['Pending', 'Learned'])
export type SavedLesson = typeof SavedLesson.Type

const LaterLesson = SavedLesson.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed('Pending')),
)

export const SavedLessons = Schema.Struct({
  move: SavedLesson,
  fire: SavedLesson,
  startWave: SavedLesson,
  swap: SavedLesson,
  pickup: SavedLesson,
  timedBreaks: SavedLesson,
  openBreak: SavedLesson,
  dareTour: LaterLesson,
  dareKey: LaterLesson,
  rattles: LaterLesson,
  displayCase: LaterLesson,
  dareCard: LaterLesson,
  gunLevel: LaterLesson,
})
export type SavedLessons = typeof SavedLessons.Type

export const SavedTrapHint = Schema.Literals(['Unseen', 'Seen'])
export type SavedTrapHint = typeof SavedTrapHint.Type

export const SavedOnboarding = Schema.Struct({
  lessons: SavedLessons,
  trapHint: SavedTrapHint,
  introducedKinds: Schema.Array(Schema.String),
  intro: SavedTrapHint.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('Unseen')),
  ),
})
export type SavedOnboarding = typeof SavedOnboarding.Type

export const SavedSettings = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  shareStats: ShareStatsSetting,
  cursor: CursorSetting,
})
export type SavedSettings = typeof SavedSettings.Type

export const SavedCard = Schema.Literals(['Unseen', 'Seen'])
export type SavedCard = typeof SavedCard.Type

export const SavedNightmare = Schema.Literals(['Locked', 'Unlocked'])
export type SavedNightmare = typeof SavedNightmare.Type

export const SavedDifficulty = Schema.Struct({
  chosen: Difficulty,
  card: SavedCard,
  nightmare: SavedNightmare,
})
export type SavedDifficulty = typeof SavedDifficulty.Type

export const SavedDifficultyBests = Schema.Struct({
  fastestWinMs: Schema.NullOr(Schema.Finite),
  bestEndlessWave: Schema.NullOr(Schema.Finite),
})
export type SavedDifficultyBests = typeof SavedDifficultyBests.Type

export const SavedBestsByDifficulty = Schema.Struct({
  Easy: SavedDifficultyBests,
  Normal: SavedDifficultyBests,
  Hard: SavedDifficultyBests,
  Nightmare: SavedDifficultyBests,
})
export type SavedBestsByDifficulty = typeof SavedBestsByDifficulty.Type

export const SavedBests = Schema.Struct({
  runsPlayed: Schema.Finite,
  totalKills: Schema.Finite,
  killsByKind: Schema.Record(Schema.String, Schema.Finite),
  byDifficulty: SavedBestsByDifficulty,
})
export type SavedBests = typeof SavedBests.Type

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

export const SavedBestRun = Schema.Struct({
  wave: Schema.Finite,
  things: Schema.Array(Schema.String),
})
export type SavedBestRun = typeof SavedBestRun.Type

export const isBetterRun: {
  (than: BestRunShape): (run: BestRunShape) => boolean
  (run: BestRunShape, than: BestRunShape): boolean
} = Function.dual(
  2,
  (run: BestRunShape, than: BestRunShape): boolean =>
    run.things.length > than.things.length ||
    (run.things.length === than.things.length && run.wave > than.wave),
)

type BestRunShape = Readonly<{ wave: number; things: ReadonlyArray<string> }>

export const SavedRunRecord = Schema.Struct({
  furthestWave: Schema.NullOr(Schema.Finite),
  mostKills: Schema.NullOr(Schema.Finite),
  bestRun: Schema.NullOr(SavedBestRun).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
})
export type SavedRunRecord = typeof SavedRunRecord.Type

export const SavedRunRecords = Schema.Struct({
  Easy: SavedRunRecord,
  Normal: SavedRunRecord,
  Hard: SavedRunRecord,
  Nightmare: SavedRunRecord,
})
export type SavedRunRecords = typeof SavedRunRecords.Type

const noSavedRunRecord: SavedRunRecord = {
  furthestWave: null,
  mostKills: null,
  bestRun: null,
}

export const noSavedRunRecords: SavedRunRecords = {
  Easy: noSavedRunRecord,
  Normal: noSavedRunRecord,
  Hard: noSavedRunRecord,
  Nightmare: noSavedRunRecord,
}

export const SavedRank = Schema.Struct({
  earnedPoints: Schema.Finite,
  earnedBones: Schema.Finite,
  veteranPoints: Schema.Finite,
  veteranBones: Schema.Finite,
  isVeteranGranted: Schema.Boolean,
  spentBones: Schema.Finite,
})
export type SavedRank = typeof SavedRank.Type

export const FIRST_ESCAPE_BONES = 50

export const SavedBonuses = Schema.Struct({
  doubledDay: Schema.NullOr(DayStamp),
  escapedOn: Schema.Array(Difficulty),
  purses: Schema.Array(Schema.Finite).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
})
export type SavedBonuses = typeof SavedBonuses.Type

export const noBonuses: SavedBonuses = {
  doubledDay: null,
  escapedOn: [],
  purses: [],
}

export const RunEnding = Schema.Literals([
  'NoRunYet',
  'Munched',
  'MunchedEarly',
  'Escaped',
  'LeftEarly',
])
export type RunEnding = typeof RunEnding.Type

export const SavedBoughtCosmetics = Schema.Array(Schema.String)
export type SavedBoughtCosmetics = typeof SavedBoughtCosmetics.Type

export const SavedSeenUnlocks = Schema.Array(Schema.String)
export type SavedSeenUnlocks = typeof SavedSeenUnlocks.Type

export const SEEN_BASELINE = '*'

export const SavedHome = Schema.Struct({
  seenNewsDay: Schema.NullOr(Schema.String),
  openedEntries: Schema.Array(Schema.String),
  turnHintSeen: Schema.optionalKey(Schema.Boolean),
})
export type SavedHome = typeof SavedHome.Type

export const SavedPowerUps = Schema.Array(Schema.String)
export type SavedPowerUps = typeof SavedPowerUps.Type

export const PlayerName = Schema.String.check(Schema.isMaxLength(64))
export type PlayerName = typeof PlayerName.Type

export const PlayerSave = Schema.Struct({
  version: Schema.Literal(SAVE_VERSION),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  rumble: RumbleSetting,
  name: PlayerName,
  records: SavedRunRecords,
  rank: SavedRank,
  calling: Calling,
  boughtCosmetics: SavedBoughtCosmetics,
  seenUnlocks: SavedSeenUnlocks,
  recordRuns: RecordRunsSetting,
  recordUnlock: RecordUnlock,
  bonuses: SavedBonuses,
  lastRun: RunEnding,
  missions: SavedMissions,
  proof: SavedProof,
  journal: SavedJournal,
  mastery: SavedMastery,
  dareMarks: SavedDareMarks,
})
export type PlayerSave = typeof PlayerSave.Type
