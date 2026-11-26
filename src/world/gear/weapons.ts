import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

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
} from '#shared/constants.ts'
import type { Calling } from '#shared/playerData.ts'
import type { SoundEffect } from '#shared/soundEffect.ts'
import { magazineFor } from '#world/heroes/calling.ts'
import { GUN_NAMES, KNIFE_NAME, gunTierName } from '#world/names.ts'
import {
  Arsenal,
  type CarriedGun,
  type GunSlot,
  Melee,
  type ParticleKind,
  type Player,
  Reload,
  type WeaponKind,
} from '#world/schema/worldSchema.ts'

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
    spread: 0.55,
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

const GUN_PIERCE: Readonly<Partial<Record<WeaponKind, number>>> = {
  Rifle: 3,
}

export const gunPierce = (kind: WeaponKind): number => GUN_PIERCE[kind] ?? 0

export const SIDEARM: WeaponKind = 'Pistol'

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
        spread: -0.05,
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
  UiStruct.evolve(stats, {
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

export const tierName: {
  (tier: number): (kind: WeaponKind) => string
  (kind: WeaponKind, tier: number): string
} = Function.dual(2, (kind: WeaponKind, tier: number): string =>
  gunTierName(kind, clampTier(kind, tier)),
)

type PerkRules = Readonly<{
  spicyDamageScale: number
  crispyPierce: number
  heartyMagazineScale: number
}>

export const PERK_RULES: PerkRules = {
  spicyDamageScale: 1.3,
  crispyPierce: 1,
  heartyMagazineScale: 1.25,
}

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

export const magazineOf: {
  (tier: number): (kind: WeaponKind) => number
  (kind: WeaponKind, tier: number): number
} = Function.dual(
  2,
  (kind: WeaponKind, tier: number): number => statsAt(kind, tier).magazine,
)

const magazineWith = (
  calling: Calling,
  kind: WeaponKind,
  tier: number,
): number =>
  isReloadable(kind)
    ? magazineFor(calling, magazineOf(kind, tier))
    : magazineOf(kind, tier)

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

export const freshGun: {
  (calling?: Calling): (kind: WeaponKind) => CarriedGun
  (kind: WeaponKind, calling?: Calling): CarriedGun
} = Function.dual(
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

export const maybeOtherGun = (arsenal: Arsenal): Option.Option<CarriedGun> =>
  Arsenal.match(arsenal, {
    OneGun: () => Option.none(),
    HoldingFirst: ({ second }) => Option.some(second),
    HoldingSecond: ({ first }) => Option.some(first),
  })

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

export const heldLoaded = (player: Player): number =>
  heldGun(player.arsenal).loaded

export const isReloading = (player: Player): boolean =>
  Reload.isAnyOf(['Reloading'])(player.reload)

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
  return UiStruct.evolve(player, {
    reload: () =>
      Reload.Reloading({ remainingMs: reloadMs, durationMs: reloadMs }),
  })
}

export const putGunInHand = (player: Player): Player =>
  UiStruct.evolve(player, {
    reload: () => Reload.Ready(),
    triggerRestMs: () => 0,
  })

const fillGun = (gun: CarriedGun, calling: Calling): CarriedGun =>
  UiStruct.evolve(gun, { loaded: () => carriedMagazine(calling, gun) })

export const finishReload = (player: Player): Player =>
  UiStruct.evolve(player, {
    reload: () => Reload.Ready(),
    arsenal: arsenal => mapHeld(arsenal, gun => fillGun(gun, player.calling)),
  })

export const spendRound = (player: Player): Player =>
  UiStruct.evolve(player, {
    arsenal: arsenal =>
      mapHeld(arsenal, gun =>
        UiStruct.evolve(gun, { loaded: loaded => Math.max(0, loaded - 1) }),
      ),
  })

export const isWieldingMelee = (player: Player): boolean =>
  player.wield === 'Melee'

export const maybePanOf = (player: Player): Option.Option<CarriedGun> =>
  Melee.match(player.melee, {
    Knife: () => Option.none(),
    Pan: ({ pan }) => Option.some(pan),
  })

export const hasPan = (player: Player): boolean =>
  Melee.isAnyOf(['Pan'])(player.melee)

export const isWieldingKnife = (player: Player): boolean =>
  isWieldingMelee(player) && !hasPan(player)

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
        UiStruct.evolve(player, {
          melee: () => Melee.Pan({ pan: change(pan) }),
        }),
    }),
)

export const mapCarried: {
  (change: (gun: CarriedGun) => CarriedGun): (player: Player) => Player
  (player: Player, change: (gun: CarriedGun) => CarriedGun): Player
} = Function.dual(
  2,
  (player: Player, change: (gun: CarriedGun) => CarriedGun): Player =>
    mapPan(
      UiStruct.evolve(player, { arsenal: arsenal => mapGuns(arsenal, change) }),
      change,
    ),
)

export const takePan: {
  (fresh: CarriedGun): (player: Player) => Player
  (player: Player, fresh: CarriedGun): Player
} = Function.dual(2, (player: Player, fresh: CarriedGun): Player =>
  UiStruct.evolve(player, {
    melee: () =>
      Melee.Pan({
        pan: Option.match(maybePanOf(player), {
          onNone: () => fresh,
          onSome: pan =>
            UiStruct.evolve(pan, {
              loaded: () => magazineOf(pan.kind, pan.tier),
            }),
        }),
      }),
    wield: () => 'Melee',
  }),
)

export const meleeNameOf = (player: Player): string =>
  Option.match(maybePanOf(player), {
    onNone: () => KNIFE_NAME,
    onSome: pan => tierName(pan.kind, pan.tier),
  })

export type InHand = WeaponKind | 'Knife'

export const inHandOf = (player: Player): InHand => {
  if (!isWieldingMelee(player)) {
    return heldWeapon(player.arsenal)
  }
  return hasPan(player) ? 'Pan' : 'Knife'
}

export const drawMelee = (player: Player): Player =>
  isWieldingMelee(player)
    ? player
    : UiStruct.evolve(player, { wield: () => 'Melee' })

export const drawSlot: {
  (slot: GunSlot): (player: Player) => Player
  (player: Player, slot: GunSlot): Player
} = Function.dual(2, (player: Player, slot: GunSlot): Player => {
  const arsenal =
    heldSlotOf(player.arsenal) === slot
      ? player.arsenal
      : swapWeapon(player.arsenal)
  const drawn = UiStruct.evolve(player, {
    arsenal: () => arsenal,
    wield: () => 'Gun',
  })
  return heldGun(drawn.arsenal) === heldGun(player.arsenal)
    ? drawn
    : putGunInHand(drawn)
})

export const swapInHand = (player: Player): Player =>
  isWieldingMelee(player)
    ? UiStruct.evolve(player, { wield: () => 'Gun' })
    : drawSlot(player, heldSlotOf(swapWeapon(player.arsenal)))

export const STARTING_PISTOL: CarriedGun = freshGun(SIDEARM)
