import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { magazineFor } from './calling'
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
} from './constants'
import { GUN_NAMES, KNIFE_NAME, gunTierName } from './names'
import type { Calling } from './playerData'
import type { SoundEffect } from './soundEffect'
import {
  Arsenal,
  type CarriedGun,
  type GunSlot,
  Melee,
  type ParticleKind,
  type Player,
  Reload,
  type WeaponKind,
} from './worldSchema'

// STATS

export type MuzzleFlash = 'Flicker' | 'Pop' | 'Blast'

type RoundLimit = Readonly<{ starting: number; max: number }>

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
  maybeRoundLimit: Option.Option<RoundLimit>
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
    maybeRoundLimit: Option.none(),
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
    maybeRoundLimit: Option.some({ starting: 16, max: 48 }),
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
    maybeRoundLimit: Option.some({ starting: 150, max: 360 }),
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
    maybeRoundLimit: Option.none(),
  },
  // NOTE: the fridge weapons (src/fridgeWeapons.ts) fire no bullets, so
  // only their magazine, reload, rounds, and name are read here. The
  // Cooker's magazine is its lids; the Pan's is its dent meter (dents left
  // before it is fully dented, never reloaded, banged flat each break);
  // Brain Freeze's is its charges, all of them, never refilled.
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
    maybeRoundLimit: Option.some({ starting: 20, max: 28 }),
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
    maybeRoundLimit: Option.some({ starting: 24, max: 24 }),
  },
  Freeze: {
    name: GUN_NAMES.Freeze,
    roundsLabel: 'charges',
    fireIntervalMs: 600,
    magazine: 12,
    reloadMs: 0,
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
    maybeRoundLimit: Option.some({ starting: 12, max: 12 }),
  },
}

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
  maxRounds: number
}>

const noBoost: TierBoost = {
  damage: 0,
  fireIntervalMs: 0,
  magazine: 0,
  reloadMs: 0,
  spread: 0,
  pellets: 0,
  knockback: 0,
  maxRounds: 0,
}

export type WeaponTier = Readonly<{
  price: number
  boost: TierBoost
}>

export const UPGRADE_TIERS: Readonly<
  Record<WeaponKind, ReadonlyArray<WeaponTier>>
> = {
  Pistol: [
    {
      price: 200,
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        magazine: 3,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 25,
        maxRounds: 0,
      },
    },
    {
      price: 500,
      boost: {
        damage: 0,
        fireIntervalMs: -20,
        magazine: 0,
        reloadMs: -300,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 0,
      },
    },
    {
      price: 750,
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 15,
        maxRounds: 0,
      },
    },
  ],
  Shotgun: [
    {
      price: 40,
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: -150,
        spread: 0.1,
        pellets: 2,
        knockback: 0,
        maxRounds: 0,
      },
    },
    {
      price: 140,
      boost: {
        damage: 0,
        fireIntervalMs: -120,
        magazine: 0,
        reloadMs: -150,
        spread: 0,
        pellets: 0,
        knockback: 40,
        maxRounds: 16,
      },
    },
    {
      price: 320,
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: -150,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 16,
      },
    },
  ],
  Smg: [
    {
      price: 60,
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: 0,
        spread: -0.08,
        pellets: 0,
        knockback: 10,
        maxRounds: 0,
      },
    },
    {
      price: 180,
      boost: {
        damage: 0,
        fireIntervalMs: -12,
        magazine: 10,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 120,
      },
    },
    {
      price: 350,
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        magazine: 0,
        reloadMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 0,
      },
    },
  ],
  Peashooter: [],
  // NOTE: the Cooker's and the Pan's other tier gains (a bigger blast, a
  // faster charge, a wider arc, the ground smash) are in
  // src/fridgeWeapons.ts; only their magazines and rounds grow here.
  Cooker: [
    { price: 70, boost: noBoost },
    { price: 160, boost: noBoost },
    {
      price: 300,
      boost: { ...noBoost, magazine: 2, maxRounds: 12 },
    },
  ],
  Pan: [
    { price: 60, boost: noBoost },
    {
      price: 150,
      boost: { ...noBoost, magazine: 24, maxRounds: 24 },
    },
    { price: 300, boost: noBoost },
  ],
  Freeze: [],
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
    maybeRoundLimit: Option.map(limit =>
      modifyFields(limit, { max: max => max + boost.maxRounds }),
    ),
  })

export const effectiveStats = (kind: WeaponKind, tier: number): WeaponStats =>
  Array.reduce(boostsUpTo(kind, tier), WEAPONS[kind], applyBoost)

export const statsAt = (kind: WeaponKind, tier: number): WeaponStats =>
  effectiveStats(kind, tier)

export const maybeNextTier = (
  kind: WeaponKind,
  tier: number,
): Option.Option<WeaponTier> => Array.get(UPGRADE_TIERS[kind], tier)

// NOTE: the names, and the tier word ladder every gun shares, are in
// `src/names.ts`.
export const tierName = (kind: WeaponKind, tier: number): string =>
  gunTierName(kind, clampTier(kind, tier))

// ARSENAL

// NOTE: a gun with no round limit (the Pop Pistol) never runs out: only its
// magazine counts, and a reload always fills it.
export const hasEndlessRounds = (kind: WeaponKind): boolean =>
  Option.isNone(WEAPONS[kind].maybeRoundLimit)

export const startingRounds = (kind: WeaponKind): number =>
  Option.match(WEAPONS[kind].maybeRoundLimit, {
    onNone: () => 0,
    onSome: ({ starting }) => starting,
  })

export const maxRounds = (kind: WeaponKind, tier: number): number =>
  Option.match(statsAt(kind, tier).maybeRoundLimit, {
    onNone: () => 0,
    onSome: ({ max }) => max,
  })

export const magazineOf = (kind: WeaponKind, tier: number): number =>
  statsAt(kind, tier).magazine

// NOTE: the magazine a player's gun holds: the gun's own, smaller for the
// Track Star (src/calling.ts). The Pan's dents and Brain Freeze's charges
// are not magazines a hand reloads, so a calling leaves them whole.
const magazineWith = (
  calling: Calling,
  kind: WeaponKind,
  tier: number,
): number =>
  isReloadable(kind)
    ? magazineFor(calling, magazineOf(kind, tier))
    : magazineOf(kind, tier)

export const carriedMagazine = (calling: Calling, gun: CarriedGun): number =>
  magazineWith(calling, gun.kind, gun.tier)

export const freshGun = (
  kind: WeaponKind,
  calling: Calling = 'You',
): CarriedGun => {
  const magazine = magazineWith(calling, kind, 0)
  return {
    kind,
    rounds: startingRounds(kind),
    loaded: hasEndlessRounds(kind)
      ? magazine
      : Math.min(startingRounds(kind), magazine),
    tier: 0,
  }
}

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

export const isCarrying = (player: Player, kind: WeaponKind): boolean =>
  Array.some(carriedOf(player), gun => gun.kind === kind)

export const maybeCarried = (
  player: Player,
  kind: WeaponKind,
): Option.Option<CarriedGun> =>
  Array.findFirst(carriedOf(player), gun => gun.kind === kind)

export const isHolding = (player: Player, kind: WeaponKind): boolean =>
  inHandOf(player) === kind

export const mapGuns = (
  arsenal: Arsenal,
  change: (gun: CarriedGun) => CarriedGun,
): Arsenal =>
  Arsenal.match(arsenal, {
    OneGun: ({ first }) => Arsenal.OneGun({ first: change(first) }),
    HoldingFirst: ({ first, second }) =>
      Arsenal.HoldingFirst({ first: change(first), second: change(second) }),
    HoldingSecond: ({ first, second }) =>
      Arsenal.HoldingSecond({ first: change(first), second: change(second) }),
  })

export const mapHeld = (
  arsenal: Arsenal,
  change: (gun: CarriedGun) => CarriedGun,
): Arsenal =>
  Arsenal.match(arsenal, {
    OneGun: ({ first }) => Arsenal.OneGun({ first: change(first) }),
    HoldingFirst: ({ first, second }) =>
      Arsenal.HoldingFirst({ first: change(first), second }),
    HoldingSecond: ({ first, second }) =>
      Arsenal.HoldingSecond({ first, second: change(second) }),
  })

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
// knife out, the last gun held), upgrades and all (GAME_DESIGN.md, "The
// knife and two gun slots").
export const takeGun = (arsenal: Arsenal, gun: CarriedGun): Arsenal =>
  Arsenal.match(arsenal, {
    OneGun: ({ first }) => Arsenal.HoldingSecond({ first, second: gun }),
    HoldingFirst: ({ second }) => Arsenal.HoldingFirst({ first: gun, second }),
    HoldingSecond: ({ first }) => Arsenal.HoldingSecond({ first, second: gun }),
  })

// NOTE: the gun a new one would replace: none while the second slot is
// empty, else the one in the player's hands.
export const maybeReplacedGun = (
  arsenal: Arsenal,
): Option.Option<CarriedGun> =>
  Arsenal.isAnyOf(['OneGun'])(arsenal)
    ? Option.none()
    : Option.some(heldGun(arsenal))

export const heldTier = (player: Player): number => heldGun(player.arsenal).tier

export const tierOf = (player: Player, kind: WeaponKind): number =>
  Option.match(maybeCarried(player, kind), {
    onNone: () => 0,
    onSome: gun => gun.tier,
  })

export const heldStats = (player: Player): WeaponStats =>
  statsAt(heldWeapon(player.arsenal), heldTier(player))

// MAGAZINES

export const heldLoaded = (player: Player): number =>
  heldGun(player.arsenal).loaded

export const looseRounds = (gun: CarriedGun): number =>
  hasEndlessRounds(gun.kind) ? Infinity : Math.max(0, gun.rounds - gun.loaded)

// NOTE: whether a gun can still fire, now or after a reload.
export const hasRoundsLeft = (gun: CarriedGun): boolean =>
  hasEndlessRounds(gun.kind) || gun.rounds > 0

export const isReloading = (player: Player): boolean =>
  Reload.isAnyOf(['Reloading'])(player.reload)

// NOTE: the Pan's dents and Brain Freeze's charges are never reloaded.
const UNLOADED_WEAPONS: ReadonlyArray<WeaponKind> = ['Pan', 'Freeze']

export const isReloadable = (kind: WeaponKind): boolean =>
  !Array.contains(UNLOADED_WEAPONS, kind)

export const canReload = (player: Player): boolean => {
  const gun = heldGun(player.arsenal)
  return (
    isReloadable(gun.kind) &&
    !isReloading(player) &&
    gun.loaded < carriedMagazine(player.calling, gun) &&
    looseRounds(gun) > 0
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
  modifyFields(gun, {
    loaded: () =>
      hasEndlessRounds(gun.kind)
        ? carriedMagazine(calling, gun)
        : Math.min(gun.rounds, carriedMagazine(calling, gun)),
  })

export const finishReload = (player: Player): Player =>
  modifyFields(player, {
    reload: () => Reload.Ready(),
    arsenal: arsenal => mapHeld(arsenal, gun => fillGun(gun, player.calling)),
  })

export const spendRound = (player: Player): Player =>
  modifyFields(player, {
    arsenal: arsenal =>
      mapHeld(arsenal, gun =>
        modifyFields(gun, {
          rounds: rounds =>
            hasEndlessRounds(gun.kind) ? rounds : Math.max(0, rounds - 1),
          loaded: loaded => Math.max(0, loaded - 1),
        }),
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

export const mapPan = (
  player: Player,
  change: (pan: CarriedGun) => CarriedGun,
): Player =>
  Melee.match(player.melee, {
    Knife: () => player,
    Pan: ({ pan }) =>
      modifyFields(player, { melee: () => Melee.Pan({ pan: change(pan) }) }),
  })

// NOTE: every gun and the Pan, mapped alike: an upgrade, a refill, or
// Rattles banging the Pan flat finds it in whichever slot it is.
export const mapCarried = (
  player: Player,
  change: (gun: CarriedGun) => CarriedGun,
): Player =>
  mapPan(
    modifyFields(player, { arsenal: arsenal => mapGuns(arsenal, change) }),
    change,
  )

// NOTE: the Pan from the fridge goes in the melee slot, in hand, and both
// guns stay. A second Pan never comes out of the fridge (the weapon a
// player carries is never pulled again), so a Pan already there only gets
// banged flat, its upgrades kept.
export const takePan = (player: Player, fresh: CarriedGun): Player =>
  modifyFields(player, {
    melee: () =>
      Melee.Pan({
        pan: Option.match(maybePanOf(player), {
          onNone: () => fresh,
          onSome: pan =>
            modifyFields(pan, {
              loaded: () => magazineOf(pan.kind, pan.tier),
              rounds: () => magazineOf(pan.kind, pan.tier),
            }),
        }),
      }),
    wield: () => 'Melee',
  })

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
export const drawSlot = (player: Player, slot: GunSlot): Player => {
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
}

// NOTE: Q. With the melee weapon out it goes back to the last gun held;
// with a gun in hand it switches to the other gun.
export const swapInHand = (player: Player): Player =>
  isWieldingMelee(player)
    ? modifyFields(player, { wield: () => 'Gun' })
    : drawSlot(player, heldSlotOf(swapWeapon(player.arsenal)))

// NOTE: a gun that runs dry with nothing left to load hands over to the
// other gun if that one can still fire. With every gun dry the melee
// weapon (the knife or the Pan) comes out by itself, and Rattles' ammo is
// what brings a gun back.
export const handOverWhenDry = (player: Player): Player => {
  if (Option.exists(maybeOtherGun(player.arsenal), hasRoundsLeft)) {
    return modifyFields(player, { arsenal: swapWeapon })
  } else if (Array.every(gunsOf(player.arsenal), gun => !hasRoundsLeft(gun))) {
    return drawMelee(player)
  } else {
    return player
  }
}

// NOTE: the Pop Pistol as a run starts with it, in the first slot.
export const STARTING_PISTOL: CarriedGun = freshGun(SIDEARM)
