import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  BULLET_LIFETIME_MS,
  BULLET_SPEED,
  FIRE_INTERVAL_MS,
  MUZZLE_DISTANCE,
  PISTOL_DAMAGE,
  PISTOL_MAGAZINE,
  PISTOL_RELOAD_MS,
  PLAYER_RECOIL_KICK_PX,
  PLAYER_RECOIL_MS,
  PLAYER_RECOIL_SQUASH,
  ZOMBIE_KNOCKBACK_SPEED,
} from '../../shared/constants'
import type { Calling } from '../../shared/playerData'
import type { SoundEffect } from '../../shared/soundEffect'
import { magazineFor } from '../heroes/calling'
import { GUN_NAMES, KNIFE_NAME, gunTierName } from '../names'
import {
  Arsenal,
  type CarriedGun,
  type GunSlot,
  Melee,
  type ParticleKind,
  type Player,
  Reload,
  type WeaponKind,
} from '../schema/worldSchema'

// STATS

export type MuzzleFlash = 'Flicker' | 'Pop' | 'Blast'

export type WeaponStats = Readonly<{
  name: string
  roundsLabel: string
  fireIntervalMs: number
  magazine: number
  reloadMs: number
  damage: number
  pellets: number
  spread: number
  speedJitter: number
  bulletSpeed: number
  bulletLifetimeMs: number
  knockback: number
  muzzleReach: number
  recoilMs: number
  recoilKickPx: number
  recoilSquash: number
  shakeTrauma: number
  flash: MuzzleFlash
  casing: ParticleKind
  maybeSpentClip: Option.Option<ParticleKind>
  sound: SoundEffect
}>

export const WEAPONS: Readonly<Record<WeaponKind, WeaponStats>> = {
  Pistol: {
    name: GUN_NAMES.Pistol,
    roundsLabel: 'rounds',
    fireIntervalMs: FIRE_INTERVAL_MS,
    magazine: PISTOL_MAGAZINE,
    reloadMs: PISTOL_RELOAD_MS,
    damage: PISTOL_DAMAGE,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: BULLET_SPEED,
    bulletLifetimeMs: BULLET_LIFETIME_MS,
    knockback: ZOMBIE_KNOCKBACK_SPEED,
    muzzleReach: MUZZLE_DISTANCE,
    recoilMs: PLAYER_RECOIL_MS,
    recoilKickPx: PLAYER_RECOIL_KICK_PX,
    recoilSquash: PLAYER_RECOIL_SQUASH,
    shakeTrauma: 0,
    flash: 'Pop',
    casing: 'Shell',
    maybeSpentClip: Option.some('Clip'),
    sound: 'Shot',
  },
  Shotgun: {
    name: GUN_NAMES.Shotgun,
    roundsLabel: 'shells',
    fireIntervalMs: 580,
    magazine: 6,
    reloadMs: 1200,
    damage: 1,
    pellets: 7,
    spread: 0.55,
    speedJitter: 0.15,
    bulletSpeed: 260,
    bulletLifetimeMs: 360,
    knockback: 180,
    muzzleReach: 9,
    recoilMs: 190,
    recoilKickPx: 3,
    recoilSquash: 0.26,
    shakeTrauma: 0.3,
    flash: 'Blast',
    casing: 'Hull',
    maybeSpentClip: Option.none(),
    sound: 'ShotgunBlast',
  },
  Smg: {
    name: GUN_NAMES.Smg,
    roundsLabel: 'rounds',
    fireIntervalMs: 70,
    magazine: 30,
    reloadMs: 1200,
    damage: 1,
    pellets: 1,
    spread: 0.22,
    speedJitter: 0.05,
    bulletSpeed: 280,
    bulletLifetimeMs: 700,
    knockback: 70,
    muzzleReach: 8,
    recoilMs: 55,
    recoilKickPx: 1,
    recoilSquash: 0.08,
    shakeTrauma: 0.04,
    flash: 'Flicker',
    casing: 'Link',
    maybeSpentClip: Option.some('Clip'),
    sound: 'SmgShot',
  },
  Peashooter: {
    name: GUN_NAMES.Peashooter,
    roundsLabel: 'peas',
    fireIntervalMs: 1000,
    // NOTE: The Grumpy Gnome fires on its own cooldown and never reloads, so
    // nothing reads its magazine.
    magazine: 1,
    reloadMs: 0,
    damage: 1,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: 230,
    bulletLifetimeMs: 560,
    knockback: 60,
    muzzleReach: 6,
    recoilMs: 120,
    recoilKickPx: 1,
    recoilSquash: 0.1,
    shakeTrauma: 0,
    flash: 'Flicker',
    casing: 'Shell',
    maybeSpentClip: Option.none(),
    sound: 'TurretShot',
  },
  // NOTE: the fridge weapons (src/world/fridge/fridgeWeapons.ts) fire no bullets, so
  // only their magazine, reload, and name are read here. The Cooker's
  // magazine is its lids; the Pan's is its dent meter (dents left before it
  // is fully dented, never reloaded, banged flat each break); Brain
  // Freeze's is its charges, reloaded like any magazine.
  Cooker: {
    name: GUN_NAMES.Cooker,
    roundsLabel: 'lids',
    fireIntervalMs: 250,
    magazine: 4,
    reloadMs: 1500,
    damage: 0,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: 0,
    bulletLifetimeMs: 0,
    knockback: 0,
    muzzleReach: 7,
    recoilMs: 180,
    recoilKickPx: 2,
    recoilSquash: 0.2,
    shakeTrauma: 0.2,
    flash: 'Pop',
    casing: 'Shell',
    maybeSpentClip: Option.none(),
    sound: 'Whoosh',
  },
  Pan: {
    name: GUN_NAMES.Pan,
    roundsLabel: 'dents',
    fireIntervalMs: 450,
    magazine: 24,
    reloadMs: 0,
    damage: 2,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: 0,
    bulletLifetimeMs: 0,
    knockback: 360,
    muzzleReach: 6,
    recoilMs: 220,
    recoilKickPx: 0,
    recoilSquash: 0,
    shakeTrauma: 0.12,
    flash: 'Flicker',
    casing: 'Shell',
    maybeSpentClip: Option.none(),
    sound: 'Clang',
  },
  Freeze: {
    name: GUN_NAMES.Freeze,
    roundsLabel: 'charges',
    fireIntervalMs: 600,
    magazine: 18,
    reloadMs: 1800,
    damage: 0,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: 0,
    bulletLifetimeMs: 0,
    knockback: 0,
    muzzleReach: 8,
    recoilMs: 160,
    recoilKickPx: 1,
    recoilSquash: 0.12,
    shakeTrauma: 0.08,
    flash: 'Flicker',
    casing: 'Shell',
    maybeSpentClip: Option.none(),
    sound: 'PowerDown',
  },
  // NOTE: the old manor's two guns, only out of the display cases
  // (src/world/feats/cases.ts), and never out of ammo. Old Thunder, the
  // trophy room's hunting rifle, is slow and heavy and each shot runs through
  // a line of zombies (GUN_PIERCE below). The Big Blunder from over the
  // mantel is a wide, short spray of pellets with a big shove.
  Rifle: {
    name: GUN_NAMES.Rifle,
    roundsLabel: 'rounds',
    fireIntervalMs: 900,
    magazine: 5,
    reloadMs: 1800,
    damage: 5,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: 420,
    bulletLifetimeMs: 700,
    knockback: 150,
    muzzleReach: 11,
    recoilMs: 240,
    recoilKickPx: 3,
    recoilSquash: 0.22,
    shakeTrauma: 0.22,
    flash: 'Blast',
    casing: 'Shell',
    maybeSpentClip: Option.none(),
    sound: 'RifleShot',
  },
  Blunderbuss: {
    name: GUN_NAMES.Blunderbuss,
    roundsLabel: 'pellets',
    fireIntervalMs: 850,
    magazine: 2,
    reloadMs: 1500,
    damage: 1,
    pellets: 12,
    spread: 0.95,
    speedJitter: 0.3,
    bulletSpeed: 230,
    bulletLifetimeMs: 200,
    knockback: 320,
    muzzleReach: 10,
    recoilMs: 260,
    recoilKickPx: 4,
    recoilSquash: 0.32,
    shakeTrauma: 0.4,
    flash: 'Blast',
    casing: 'Hull',
    maybeSpentClip: Option.none(),
    sound: 'BlunderbussBlast',
  },
}

// NOTE: the zombies a gun's own shot runs through after the first, on top of
// Hat Pins and a Crispy perk. Only Old Thunder pierces by itself.
const GUN_PIERCE: Readonly<Partial<Record<WeaponKind, number>>> = {
  Rifle: 3,
}

export const gunPierce = (kind: WeaponKind): number => GUN_PIERCE[kind] ?? 0

export const SIDEARM: WeaponKind = 'Pistol'

// UPGRADE TIERS

type TierBoost = Readonly<{
  damage: number
  fireIntervalMs: number
  magazine: number
  reloadMs: number
  spread: number
  pellets: number
  knockback: number
}>

const noBoost: TierBoost = {
  damage: 0,
  fireIntervalMs: 0,
  magazine: 0,
  reloadMs: 0,
  spread: 0,
  pellets: 0,
  knockback: 0,
}

// NOTE: a gun's tiers are earned, not bought (docs/ESCAPE_PLAN.md, "Gun
// levels"): Beefy at 40 kills with that gun, DELUXE at 120, 3000 at 250,
// the same for every gun with tiers. A fridge weapon levels the same way.
export const TIER_KILLS: Array.NonEmptyReadonlyArray<number> = [40, 120, 250]

const killsFor = (tier: number): number =>
  Option.getOrElse(Array.get(TIER_KILLS, tier), () => Infinity)

export type WeaponTier = Readonly<{
  kills: number
  boost: TierBoost
}>

export const UPGRADE_TIERS: Readonly<
  Record<WeaponKind, ReadonlyArray<WeaponTier>>
> = {
  Pistol: [
    {
      kills: killsFor(0),
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        magazine: 3,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 25,
      },
    },
    {
      kills: killsFor(1),
      boost: {
        damage: 0,
        fireIntervalMs: -20,
        magazine: 0,
        reloadMs: -300,
        spread: 0,
        pellets: 0,
        knockback: 0,
      },
    },
    {
      kills: killsFor(2),
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 15,
      },
    },
  ],
  Shotgun: [
    {
      kills: killsFor(0),
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: -150,
        spread: 0.1,
        pellets: 2,
        knockback: 0,
      },
    },
    {
      kills: killsFor(1),
      boost: {
        damage: 0,
        fireIntervalMs: -120,
        magazine: 0,
        reloadMs: -150,
        spread: 0,
        pellets: 0,
        knockback: 40,
      },
    },
    {
      kills: killsFor(2),
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: -150,
        spread: 0,
        pellets: 0,
        knockback: 0,
      },
    },
  ],
  Smg: [
    {
      kills: killsFor(0),
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: 0,
        spread: -0.08,
        pellets: 0,
        knockback: 10,
      },
    },
    {
      kills: killsFor(1),
      boost: {
        damage: 0,
        fireIntervalMs: -12,
        magazine: 10,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 0,
      },
    },
    {
      kills: killsFor(2),
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 0,
      },
    },
  ],
  Peashooter: [],
  // NOTE: the Cooker's and the Pan's other tier gains (a bigger blast, a
  // faster charge, a wider arc, the ground smash) are in
  // src/world/fridge/fridgeWeapons.ts; only their magazines grow here.
  Cooker: [
    { kills: killsFor(0), boost: noBoost },
    { kills: killsFor(1), boost: noBoost },
    {
      kills: killsFor(2),
      boost: { ...noBoost, magazine: 2 },
    },
  ],
  Pan: [
    { kills: killsFor(0), boost: noBoost },
    {
      kills: killsFor(1),
      boost: { ...noBoost, magazine: 24 },
    },
    { kills: killsFor(2), boost: noBoost },
  ],
  Freeze: [],
  Rifle: [
    {
      kills: killsFor(0),
      boost: { ...noBoost, magazine: 2 },
    },
    {
      kills: killsFor(1),
      boost: { ...noBoost, fireIntervalMs: -150, reloadMs: -400 },
    },
    {
      kills: killsFor(2),
      boost: { ...noBoost, damage: 2, knockback: 30 },
    },
  ],
  Blunderbuss: [
    {
      kills: killsFor(0),
      boost: { ...noBoost, pellets: 3 },
    },
    {
      kills: killsFor(1),
      boost: { ...noBoost, reloadMs: -350, knockback: 60 },
    },
    {
      kills: killsFor(2),
      boost: { ...noBoost, damage: 1, magazine: 1 },
    },
  ],
}

export const maxTier = (kind: WeaponKind): number => UPGRADE_TIERS[kind].length

const clampTier = (kind: WeaponKind, tier: number): number =>
  Math.max(0, Math.min(maxTier(kind), Math.floor(tier)))

const boostsUpTo = (kind: WeaponKind, tier: number): ReadonlyArray<TierBoost> =>
  pipe(
    UPGRADE_TIERS[kind],
    Array.take(clampTier(kind, tier)),
    Array.map(({ boost }) => boost),
  )

const applyBoost = (stats: WeaponStats, boost: TierBoost): WeaponStats =>
  modifyFields(stats, {
    damage: damage => damage + boost.damage,
    fireIntervalMs: interval => Math.max(1, interval + boost.fireIntervalMs),
    magazine: magazine => Math.max(1, magazine + boost.magazine),
    reloadMs: reloadMs => Math.max(0, reloadMs + boost.reloadMs),
    spread: spread => Math.max(0, spread + boost.spread),
    pellets: pellets => Math.max(1, pellets + boost.pellets),
    knockback: knockback => knockback + boost.knockback,
  })

export const effectiveStats: {
  (tier: number): (kind: WeaponKind) => WeaponStats
  (kind: WeaponKind, tier: number): WeaponStats
} = Function.dual(2, (kind: WeaponKind, tier: number): WeaponStats =>
  Array.reduce(boostsUpTo(kind, tier), WEAPONS[kind], applyBoost),
)

export const statsAt: {
  (tier: number): (kind: WeaponKind) => WeaponStats
  (kind: WeaponKind, tier: number): WeaponStats
} = Function.dual(2, (kind: WeaponKind, tier: number): WeaponStats =>
  effectiveStats(kind, tier),
)

export const maybeNextTier: {
  (tier: number): (kind: WeaponKind) => Option.Option<WeaponTier>
  (kind: WeaponKind, tier: number): Option.Option<WeaponTier>
} = Function.dual(
  2,
  (kind: WeaponKind, tier: number): Option.Option<WeaponTier> =>
    Array.get(UPGRADE_TIERS[kind], tier),
)

// NOTE: the names, and the tier word ladder every gun shares, are in
// `src/world/names.ts`.
export const tierName: {
  (tier: number): (kind: WeaponKind) => string
  (kind: WeaponKind, tier: number): string
} = Function.dual(2, (kind: WeaponKind, tier: number): string =>
  gunTierName(kind, clampTier(kind, tier)),
)

// PERKS

type PerkRules = Readonly<{
  spicyDamageScale: number
  crispyPierce: number
  heartyMagazineScale: number
}>

// NOTE: the perks the kitchen's stove cooks into a gun (src/world/kitchen/stove.ts),
// decided with the owner on 2026-11-02. Spicy's damage is not rounded, so
// a 1 damage bullet hits for 1.3 and a zombie's health goes down in
// fractions, as a boss's wound scale already makes it.
export const PERK_RULES: PerkRules = {
  spicyDamageScale: 1.3,
  crispyPierce: 1,
  heartyMagazineScale: 1.25,
}

// NOTE: the guns Rattles sells. These and the display cases' two cook at
// the stove; the knife, the Clang Pan, and the fridge's weapons do not.
export const SHOP_GUNS: ReadonlyArray<WeaponKind> = ['Pistol', 'Shotgun', 'Smg']

const COOKABLE_GUNS: ReadonlyArray<WeaponKind> = [
  ...SHOP_GUNS,
  'Rifle',
  'Blunderbuss',
]

export const isCookable = (kind: WeaponKind): boolean =>
  Array.contains(COOKABLE_GUNS, kind)

export const perkDamage: {
  (damage: number): (gun: CarriedGun) => number
  (gun: CarriedGun, damage: number): number
} = Function.dual(2, (gun: CarriedGun, damage: number): number =>
  gun.perk === 'Spicy' ? damage * PERK_RULES.spicyDamageScale : damage,
)

export const perkPierce = (gun: CarriedGun): number =>
  gun.perk === 'Crispy' ? PERK_RULES.crispyPierce : 0

// ARSENAL

// NOTE: no gun ever runs out (docs/ESCAPE_PLAN.md, "Endless ammo"): only
// its magazine counts, and a reload always fills it.

export const magazineOf: {
  (tier: number): (kind: WeaponKind) => number
  (kind: WeaponKind, tier: number): number
} = Function.dual(
  2,
  (kind: WeaponKind, tier: number): number => statsAt(kind, tier).magazine,
)

// NOTE: the magazine a player's gun holds: the gun's own, smaller for the
// Track Star (src/world/heroes/calling.ts). The Pan's dents and Brain Freeze's charges
// are not magazines a hand reloads, so a calling leaves them whole.
const magazineWith = (
  calling: Calling,
  kind: WeaponKind,
  tier: number,
): number =>
  isReloadable(kind)
    ? magazineFor(calling, magazineOf(kind, tier))
    : magazineOf(kind, tier)

// NOTE: a Hearty gun from the stove (src/world/kitchen/stove.ts) holds a quarter more,
// rounded, on top of its tier and the player's calling.
export const carriedMagazine: {
  (gun: CarriedGun): (calling: Calling) => number
  (calling: Calling, gun: CarriedGun): number
} = Function.dual(2, (calling: Calling, gun: CarriedGun): number =>
  gun.perk === 'Hearty'
    ? Math.round(
        magazineWith(calling, gun.kind, gun.tier) *
          PERK_RULES.heartyMagazineScale,
      )
    : magazineWith(calling, gun.kind, gun.tier),
)

// NOTE: a gun as it comes: tier 0 and no kills. It levels on its own kills
// (src/world/gear/gunLevels.ts).
export const freshGun: {
  (calling?: Calling): (kind: WeaponKind) => CarriedGun
  (kind: WeaponKind, calling?: Calling): CarriedGun
} = Function.dual(
  // NOTE: data-first starts with a weapon kind; data-last with a calling or nothing.
  (args: IArguments): boolean =>
    typeof args[0] === 'string' && args[0] in WEAPONS,
  (kind: WeaponKind, calling: Calling = 'You'): CarriedGun => ({
    kind,
    loaded: magazineWith(calling, kind, 0),
    tier: 0,
    kills: 0,
  }),
)

export const heldGun = (arsenal: Arsenal): CarriedGun =>
  Arsenal.match(arsenal, {
    OneGun: ({ first }) => first,
    HoldingFirst: ({ first }) => first,
    HoldingSecond: ({ second }) => second,
  })

// NOTE: the gun in the slot the player is not holding, if both are filled.
export const maybeOtherGun = (arsenal: Arsenal): Option.Option<CarriedGun> =>
  Arsenal.match(arsenal, {
    OneGun: () => Option.none(),
    HoldingFirst: ({ second }) => Option.some(second),
    HoldingSecond: ({ first }) => Option.some(first),
  })

// NOTE: the guns in slot order, the first slot first.
export const gunsOf = (
  arsenal: Arsenal,
): Array.NonEmptyReadonlyArray<CarriedGun> =>
  Arsenal.match(arsenal, {
    OneGun: ({ first }): Array.NonEmptyReadonlyArray<CarriedGun> => [first],
    HoldingFirst: ({
      first,
      second,
    }): Array.NonEmptyReadonlyArray<CarriedGun> => [first, second],
    HoldingSecond: ({
      first,
      second,
    }): Array.NonEmptyReadonlyArray<CarriedGun> => [first, second],
  })

export const heldSlotOf = (arsenal: Arsenal): GunSlot =>
  Arsenal.isAnyOf(['HoldingSecond'])(arsenal) ? 'Second' : 'First'

export const heldWeapon = (arsenal: Arsenal): WeaponKind =>
  heldGun(arsenal).kind

// NOTE: what the player carries: the guns in slot order, then the Pan in
// the melee slot, if they have one.
export const carriedOf = (player: Player): ReadonlyArray<CarriedGun> => [
  ...gunsOf(player.arsenal),
  ...Option.toArray(maybePanOf(player)),
]

export const isCarrying: {
  (kind: WeaponKind): (player: Player) => boolean
  (player: Player, kind: WeaponKind): boolean
} = Function.dual(2, (player: Player, kind: WeaponKind): boolean =>
  Array.some(carriedOf(player), gun => gun.kind === kind),
)

export const maybeCarried: {
  (kind: WeaponKind): (player: Player) => Option.Option<CarriedGun>
  (player: Player, kind: WeaponKind): Option.Option<CarriedGun>
} = Function.dual(
  2,
  (player: Player, kind: WeaponKind): Option.Option<CarriedGun> =>
    Array.findFirst(carriedOf(player), gun => gun.kind === kind),
)

export const isHolding: {
  (kind: WeaponKind): (player: Player) => boolean
  (player: Player, kind: WeaponKind): boolean
} = Function.dual(
  2,
  (player: Player, kind: WeaponKind): boolean => inHandOf(player) === kind,
)

export const mapGuns: {
  (change: (gun: CarriedGun) => CarriedGun): (arsenal: Arsenal) => Arsenal
  (arsenal: Arsenal, change: (gun: CarriedGun) => CarriedGun): Arsenal
} = Function.dual(
  2,
  (arsenal: Arsenal, change: (gun: CarriedGun) => CarriedGun): Arsenal =>
    Arsenal.match(arsenal, {
      OneGun: ({ first }) => Arsenal.OneGun({ first: change(first) }),
      HoldingFirst: ({ first, second }) =>
        Arsenal.HoldingFirst({ first: change(first), second: change(second) }),
      HoldingSecond: ({ first, second }) =>
        Arsenal.HoldingSecond({ first: change(first), second: change(second) }),
    }),
)

export const mapHeld: {
  (change: (gun: CarriedGun) => CarriedGun): (arsenal: Arsenal) => Arsenal
  (arsenal: Arsenal, change: (gun: CarriedGun) => CarriedGun): Arsenal
} = Function.dual(
  2,
  (arsenal: Arsenal, change: (gun: CarriedGun) => CarriedGun): Arsenal =>
    Arsenal.match(arsenal, {
      OneGun: ({ first }) => Arsenal.OneGun({ first: change(first) }),
      HoldingFirst: ({ first, second }) =>
        Arsenal.HoldingFirst({ first: change(first), second }),
      HoldingSecond: ({ first, second }) =>
        Arsenal.HoldingSecond({ first, second: change(second) }),
    }),
)

export const swapWeapon = (arsenal: Arsenal): Arsenal =>
  Arsenal.match(arsenal, {
    OneGun: () => arsenal,
    HoldingFirst: ({ first, second }) =>
      Arsenal.HoldingSecond({ first, second }),
    HoldingSecond: ({ first, second }) =>
      Arsenal.HoldingFirst({ first, second }),
  })

// NOTE: a new gun goes in the player's hands. It fills an empty second
// slot; with both slots full it replaces the gun the player holds (with the
// knife out, the last gun held), kills and levels and all (GAME_DESIGN.md, "The
// knife and two gun slots").
export const takeGun: {
  (gun: CarriedGun): (arsenal: Arsenal) => Arsenal
  (arsenal: Arsenal, gun: CarriedGun): Arsenal
} = Function.dual(2, (arsenal: Arsenal, gun: CarriedGun): Arsenal =>
  Arsenal.match(arsenal, {
    OneGun: ({ first }) => Arsenal.HoldingSecond({ first, second: gun }),
    HoldingFirst: ({ second }) => Arsenal.HoldingFirst({ first: gun, second }),
    HoldingSecond: ({ first }) => Arsenal.HoldingSecond({ first, second: gun }),
  }),
)

// NOTE: the gun a new one would replace: none while the second slot is
// empty, else the one in the player's hands.
export const maybeReplacedGun = (
  arsenal: Arsenal,
): Option.Option<CarriedGun> =>
  Arsenal.isAnyOf(['OneGun'])(arsenal)
    ? Option.none()
    : Option.some(heldGun(arsenal))

export const heldTier = (player: Player): number => heldGun(player.arsenal).tier

export const tierOf: {
  (kind: WeaponKind): (player: Player) => number
  (player: Player, kind: WeaponKind): number
} = Function.dual(2, (player: Player, kind: WeaponKind): number =>
  Option.match(maybeCarried(player, kind), {
    onNone: () => 0,
    onSome: gun => gun.tier,
  }),
)

export const heldStats = (player: Player): WeaponStats =>
  statsAt(heldWeapon(player.arsenal), heldTier(player))

// MAGAZINES

export const heldLoaded = (player: Player): number =>
  heldGun(player.arsenal).loaded

export const isReloading = (player: Player): boolean =>
  Reload.isAnyOf(['Reloading'])(player.reload)

// NOTE: the Pan's dents are never reloaded: Rattles bangs it flat each
// break (src/world/fridge/fridgeWeapons.ts, flattenPans).
const UNLOADED_WEAPONS: ReadonlyArray<WeaponKind> = ['Pan']

export const isReloadable = (kind: WeaponKind): boolean =>
  !Array.contains(UNLOADED_WEAPONS, kind)

export const canReload = (player: Player): boolean => {
  const gun = heldGun(player.arsenal)
  return (
    isReloadable(gun.kind) &&
    !isReloading(player) &&
    gun.loaded < carriedMagazine(player.calling, gun)
  )
}

export const beginReload = (player: Player): Player => {
  const { reloadMs } = heldStats(player)
  return modifyFields(player, {
    reload: () =>
      Reload.Reloading({ remainingMs: reloadMs, durationMs: reloadMs }),
  })
}

// NOTE: a gun just put in hand: a reload of the last one stops, and the
// trigger's rest starts over, so the idle reload below Hard waits its full
// time on the new gun.
export const putGunInHand = (player: Player): Player =>
  modifyFields(player, {
    reload: () => Reload.Ready(),
    triggerRestMs: () => 0,
  })

const fillGun = (gun: CarriedGun, calling: Calling): CarriedGun =>
  modifyFields(gun, { loaded: () => carriedMagazine(calling, gun) })

export const finishReload = (player: Player): Player =>
  modifyFields(player, {
    reload: () => Reload.Ready(),
    arsenal: arsenal => mapHeld(arsenal, gun => fillGun(gun, player.calling)),
  })

export const spendRound = (player: Player): Player =>
  modifyFields(player, {
    arsenal: arsenal =>
      mapHeld(arsenal, gun =>
        modifyFields(gun, { loaded: loaded => Math.max(0, loaded - 1) }),
      ),
  })

// THE MELEE SLOT

// NOTE: the third slot, right of the two guns (GAME_DESIGN.md, "The knife
// and two gun slots"): the knife, or the Clang Pan once the fridge has
// given one, which takes the knife's place for the rest of the run. The
// arsenal keeps naming the last gun held, and a reload of that gun carries
// on while the melee weapon is out, so a player can stab or swing
// mid-reload and go back to a full magazine. Only changing guns stops a
// reload.
export const isWieldingMelee = (player: Player): boolean =>
  player.wield === 'Melee'

// NOTE: the Clang Pan in the melee slot, if the fridge has given one.
export const maybePanOf = (player: Player): Option.Option<CarriedGun> =>
  Melee.match(player.melee, {
    Knife: () => Option.none(),
    Pan: ({ pan }) => Option.some(pan),
  })

export const hasPan = (player: Player): boolean =>
  Melee.isAnyOf(['Pan'])(player.melee)

export const isWieldingKnife = (player: Player): boolean =>
  isWieldingMelee(player) && !hasPan(player)

// NOTE: the Pan in hand, for the trigger and the views.
export const maybeWieldedPan = (player: Player): Option.Option<CarriedGun> =>
  isWieldingMelee(player) ? maybePanOf(player) : Option.none()

export const mapPan: {
  (change: (pan: CarriedGun) => CarriedGun): (player: Player) => Player
  (player: Player, change: (pan: CarriedGun) => CarriedGun): Player
} = Function.dual(
  2,
  (player: Player, change: (pan: CarriedGun) => CarriedGun): Player =>
    Melee.match(player.melee, {
      Knife: () => player,
      Pan: ({ pan }) =>
        modifyFields(player, { melee: () => Melee.Pan({ pan: change(pan) }) }),
    }),
)

// NOTE: every gun and the Pan, mapped alike: a level up, a refill, or
// Rattles banging the Pan flat finds it in whichever slot it is.
export const mapCarried: {
  (change: (gun: CarriedGun) => CarriedGun): (player: Player) => Player
  (player: Player, change: (gun: CarriedGun) => CarriedGun): Player
} = Function.dual(
  2,
  (player: Player, change: (gun: CarriedGun) => CarriedGun): Player =>
    mapPan(
      modifyFields(player, { arsenal: arsenal => mapGuns(arsenal, change) }),
      change,
    ),
)

// NOTE: the Pan from the fridge goes in the melee slot, in hand, and both
// guns stay. A second Pan never comes out of the fridge (the weapon a
// player carries is never pulled again), so a Pan already there only gets
// banged flat, its kills and level kept.
export const takePan: {
  (fresh: CarriedGun): (player: Player) => Player
  (player: Player, fresh: CarriedGun): Player
} = Function.dual(2, (player: Player, fresh: CarriedGun): Player =>
  modifyFields(player, {
    melee: () =>
      Melee.Pan({
        pan: Option.match(maybePanOf(player), {
          onNone: () => fresh,
          onSome: pan =>
            modifyFields(pan, {
              loaded: () => magazineOf(pan.kind, pan.tier),
            }),
        }),
      }),
    wield: () => 'Melee',
  }),
)

// NOTE: the melee slot's name as a player reads it: the knife, or the Pan
// with its tier word.
export const meleeNameOf = (player: Player): string =>
  Option.match(maybePanOf(player), {
    onNone: () => KNIFE_NAME,
    onSome: pan => tierName(pan.kind, pan.tier),
  })

export type InHand = WeaponKind | 'Knife'

// NOTE: what the player holds: the knife, the Pan, or the held gun's kind.
export const inHandOf = (player: Player): InHand => {
  if (!isWieldingMelee(player)) {
    return heldWeapon(player.arsenal)
  }
  return hasPan(player) ? 'Pan' : 'Knife'
}

export const drawMelee = (player: Player): Player =>
  isWieldingMelee(player)
    ? player
    : modifyFields(player, { wield: () => 'Melee' })

// NOTE: the gun in `slot` in hand. A slot with no gun leaves the arsenal
// as it is, and a gun that changes stops a reload.
export const drawSlot: {
  (slot: GunSlot): (player: Player) => Player
  (player: Player, slot: GunSlot): Player
} = Function.dual(2, (player: Player, slot: GunSlot): Player => {
  const arsenal =
    heldSlotOf(player.arsenal) === slot
      ? player.arsenal
      : swapWeapon(player.arsenal)
  const drawn = modifyFields(player, {
    arsenal: () => arsenal,
    wield: () => 'Gun',
  })
  return heldGun(drawn.arsenal) === heldGun(player.arsenal)
    ? drawn
    : putGunInHand(drawn)
})

// NOTE: Q. With the melee weapon out it goes back to the last gun held;
// with a gun in hand it switches to the other gun.
export const swapInHand = (player: Player): Player =>
  isWieldingMelee(player)
    ? modifyFields(player, { wield: () => 'Gun' })
    : drawSlot(player, heldSlotOf(swapWeapon(player.arsenal)))

// NOTE: the Pop Pistol as a run starts with it, in the first slot.
export const STARTING_PISTOL: CarriedGun = freshGun(SIDEARM)
