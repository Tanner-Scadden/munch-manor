import { Array, Function, Option } from 'effect'

import type { PickedMode } from '@munch/netcode'

import type {
  HouseSpot,
  MapId,
  ShopGuideSection,
  TutorialChoice,
} from '#shared/nameKeys.ts'
import type { MasterySkin } from '#shared/records/masteryData.ts'
import {
  CHANDELIER_CRUSH_GOAL,
  type MissionId,
} from '#shared/records/missionData.ts'
import {
  type Calling,
  type CosmeticKind,
  FIRST_ESCAPE_BONES,
  Hat,
  type PropStyle,
  type RunEnding,
} from '#shared/records/playerData.ts'
import type { ProofEnding } from '#shared/records/proofData.ts'

import type { DareKind } from './dare/dareSchema.ts'
import type { MilestoneId } from './dare/milestones.ts'
import type { BoneBonus } from './heroes/rank.ts'
import type { Modifier } from './run/modifiers.ts'
import type {
  FridgePrize,
  GunPerk,
  PickupKind,
  TrapKind,
  WeaponKind,
  ZombieKind,
} from './schema/worldSchema.ts'

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

export const KNIFE_NAME = 'Knife'

export const MULTIPLAYER_NAME = 'MULTIPLAYER'

export const TUTORIAL_CHOICE_NAMES: Readonly<Record<TutorialChoice, string>> = {
  Tutorial: 'TUTORIAL',
  Skip: 'SKIP IT',
}

export const ZOMBIE_NAMES: Readonly<Record<ZombieKind, string>> = {
  Shambler: 'Groaner',
  Runner: 'Hotfoot',
  Tank: 'Big Lug',
  Exploder: 'Kaboomer',
  Thrower: 'Big Leaguer',
  Crawler: 'Ankle Biter',
  Boss: 'Uncle Chunk',
}

export const BONE_BONUS_TAGS: Readonly<Record<BoneBonus, string>> = {
  Floor: 'MIN',
  Double: 'X2',
  FirstEscape: `+${FIRST_ESCAPE_BONES}`,
}

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

export const TRAP_NAMES: Readonly<Record<TrapKind, string>> = {
  Barricade: 'Plank Pile',
  Turret: 'Grumpy Gnome',
}

export const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = {
  RapidFire: 'WIND-UP KEY',
  Damage: 'FAMILY SILVER',
  Speed: 'DANCING SHOES',
  Pierce: 'HAT PINS',
  Burp: 'DINNER GONG',
  Heart: 'PICKLED HEART',
}

export const MODE_NAMES: Readonly<Record<PickedMode, string>> = {
  Campaign: 'Campaign',
  Endless: 'Endless',
  KeepGoing: 'Keep going',
}

export const MAP_NAMES: Readonly<Record<MapId, string>> = {
  Manor: 'The Manor',
}

export const MODIFIER_NAMES: Readonly<Record<Modifier, string>> = {
  FriendlyFire: 'Friendly Fire',
  BigCrowd: 'Big Crowd',
  Broke: 'Broke',
  Glass: 'Glass',
}

export const FRIDGE_NAME = 'Mystery Leftovers'

export const PRIZE_PUNCH_LINES: Readonly<Record<FridgePrize, string>> = {
  Cooker: 'BOOM',
  Pan: 'BONK',
  Freeze: 'BRRR',
  Sandwich: 'CHOMP',
  Dud: 'BLEH',
}

export const PRIZE_NAMES: Readonly<Record<FridgePrize, string>> = {
  Cooker: GUN_NAMES.Cooker,
  Pan: GUN_NAMES.Pan,
  Freeze: GUN_NAMES.Freeze,
  Sandwich: 'Moldy Sandwich',
  Dud: 'Dud',
}

export const FOUND_NAMES = {
  Crate: 'Trap Crate',
  Mend: 'Mending',
} as const

export const STOVE_NAME = 'The Stove'

export const VALVE_NAME = 'Gas Valve'

export const BACK_DOOR_NAME = 'Back Door'

export const CHICKEN_WORD = 'CHICKEN!'

export const CHICKEN_QUIP = 'Bawk. The front door was right there'

export const GUN_PERK_NAMES: Readonly<Record<GunPerk, string>> = {
  Spicy: 'Spicy',
  Crispy: 'Crispy',
  Hearty: 'Hearty',
}

export const LASER_SIGHT_NAME = 'Laser Sight'

export const DISPLAY_CASE_NAME = 'Display Case'

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

export const CALLING_NAMES: Readonly<Record<Calling, string>> = {
  You: 'YOU',
  Handyman: 'Handyman',
  TrackStar: 'Track Star',
  PennyPincher: 'Penny Pincher',
  LineCook: 'Line Cook',
}

export const PROP_STYLE_NAMES: Readonly<Record<PropStyle, string>> = {
  Stock: 'Stock',
  Silver: 'Silver',
  Night: 'Midnight',
  Ember: 'Ember',
  Gold: 'Gold',
}

export const MASTERY_SKIN_NAMES: Readonly<Record<MasterySkin, string>> = {
  Gilded: 'Gilded',
  Diamond: 'Diamond',
}

export const PROP_WORD = 'prop'
export const HERO_STORY_NAME = 'Story page'

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

export const hatNameOf = (name: string): string =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(Hat.literals, hat => hat === name),
      hat => HAT_NAMES[hat],
    ),
    () => name,
  )

export const PURSE_NAME = 'Bag of Bones'

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

export const MEDIC_WORD = 'MEDIC!'

export const SAVE_WORDS = {
  Saved: 'SAVED!',
  Clutch: 'CLUTCH!',
} as const

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

export const PROOF_NAME = 'Proof'

export const BIG_KEY_NAME = "Uncle Chunk's Big Key"

export const BIG_KEY_LINE = 'OPENS THE FRONT DOOR. HE WANTS IT BACK.'

export const PROOF_ENDING_NAMES: Readonly<Record<ProofEnding, string>> = {
  Escaped: 'ESCAPED',
  Chicken: 'CHICKEN',
  Munched: 'MUNCHED',
}

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

export const MISSIONS_TITLE = 'Daily missions'
export const ALL_THREE_TAG = 'ALL 3'
