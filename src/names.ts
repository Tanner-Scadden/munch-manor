import { Array, Option } from 'effect'

import type { PickedMode } from '@munch/netcode'

import type { Calling, Hat } from './playerData'
import type {
  FixedShopItemId,
  FridgePrize,
  PickupKind,
  TrapKind,
  WeaponKind,
  ZombieKind,
} from './worldSchema'

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
}

// NOTE: every gun's upgrade tiers share one ladder of tier words around its
// base name, so an upgraded gun still reads as the same gun (decided with the
// owner on 2026-10-30, see "Names" in GAME_DESIGN.md). Tier 0 is the base
// name. A new tier is a new word here, never a new name for one gun.
export const TIER_LADDER: Array.NonEmptyReadonlyArray<
  (base: string) => string
> = [
  base => base,
  base => `Beefy ${base}`,
  base => `${base} DELUXE`,
  base => `${base} 3000`,
]

export const gunTierName = (kind: WeaponKind, tier: number): string =>
  Option.match(Array.get(TIER_LADDER, tier), {
    onNone: () => GUN_NAMES[kind],
    onSome: name => name(GUN_NAMES[kind]),
  })

// NOTE: the knife every player carries (src/knife.ts). It has no tiers and
// is never sold, so it has one name and nothing else.
export const KNIFE_NAME = 'Knife'

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

// TRAPS

export const TRAP_NAMES: Readonly<Record<TrapKind, string>> = {
  Barricade: 'Plank Pile',
  Turret: 'Grumpy Gnome',
}

// POWER-UPS

export const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = {
  RapidFire: 'HOT SAUCE',
  Damage: 'MEAN BEANS',
  Speed: 'ZOOMY SOCKS',
  Pierce: 'SHISH KEBULLETS',
  Burp: 'BIG BURP',
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

// THE FRIDGE

// NOTE: Mystery Leftovers (src/leftovers.ts).
export const FRIDGE_NAME = 'Mystery Leftovers'

// NOTE: the one word that lands with each prize when the fridge's spin
// stops (src/fridgeReveal.ts).
export const PRIZE_PUNCH_LINES: Readonly<Record<FridgePrize, string>> = {
  Cooker: 'BOOM',
  Pan: 'BONK',
  Freeze: 'BRRR',
  Sandwich: 'CHOMP',
  Dud: 'BLEH',
}

// SHOP GOODS

type OwnShopGood = Exclude<
  FixedShopItemId,
  | 'Pistol'
  | 'Shotgun'
  | 'Smg'
  | 'ShotgunUpgrade'
  | 'SmgUpgrade'
  | 'PistolUpgrade'
  | 'CookerUpgrade'
  | 'PanUpgrade'
  | TrapKind
>

export const SHOP_GOOD_NAMES: Readonly<Record<OwnShopGood | 'Repair', string>> =
  {
    ShotgunShells: 'Shell Sack',
    SmgRounds: 'Chatter Drum',
    LidStack: 'Lid Stack',
    LaserSight: 'Laser Sight',
    Heart: 'Pickled Heart',
    Repair: 'Glue and Nails',
  }

// THE CREW BOARD

// NOTE: the awards a co-op end card hands out (src/crewAwards.ts), each a
// title under the winner's column. The ids live here, apart from the
// client module that hands them out, since the room's modules read names.
export type CrewAward =
  | 'Mvp'
  | 'Medic'
  | 'Sharpshooter'
  | 'BigSpender'
  | 'MostMunched'

export const CREW_AWARD_NAMES: Readonly<Record<CrewAward, string>> = {
  Mvp: 'MVP',
  Medic: 'Medic',
  Sharpshooter: 'Sharpshooter',
  BigSpender: 'Big Spender',
  MostMunched: 'Most Munched',
}

// CALLINGS

// NOTE: what a player brings to a run (src/calling.ts). The cards show the
// quirks as pictures; the notes are only read aloud.
export const CALLING_NAMES: Readonly<Record<Calling, string>> = {
  You: 'YOU',
  Handyman: 'Handyman',
  TrackStar: 'Track Star',
  PennyPincher: 'Penny Pincher',
  LineCook: 'Line Cook',
}

// NOTE: the closet's hats (src/closet.ts), read on focus and aloud.
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

export const CALLING_NOTES: Readonly<Record<Calling, string>> = {
  You: 'No quirk',
  Handyman:
    'Plank Piles cost half, repairs are free, a longer breather after a bite, one fewer heart',
  TrackStar: 'Runs 10 percent faster, magazines 10 percent smaller',
  PennyPincher: 'Rattles charges 15 percent less, kills pay less',
  LineCook: 'Starts with the Pressure Cooker, no Pop Pistol',
}
