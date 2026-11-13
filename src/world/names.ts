import { Array, Function, Option } from 'effect'

import type { PickedMode } from '@munch/netcode'

import { CHANDELIER_CRUSH_GOAL, type MissionId } from '../shared/missionData'
import type {
  HouseSpot,
  MapId,
  ShopGuideSection,
  TutorialChoice,
} from '../shared/nameKeys'
import {
  type Calling,
  type CosmeticKind,
  FIRST_ESCAPE_BONES,
  Hat,
  type RunEnding,
} from '../shared/playerData'
import type { ProofEnding } from '../shared/proofData'
import type { DareKind } from './dare/dareSchema'
import type { MilestoneId } from './dare/milestones'
import type { BoneBonus } from './heroes/rank'
import type { Modifier } from './run/modifiers'
import type {
  FridgePrize,
  GunPerk,
  PickupKind,
  TrapKind,
  WeaponKind,
  ZombieKind,
} from './schema/worldSchema'

// NOTE: every name a player reads for a gun, a zombie, a trap, a power-up, or
// a shop good lives here, keyed by its id. The tables and views read their
// names from this module, so a rename or a rebrand is an edit here and never
// touches an id, a save, or a sync row.

// GUNS

export const GUN_NAMES: Readonly<Record<WeaponKind, string>> = {
  Pistol: 'Pop Pistol',
  Shotgun: 'Barn Buster',
  Smg: 'Chatterbox',
  Peashooter: 'Pea Shooter',
  Cooker: 'Pressure Cooker',
  Pan: 'Clang Pan',
  Freeze: 'Brain Freeze',
  Rifle: 'Old Thunder',
  Blunderbuss: 'Big Blunder',
}

// NOTE: every gun's upgrade tiers share one ladder of tier words around its
// base name, so an upgraded gun still reads as the same gun (decided with the
// owner on 2026-10-30, see "Names" in GAME_DESIGN.md). Tier 0 is the base
// name. A new tier is a new word here, never a new name for one gun.
// The words alone, by tier from 1, are what a level up pops over the
// player (src/render/powerupView.ts).
const BEEFY = 'Beefy'
const DELUXE = 'DELUXE'
const THREE_THOUSAND = '3000'

const TIER_WORDS: ReadonlyArray<string> = [BEEFY, DELUXE, THREE_THOUSAND]

export const TIER_LADDER: Array.NonEmptyReadonlyArray<
  (base: string) => string
> = [
  base => base,
  base => `${BEEFY} ${base}`,
  base => `${base} ${DELUXE}`,
  base => `${base} ${THREE_THOUSAND}`,
]

// NOTE: the tier word a gun reaches at `tier`, from 1; none at its base.
export const maybeTierWord = (tier: number): Option.Option<string> =>
  Array.get(TIER_WORDS, tier - 1)

export const gunTierName: {
  (tier: number): (kind: WeaponKind) => string
  (kind: WeaponKind, tier: number): string
} = Function.dual(2, (kind: WeaponKind, tier: number): string =>
  Option.match(Array.get(TIER_LADDER, tier), {
    onNone: () => GUN_NAMES[kind],
    onSome: name => name(GUN_NAMES[kind]),
  }),
)

// NOTE: the knife every player carries (src/world/gear/knife.ts). It has no tiers and
// is never sold, so it has one name and nothing else.
export const KNIFE_NAME = 'Knife'

// NOTE: the home menu's co-op button.
export const MULTIPLAYER_NAME = 'MULTIPLAYER'

// NOTE: the first-run difficulty card's tutorial pick.
export const TUTORIAL_CHOICE_NAMES: Readonly<Record<TutorialChoice, string>> = {
  Tutorial: 'TUTORIAL',
  Skip: 'SKIP IT',
}

// ZOMBIES

export const ZOMBIE_NAMES: Readonly<Record<ZombieKind, string>> = {
  Shambler: 'Groaner',
  Runner: 'Hotfoot',
  Tank: 'Big Lug',
  Exploder: 'Kaboomer',
  Thrower: 'Big Leaguer',
  Crawler: 'Ankle Biter',
  Boss: 'Uncle Chunk',
}

// NOTE: the end card's tags for the Bones a run's bonuses added
// (src/world/heroes/rank.ts): the floor, the day's first run doubled, and
// the first escape on a difficulty.
export const BONE_BONUS_TAGS: Readonly<Record<BoneBonus, string>> = {
  Floor: 'MIN',
  Double: 'X2',
  FirstEscape: `+${FIRST_ESCAPE_BONES}`,
}

// NOTE: your friends in the car at the intro (src/features/intro/carLine.ts),
// by how your last run ended, a few to each so one never comes twice in a
// row. A few words each, all caps for the pixel font, short enough for the
// bubble to fit the picture.
export const FRIEND_LINES: Readonly<
  Record<RunEnding, Array.NonEmptyReadonlyArray<string>>
> = {
  NoRunYet: [
    'GO ON. WE DARE YA!',
    "WE'LL WAIT RIGHT HERE",
    'BRING US A SOUVENIR!',
    'NO CHICKENS IN THIS CAR',
  ],
  Munched: [
    'BACK FOR SECONDS?',
    'YOU STILL SMELL LIKE SOUP',
    'AGAIN?! OKAY...',
    'ROUND TWO, CHAMP?',
    'WE KEPT YOUR SEAT WARM',
  ],
  MunchedEarly: [
    'BRAVE OR DUMB?',
    'THAT WAS QUICK!',
    'DID YOU EVEN GO IN?',
    'WE TIMED IT. NOT GREAT.',
  ],
  Escaped: [
    'YOU ACTUALLY DID IT!',
    'SHOW-OFF!',
    'OKAY, BUT DO IT AGAIN',
    'WE OWE YOU A SODA',
  ],
  LeftEarly: ['CHICKEN!', 'BAWK BAWK!', 'SCARED, HUH?', 'WE SAW YOU RUN!'],
}

// NOTE: Rattles' tip on the end card about the zombie that landed the last
// bite (src/features/end/deathTip.ts), a few to each so one never comes
// twice in a row. Short, goofy, and true.
export const DEATH_TIPS: Readonly<
  Record<ZombieKind, Array.NonEmptyReadonlyArray<string>>
> = {
  Shambler: [
    'GROANERS ARE SLOW. BACK UP!',
    "DON'T LET 'EM CROWD YOU",
    'KEEP MOVING, KEEP SHOOTING',
  ],
  Runner: [
    'HOTFOOTS HATE PLANKS',
    'SHOOT THE FAST ONE FIRST',
    'HOTFOOTS RUN. YOU AIM.',
  ],
  Tank: [
    "DON'T HUG THE BIG LUG",
    'BIG LUGS PLOD. KITE EM!',
    'SAVE THE BIG GUN FOR LUGS',
  ],
  Exploder: [
    'POP KABOOMERS FROM AFAR',
    'KABOOMERS GO BOOM. BACK UP!',
    'NEVER HUG A KABOOMER',
  ],
  Thrower: [
    'BIG LEAGUERS THROW. DODGE!',
    'DUCK BEHIND THE FURNITURE',
    'KEEP MOVING. THEY AIM SLOW.',
  ],
  Crawler: [
    'WATCH YOUR ANKLES!',
    'ANKLE BITERS POP UP. LOOK DOWN!',
    'SHAKE EM OFF. KEEP MOVING!',
  ],
  Boss: [
    'CHUNK WINDS UP. THEN DODGE!',
    'MIND THE BELLY SLAM',
    'STAY OFF HIS STOMP',
  ],
}

// TRAPS

export const TRAP_NAMES: Readonly<Record<TrapKind, string>> = {
  Barricade: 'Plank Pile',
  Turret: 'Grumpy Gnome',
}

// POWER-UPS

export const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = {
  RapidFire: 'WIND-UP KEY',
  Damage: 'FAMILY SILVER',
  Speed: 'DANCING SHOES',
  Pierce: 'HAT PINS',
  Burp: 'DINNER GONG',
  Heart: 'PICKLED HEART',
}

// RUN MODES

// NOTE: the run the home menu and a co-op lobby pick: the campaign, endless,
// or keeping a won campaign going into endless.
export const MODE_NAMES: Readonly<Record<PickedMode, string>> = {
  Campaign: 'Campaign',
  Endless: 'Endless',
  KeepGoing: 'Keep going',
}

// MAPS

// NOTE: the maps the single player lobby offers (src/features/lobby/lobby.ts).
export const MAP_NAMES: Readonly<Record<MapId, string>> = {
  Manor: 'The Manor',
}

// RUN MODIFIERS

// NOTE: the opt-in rules a run can take for a bonus (src/world/run/modifiers.ts).
export const MODIFIER_NAMES: Readonly<Record<Modifier, string>> = {
  FriendlyFire: 'Friendly Fire',
  BigCrowd: 'Big Crowd',
  Broke: 'Broke',
  Glass: 'Glass',
}

// THE FRIDGE

// NOTE: Mystery Leftovers (src/world/fridge/leftovers.ts).
export const FRIDGE_NAME = 'Mystery Leftovers'

// NOTE: the one word that lands with each prize when the fridge's spin
// stops (src/features/fridge/fridgeReveal.ts).
export const PRIZE_PUNCH_LINES: Readonly<Record<FridgePrize, string>> = {
  Cooker: 'BOOM',
  Pan: 'BONK',
  Freeze: 'BRRR',
  Sandwich: 'CHOMP',
  Dud: 'BLEH',
}

// NOTE: what each fridge prize is called in the shop guide. The weapons keep
// their gun names; the gags are the moldy sandwich and the fish skeleton.
export const PRIZE_NAMES: Readonly<Record<FridgePrize, string>> = {
  Cooker: GUN_NAMES.Cooker,
  Pan: GUN_NAMES.Pan,
  Freeze: GUN_NAMES.Freeze,
  Sandwich: 'Moldy Sandwich',
  Dud: 'Dud',
}

// THE STOVE AND THE GAS VALVE

// NOTE: the kitchen's stove bench (src/world/kitchen/stove.ts) and the perks it cooks
// into a gun, and the gas valve that lights the fireplace (src/world/kitchen/gasValve.ts).
// NOTE: what the house holds for traps (src/world/gear/crates.ts), and
// mending one for free in a break (src/world/gear/traps.ts).
export const FOUND_NAMES = {
  Crate: 'Trap Crate',
  Mend: 'Mending',
} as const

export const STOVE_NAME = 'The Stove'

export const VALVE_NAME = 'Gas Valve'

// NOTE: the kitchen's way out early (src/world/kitchen/backDoor.ts), and the
// stamp on the end card of a run left by it.
export const BACK_DOOR_NAME = 'Back Door'

export const CHICKEN_WORD = 'CHICKEN!'

export const CHICKEN_QUIP = 'Bawk. The front door was right there'

export const GUN_PERK_NAMES: Readonly<Record<GunPerk, string>> = {
  Spicy: 'Spicy',
  Crispy: 'Crispy',
  Hearty: 'Hearty',
}

// THE LASER SIGHT

// NOTE: a display case prize (src/world/feats/cases.ts) kept for the run.
export const LASER_SIGHT_NAME = 'Laser Sight'

// NOTE: what the display cases are called, on the card a case raises the
// first time a player walks up to one (src/features/onboarding/caseCard.ts).
export const DISPLAY_CASE_NAME = 'Display Case'

// THE CREW BOARD

// NOTE: the awards a co-op end card hands out (src/features/end/crewAwards.ts), each a
// title under the winner's column. The ids live here, apart from the
// client module that hands them out, since the room's modules read names.
export type CrewAward =
  | 'Mvp'
  | 'Medic'
  | 'Sharpshooter'
  | 'KeyKeeper'
  | 'MostMunched'

export const CREW_AWARD_NAMES: Readonly<Record<CrewAward, string>> = {
  Mvp: 'MVP',
  Medic: 'Medic',
  Sharpshooter: 'Sharpshooter',
  KeyKeeper: 'Key Keeper',
  MostMunched: 'Most Munched',
}

// CALLINGS

// NOTE: what a player brings to a run (src/world/heroes/calling.ts). Players read
// "hero": the code keeps `calling`, as the Look tab is `Character`.
export const CALLING_NAMES: Readonly<Record<Calling, string>> = {
  You: 'YOU',
  Handyman: 'Handyman',
  TrackStar: 'Track Star',
  PennyPincher: 'Penny Pincher',
  LineCook: 'Line Cook',
}

// NOTE: teammate bots (src/domain/bots.ts) take a goofy name from here, letters
// and spaces only so the name tag's small font can draw it.
export const BOT_NAMES: Array.NonEmptyReadonlyArray<string> = [
  'Bolts',
  'Rusty',
  'Beepo',
  'Clank',
  'Gizmo',
  'Sprocket',
  'Widget',
  'Zappy',
  'Tin Tim',
  'Mr Gears',
  'Wobbles',
  'Dingus',
  'Nuts',
  'Static',
  'Fuzz Bot',
  'Pixel',
]

// NOTE: the closet's hats (src/domain/closet.ts), read on focus and aloud.
export const HAT_NAMES: Readonly<Record<Hat, string>> = {
  None: 'No hat',
  PartyHat: 'Party Hat',
  BucketHat: 'Bucket Hat',
  PomBeanie: 'Pom Beanie',
  PropellerCap: 'Propeller Cap',
  CowboyHat: 'Cowboy Hat',
  HornedHelmet: 'Horned Helmet',
  TopHat: 'Top Hat',
  PirateHat: 'Pirate Hat',
  WitchHat: 'Witch Hat',
  TrafficCone: 'Traffic Cone',
  Colander: 'Colander',
  Fez: 'Fez',
  BunnyEars: 'Bunny Ears',
  Plunger: 'Plunger',
  Lampshade: 'Lampshade',
  PumpkinHead: 'Pumpkin Head',
}

// NOTE: an earned look as a card on the end screen names it: a hat by its
// name, a shirt color and a gun skin with what they dress, and a print
// alone.
export const hatNameOf = (name: string): string =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(Hat.literals, hat => hat === name),
      hat => HAT_NAMES[hat],
    ),
    () => name,
  )

export const giftName: {
  (name: string): (kind: CosmeticKind) => string
  (kind: CosmeticKind, name: string): string
} = Function.dual(2, (kind: CosmeticKind, name: string): string =>
  kind === 'Hat'
    ? hatNameOf(name)
    : kind === 'Shirt'
      ? `${name} Shirt`
      : kind === 'Skin'
        ? `${name} Gun`
        : name,
)

// NOTE: the short line beside each special on a hero's card, read from
// src/domain/callingSpecials.ts with the numbers the rules hold (src/world/heroes/calling.ts), so
// a balance change moves the words too. About 24 characters each.
export const SPECIAL_LINES = {
  sturdierTraps: (percent: number): string => `Traps ${percent}% sturdier`,
  fasterMends: (times: number): string => `Mends ${times}x faster`,
  longerBlink: (percent: number): string => `Bite blink ${percent}% longer`,
  maxHearts: (hearts: number): string => `${hearts} max hearts`,
  fasterRuns: (percent: number): string => `Runs ${percent}% faster`,
  smallerMagazines: (percent: number): string => `Mags ${percent}% smaller`,
  moreKeys: (percent: number): string => `Kills drop ${percent}% more keys`,
  startsWithCooker: `Starts with ${GUN_NAMES.Cooker}`,
  stoveFewerKills: (percent: number): string =>
    `Stove at ${percent}% fewer kills`,
  noPistol: `No ${GUN_NAMES.Pistol}`,
  noSpecials: 'No specials',
} as const

// THE SHOP GUIDE

// NOTE: the Munchopedia's guide page to the house's finds (src/features/guide/shopGuide.ts):
// the guns in the cases, the traps in the crates, the fridge, and the rest.
export const SHOP_GUIDE_NAME = 'Finds'

export const SHOP_GUIDE_SECTION_NAMES: Readonly<
  Record<ShopGuideSection, string>
> = {
  Guns: 'Guns',
  Health: 'Health',
  Traps: 'Traps',
  Fridge: 'Fridge',
  House: 'House',
}

export const HOUSE_NAMES: Readonly<Record<HouseSpot, string>> = {
  Rattles: 'Rattles',
  Boards: 'Boarded Doors',
  Fridge: FRIDGE_NAME,
  Stove: STOVE_NAME,
  Valve: VALVE_NAME,
}

// THE MEDIC CALL

// NOTE: the words of the MEDIC call (src/world/party/medic.ts): the shout on the
// touch button, and the payoff over a teammate who got a downed player up.
export const MEDIC_WORD = 'MEDIC!'

export const SAVE_WORDS = {
  Saved: 'SAVED!',
  Clutch: 'CLUTCH!',
} as const

// NOTE: the dare's things, read aloud on the pause screen's list
// (src/features/menus/pauseProgress.ts).
export const DARE_NAMES: Readonly<Record<DareKind, string>> = {
  SilverSpoon: 'Silver Spoon',
  FamilyPortrait: 'Family Portrait',
  GuestBookPage: 'Guest Book Page',
  GrandmasRecipe: "Grandma's Recipe",
  MusicBox: 'Music Box',
  ButlersBell: "Butler's Bell",
  NapkinRing: "Chunk's Napkin Ring",
  DareNote: "Rattles' Dare Note",
  FalseTeeth: "Grandma's Teeth",
  Invitation: 'Party Invitation',
}

// NOTE: one line of the Munches' story each thing tells, on the dare card
// opened from the HUD (src/features/dare/pocketCardView.ts) once it is in
// the satchel: short, in the pixel font's capitals, from LORE.md.
export const DARE_LINES: Readonly<Record<DareKind, string>> = {
  GrandmasRecipe: 'SOUP FOR 200. STEP ONE: LOCK THE DOORS.',
  SilverSpoon: "UNCLE CHUNK'S. STILL HAS TOOTH MARKS.",
  ButlersBell: 'RINGS ITSELF AT 3 AM. NOBODY ANSWERS.',
  MusicBox: 'WINDS ITSELF. ONLY KNOWS THE CONGA.',
  FamilyPortrait: 'THE MUNCHES, SMILING. TOO MANY TEETH.',
  GuestBookPage: '4,012 SIGNED IN. NOBODY SIGNED OUT.',
  NapkinRing: 'ENGRAVED CHUNK. HALF CHEWED.',
  DareNote: '1924. THE SAME DARE AS YOURS.',
  FalseTeeth: 'STILL CHATTERING IN THE JAR.',
  Invitation: 'YOU ARE CORDIALLY INVITED... FOREVER.',
}

// THE DARE JOURNAL

// NOTE: the Munchopedia as the player reads it since the journal came
// (src/features/munchopedia/): its title, its tabs, and what each
// milestone (src/world/dare/milestones.ts) asks, short, on a locked thing
// or story page, and the title of the story page it opens.
export const JOURNAL_NAME = 'Dare Journal'

export const MILESTONE_HINTS: Readonly<Record<MilestoneId, string>> = {
  FirstFind: 'Find a thing',
  FirstEscape: 'Escape once',
  EveryRoomOpened: 'Open every room',
  ThingInEveryRoom: 'A find in every room',
  TenThings: 'Find 10 things',
  EscapeDoubleDare: 'Escape on Double Dare',
  ChunkTripleDare: 'Fell Chunk on Triple Dare',
  EscapeTripleDogDare: 'Escape on Triple Dog Dare',
}

export const STORY_TITLES: Readonly<Record<MilestoneId, string>> = {
  FirstFind: 'The Party',
  FirstEscape: 'Dear Whoever',
  EveryRoomOpened: 'Soup for 200',
  ThingInEveryRoom: 'The Deal',
  TenThings: 'Midnight',
  EscapeDoubleDare: 'Day 40',
  ChunkTripleDare: 'The Host',
  EscapeTripleDogDare: 'I Dare You',
}

// THE PROOF SHELF

// NOTE: the Proof Shelf (src/features/proof/): its card in the MORE hand,
// the big key that hangs on each row once Uncle Chunk falls there, and how
// a stamped run ended.
export const PROOF_NAME = 'Proof'

export const BIG_KEY_NAME = "Uncle Chunk's Big Key"

export const BIG_KEY_LINE = 'OPENS THE FRONT DOOR. HE WANTS IT BACK.'

export const PROOF_ENDING_NAMES: Readonly<Record<ProofEnding, string>> = {
  Escaped: 'ESCAPED',
  Chicken: 'CHICKEN',
  Munched: 'MUNCHED',
}

// DAILY MISSIONS

// NOTE: each daily mission as the player reads it (src/features/missions/),
// a few words with its goal (MISSION_RULES in src/shared/missionData.ts).
// Short enough for a phone's mission row.
export const MISSION_NAMES: Readonly<Record<MissionId, string>> = {
  HotfootKills: `Splat 15 ${ZOMBIE_NAMES.Runner}s`,
  PullFridge: `Pull the ${FRIDGE_NAME}`,
  RunWithBot: 'A run with a bot',
  PlayHandyman: `Play as the ${CALLING_NAMES.Handyman}`,
  ReviveFriend: 'Revive a friend',
  FindDareThings: 'Find 2 dare things',
  OpenCellar: 'Open the cellar',
  WorkRoomTools: 'Work 3 room tools',
  OpenCase: 'Open a display case',
  ChandelierCrush: `Drop the chandelier on ${CHANDELIER_CRUSH_GOAL}`,
  BarnBusterKills: `40 kills with the ${GUN_NAMES.Shotgun}`,
  GunToDeluxe: `A gun to ${DELUXE}`,
  EscapeDoubleDare: 'Escape on Double Dare',
  SplatZombies: 'Splat 150 zombies',
  LeaveEarly: `Chicken out the ${BACK_DOOR_NAME}`,
}

// NOTE: the mission panel's title, and its tag for all three done.
export const MISSIONS_TITLE = 'Daily missions'
export const ALL_THREE_TAG = 'ALL 3'
