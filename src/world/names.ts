import { Array, Function, Option } from 'effect'

import type { PickedMode } from '@munch/netcode'

import type {
  HouseSpot,
  MapId,
  ShopGuideSection,
  TutorialChoice,
} from '../shared/nameKeys'
import { type Calling, type CosmeticKind, Hat } from '../shared/playerData'
import type { Modifier } from './run/modifiers'
import type {
  FridgePrize,
  GunPerk,
  PickupKind,
  ShopItemId,
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
export const TIER_LADDER: Array.NonEmptyReadonlyArray<
  (base: string) => string
> = [
  base => base,
  base => `Beefy ${base}`,
  base => `${base} DELUXE`,
  base => `${base} 3000`,
]

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

export const GUN_PERK_NAMES: Readonly<Record<GunPerk, string>> = {
  Spicy: 'Spicy',
  Crispy: 'Crispy',
  Hearty: 'Hearty',
}

// SHOP GOODS

type OwnShopGood = Exclude<
  ShopItemId,
  'Pistol' | 'Shotgun' | 'Smg'
>

export const SHOP_GOOD_NAMES: Readonly<Record<OwnShopGood, string>> = {
  LaserSight: 'Laser Sight',
}

// THE CREW BOARD

// NOTE: the awards a co-op end card hands out (src/features/end/crewAwards.ts), each a
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
  shopOff: (percent: number): string => `Rattles ${percent}% off`,
  lessKillPay: (percent: number): string => `Kills pay ${percent}% less`,
  startsWithCooker: `Starts with ${GUN_NAMES.Cooker}`,
  stoveFewerKills: (percent: number): string =>
    `Stove at ${percent}% fewer kills`,
  noPistol: `No ${GUN_NAMES.Pistol}`,
  noSpecials: 'No specials',
} as const

// THE SHOP GUIDE

// NOTE: the Munchopedia's Shop page and the ? in Rattles' shop (src/features/guide/shopGuide.ts).
export const SHOP_GUIDE_NAME = 'Shop'

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
  Stall: "Rattles' Stall",
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
