import { Array, Effect, Function, type Option, Record, Schema } from 'effect'

import { SavedDareMarks } from './dareMarkData'
import { DayStamp } from './dayStamp'
import { SavedJournal } from './journalData'
import { SavedMastery } from './masteryData'
import { SavedMissions } from './missionData'
import { SavedProof } from './proofData'

// NOTE: the player's lasting data as Schemas, shared with the sync Worker in
// infra/worker, which bundles it against its own, newer Effect. It imports
// nothing but `effect` and its own folder and uses only Schema APIs both
// versions have, so the Worker never pulls in the game. src/app/model.ts and src/platform/save.ts re-export
// these.

// SETTINGS

export const SoundSetting = Schema.Literals(['On', 'Muted'])
export type SoundSetting = typeof SoundSetting.Type

export const MusicSetting = Schema.Literals(['On', 'Off'])
export type MusicSetting = typeof MusicSetting.Type

export const HomeScreenTip = Schema.Literals(['Unseen', 'Dismissed'])
export type HomeScreenTip = typeof HomeScreenTip.Type

export const ShakeSetting = Schema.Literals(['On', 'Off'])
export type ShakeSetting = typeof ShakeSetting.Type

// NOTE: the pointer over the game: the thin system crosshair, or a bold
// drawn one that stands out on the dark floor.
export const CursorSetting = Schema.Literals(['Thin', 'Bold'])
export type CursorSetting = typeof CursorSetting.Type

// NOTE: whether the game sends an anonymous run summary at the end of each
// run (src/platform/analytics.ts). On by default, kept in the player's save.
export const ShareStatsSetting = Schema.Literals(['On', 'Off'])
export type ShareStatsSetting = typeof ShareStatsSetting.Type

// NOTE: how an installed phone app turns. Landscape locks it sideways, the
// default for everyone; Auto lets it follow the phone into portrait.
export const RotationSetting = Schema.Literals(['Landscape', 'Auto'])
export type RotationSetting = typeof RotationSetting.Type

// NOTE: whether a controller rumbles on a bite, a boss slam, or a blast.
// On for everyone until turned off.
export const RumbleSetting = Schema.Literals(['On', 'Off'])
export type RumbleSetting = typeof RumbleSetting.Type

// NOTE: whether this player's runs are recorded and sent for the bot that
// learns to play like them (docs/BOT_PLAN.md, Track B). Off by default, and
// shown only once a device of the player's opened `?record=1`.
export const RecordRunsSetting = Schema.Literals(['On', 'Off'])
export type RecordRunsSetting = typeof RecordRunsSetting.Type

// NOTE: whether the RECORD MY RUNS tile shows: once any of the player's
// devices opens the game with `?record=1`, it shows on every one of them.
// It only ever unlocks.
export const RecordUnlock = Schema.Literals(['Locked', 'Unlocked'])
export type RecordUnlock = typeof RecordUnlock.Type

// NOTE: a calling (GAME_DESIGN.md, "Rank and Bones"): what a player brings
// to a run. YOU is the default and has no quirk; the others unlock by rank
// (src/world/heroes/calling.ts). It lives here, with the save's other Schemas, because
// the save keeps the one picked and the World keeps each player's.
export const Calling = Schema.Literals([
  'You',
  'Handyman',
  'TrackStar',
  'PennyPincher',
  'LineCook',
])
export type Calling = typeof Calling.Type

// NOTE: a calling as the co-op lobby carries it, as text: the calling it
// names, or nothing when it names none of ours.
export const callingOfCode = (code: string): Option.Option<Calling> =>
  Schema.decodeUnknownOption(Calling)(code)

export const Difficulty = Schema.Literals([
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
])
export type Difficulty = typeof Difficulty.Type

// LOOK

// NOTE: decided with the owner on 2026-10-30: a simple look built from
// parts, none tied to another. A body is a shape, never a sex, and every
// hair style, beard, glasses, outfit, and print works on every body. See
// "Character" in GAME_DESIGN.md. Each list only grows at its end: the look
// code (lookCodeOf) carries the newer parts by their place in it.

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

// NOTE: lightest to deepest, evenly spaced in lightness (see SKIN_SHADES in
// src/art/appearance.ts).
export const SkinTone = Schema.Literals([
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Brown',
  'Deep',
])
export type SkinTone = typeof SkinTone.Type

// NOTE: the six shirt colors every player has. The earned ones follow the
// hats' (see COSMETIC_GIFT_RANKS); each list only grows at its end, as the
// look code carries a print by its place.
export const FreeShirtColor = Schema.Literals([
  'Blue',
  'Red',
  'Yellow',
  'Teal',
  'Pink',
  'Purple',
])
export type FreeShirtColor = typeof FreeShirtColor.Type

// NOTE: Frost and Ember came with the rank gifts past rank 22 (save
// version 26), after the sold colors in `ShirtColor`, so no color moves.
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

// NOTE: gun skins: a palette swap of the guns the player holds. Stock is the
// guns as they always were.
// NOTE: the look code carries a gun skin by its place in `GunSkin`, so
// Frost and Ember, from the rank gifts past rank 22, go after the sold
// skins.
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

// NOTE: a hero's prop in a mastery style (docs/PROGRESSION_PLAN.md, pillar
// D): a palette swap of the prop a hero wears (its body prop and headgear),
// opened by that hero's mastery track (src/shared/masteryData.ts). Stock is
// the prop as it always was. A style is worn by whichever hero the player
// picks, once that hero's track has reached it; otherwise the prop shows
// stock. Only grows at its end: the look code carries it by its place.
export const PropStyle = Schema.Literals([
  'Stock',
  'Silver',
  'Night',
  'Ember',
  'Gold',
])
export type PropStyle = typeof PropStyle.Type

// NOTE: hats (GAME_DESIGN.md, "Rank and Bones"): the closet's stock. A gift
// hat is free once the player's rank reaches its rank; a sold hat costs
// Bones, once. Each list only grows at its end: the look code carries the
// hat by its place in `Hat`. The catalog lives here, with the Schemas, so
// the player scope can read a price when it applies a purchase.
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

// NOTE: the rank a gift hat is free at. They sit between the callings'
// ranks (3, 6, 10, and 15).
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

// NOTE: the closet's catalog of everything earned, by cosmetic id. A hat's id
// is its name, as bought rows have always held it; the others carry their
// kind (`shirt:Gold`, `print:Polka`, `skin:Gold`). An id with a rank is a
// gift; an id with a price is sold; an id with neither is free. The player
// scope reads the price of any kind from here when it applies a purchase.
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

// NOTE: a hero is bought with Bones and kept in the same list of ids as the
// looks (GAME_DESIGN.md, "Rank and Bones"): `hero:Handyman`. YOU is free
// and has no id. A hero opens for sale at its rank (UNLOCK_RANKS in
// src/world/heroes/calling.ts) and costs this once bought.
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

// NOTE: the earned looks' gift ranks continue after the hats', between the
// callings' (3, 6, 10, and 15), then every fifth rank to 40; every other
// rank from 21 on pays a Bones purse (src/shared/rankCurve.ts).
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

// NOTE: the look before hats (save versions 11 to 14, ChangedAppearance
// version 3, six word co-op codes with four letters). It reads as the same
// look bare headed.
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

// NOTE: the look with a hat and no gun skin (save version 15,
// ChangedAppearance version 4, seven word co-op codes). It reads as the
// same look with the stock guns.
export const PreSkinAppearance = Schema.Struct({
  ...PreHatAppearance.fields,
  hat: Hat,
})
export type PreSkinAppearance = typeof PreSkinAppearance.Type

// NOTE: plain data on purpose: the player scope stores it whole, through
// the ChangedAppearance mutation in src/platform/playerScope.ts. The prop
// style came with hero mastery (save version 27, ChangedAppearance version
// 6); a look stored before it reads as the stock prop, so no older shape is
// needed for it.
export const Appearance = Schema.Struct({
  ...PreSkinAppearance.fields,
  gunSkin: GunSkin,
  propStyle: PropStyle.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<PropStyle>('Stock')),
  ),
})
export type Appearance = typeof Appearance.Type

// SAVED

export const SAVE_VERSION = 28

export const SavedLesson = Schema.Literals(['Pending', 'Learned'])
export type SavedLesson = typeof SavedLesson.Type

// NOTE: a lesson added after a save was written reads as Pending when its
// key is missing, so an older save and an older device's synced onboarding
// still read: the dare tour and its key (docs/ESCAPE_PLAN.md, layer 16), and
// the display case's first-time card, the dare card read once, and the gun
// level hint.
// Versions up to 16 also held `shop`, the shop's lesson, gone with the shop
// and dropped on decoding.
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

// NOTE: save versions 11 to 16 also held ammoTip, Rattles' call about
// running low, gone with endless ammo in version 17. A key Schema does not
// name is dropped on decoding, so an older save and an older device's
// synced onboarding still read.
export const SavedOnboarding = Schema.Struct({
  lessons: SavedLessons,
  trapHint: SavedTrapHint,
  introducedKinds: Schema.Array(Schema.String),
  // NOTE: the intro watched whole, a key that reads as Unseen when missing,
  // so a save from before the intro still reads.
  intro: SavedTrapHint.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('Unseen')),
  ),
})
export type SavedOnboarding = typeof SavedOnboarding.Type

// NOTE: version 5 added shareStats, the "Share anonymous play stats" toggle,
// and version 7 added cursor, the "Big cursor" toggle.
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

// NOTE: version 2 added the difficulty: the chosen level, whether the
// first-time card was answered, and the Nightmare unlock.
export const SavedDifficulty = Schema.Struct({
  chosen: Difficulty,
  card: SavedCard,
  nightmare: SavedNightmare,
})
export type SavedDifficulty = typeof SavedDifficulty.Type

// NOTE: version 3 added the bests: runs played, zombies splatted in all and
// per kind, and the fastest win and best endless wave for each difficulty.
// Kills per kind are keyed by kind id, ready for the Munchopedia. A win or a
// wave not reached yet is null.
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

// NOTE: version 12 added a run's records for each difficulty: the furthest
// campaign wave reached and the most zombies splatted in one run, for the
// end card's NEW BEST. A record not set yet is null. Two devices merge them
// to the larger (src/platform/playerScope.ts).
// NOTE: version 21 added the best run, the one the end card's ghost shows:
// the most things on the dare's list found, then the furthest wave, with
// the things by kind id. A key that reads as null when missing, so an older
// save and an older device's synced records still read.
export const SavedBestRun = Schema.Struct({
  wave: Schema.Finite,
  things: Schema.Array(Schema.String),
})
export type SavedBestRun = typeof SavedBestRun.Type

// NOTE: a run better than another: more things found, then a further wave.
// A tie is not better, so the run kept stays. The bests and the player
// scope's merge both read it.
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

// NOTE: version 13 added rank (src/world/heroes/rank.ts): the points and Bones earned,
// which only ever add, so runs on two linked devices both count; the
// veteran grant for a player from before rank, whether it has been made and
// what it was, merged as the larger so it happens once; and the Bones
// spent, for the closet that is not built yet.
export const SavedRank = Schema.Struct({
  earnedPoints: Schema.Finite,
  earnedBones: Schema.Finite,
  veteranPoints: Schema.Finite,
  veteranBones: Schema.Finite,
  isVeteranGranted: Schema.Boolean,
  spentBones: Schema.Finite,
})
export type SavedRank = typeof SavedRank.Type

// NOTE: the Bones the first escape on each difficulty pays, once
// (docs/PROGRESSION_PLAN.md, pillar A). The player scope reads it here, never
// from a mutation's args.
export const FIRST_ESCAPE_BONES = 50

// NOTE: version 21 added the Bones bonuses a player can have only once:
// the day of the last run that paid double (the first run of each day), and
// the difficulties escaped on since the first escape bonus came in. The
// player scope merges them so two linked devices pay each one once
// (DoubledFirstRun and EscapedFirst in src/platform/playerScope.ts).
// Version 26 added the ranks whose Bones purse is paid
// (src/shared/rankCurve.ts, PaidRankPurse), a key that reads as none when
// missing, so an older save and an older device's synced bonuses still read.
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

// NOTE: version 22 added how the last run ended, which the friends in the
// car remember at the next intro (src/features/intro/carLine.ts): none yet,
// munched, munched early on, escaped, or left early by the kitchen's back
// door (docs/PROGRESSION_PLAN.md, pillar A), which was in the Schema from
// the start so no save version was needed when it shipped. The last device
// to end a run wins.
export const RunEnding = Schema.Literals([
  'NoRunYet',
  'Munched',
  'MunchedEarly',
  'Escaped',
  'LeftEarly',
])
export type RunEnding = typeof RunEnding.Type

// NOTE: version 15 added the closet: the sold hats the player has bought.
// Version 16 added the shirt colors, prints, and gun skins, so the list now
// holds cosmetic ids (COSMETIC_PRICES): the hats as before, the rest with
// their kind. Bones spent live in SavedRank. What is worn is on the look; a
// gift is owned by rank and never stored here. Kept as a set, merged as a
// union across linked devices.
export const SavedBoughtCosmetics = Schema.Array(Schema.String)
export type SavedBoughtCosmetics = typeof SavedBoughtCosmetics.Type

// NOTE: version 16 added the unlocks the player has seen, by id (`hat:Fez`,
// `shirt:Gold`, `skin:Slime`, `calling:Handyman`; src/domain/unlocks.ts). An unlock
// reached and not in here wears a NEW badge until the player opens the Look
// tab or the character picker. Kept as a set, merged as a union across
// linked devices, like the power-ups seen.
export const SavedSeenUnlocks = Schema.Array(Schema.String)
export type SavedSeenUnlocks = typeof SavedSeenUnlocks.Type

// NOTE: a player row from before NEW badges holds only this mark. It stands
// for every unlock reached the first time the row is loaded, so a player who
// had earned a dozen gifts before NEW badges shipped does not meet a wall of
// them. The first load writes those ids in its place (SawUnlocks in
// src/platform/playerScope.ts drops the mark).
export const SEEN_BASELINE = '*'

// NOTE: version 4 added the home menu: the newest What's New day seen, by
// its date, and the Munchopedia entries opened, by kind id.
export const SavedHome = Schema.Struct({
  seenNewsDay: Schema.NullOr(Schema.String),
  openedEntries: Schema.Array(Schema.String),
  // NOTE: the turn hint on the portrait home menu was dismissed or the phone
  // turned. Optional, so every older save and row reads it as not yet seen.
  turnHintSeen: Schema.optionalKey(Schema.Boolean),
})
export type SavedHome = typeof SavedHome.Type

// NOTE: version 6 added the power-up kinds the player has grabbed, by kind
// id. The first grab of a kind explains it, and later grabs only name it.
// Kept apart from the onboarding, since linked devices merge it as a union.
export const SavedPowerUps = Schema.Array(Schema.String)
export type SavedPowerUps = typeof SavedPowerUps.Type

// NOTE: a display name: up to 12 characters, not unique, shown in co-op
// lobbies and above teammates. Kept cleaned (see cleanName in
// src/features/profile/profile.ts); empty means the player has not picked one.
export const PlayerName = Schema.String.check(Schema.isMaxLength(64))
export type PlayerName = typeof PlayerName.Type

// NOTE: version 8 added the rotation, kept apart from the other settings so
// it syncs as its own last-write-wins change. Version 9 added the display
// name, synced the same way. Version 10 is the many-part look, and version
// 11 the simpler look the owner chose (LOOK above). Version 14 added the
// calling picked for the next run, synced the same way. Version 15 added
// the hat on the look and the hats bought. Version 16 added the gun skin on
// the look and renamed the hats bought to the cosmetics bought. Version 17
// dropped the ammo tip from the onboarding. Version 18 added the rumble,
// synced as its own last-write-wins change like the rotation. Version 19
// added RECORD MY RUNS, synced the same way. Version 20 added the RECORD MY
// RUNS unlock, which used to stay on the device that opened `?record=1`.
// Version 21 added the Bones bonuses and each difficulty's best run.
// Version 22 added how the last run ended, for the friends in the car.
// Version 23 added the daily missions (src/shared/missionData.ts).
// Version 24 added the Proof Shelf (src/shared/proofData.ts).
// Version 25 added the Dare Journal (src/shared/journalData.ts).
// Version 26 added the rank purses paid, in `bonuses`.
// Version 27 added hero and gun mastery (src/shared/masteryData.ts), and
// the prop style on the look.
// Version 28 added the dare ladder's best mark on each difficulty
// (src/shared/dareMarkData.ts).
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
