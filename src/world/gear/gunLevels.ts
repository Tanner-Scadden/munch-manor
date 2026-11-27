import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  isCoop,
  maybePlayerAt,
  modifySeat,
  seatStateAt,
} from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  type CarriedGun,
  GameEvent,
  type Player,
  type PlayerSlot,
  SOLO_SLOT,
  type WeaponKind,
} from '#world/schema/worldSchema.ts'

import {
  UPGRADE_TIERS,
  carriedMagazine,
  mapCarried,
  maxTier,
  maybeCarried,
  tierName,
  tierOf,
} from './weapons.ts'

export const gunName: {
  (slot: PlayerSlot, weapon: WeaponKind): (model: World) => string
  (model: World, slot: PlayerSlot, weapon: WeaponKind): string
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, weapon: WeaponKind): string =>
    tierName(weapon, tierOf(seatStateAt(model, slot).player, weapon)),
)

export const tierForKills: {
  (kills: number): (kind: WeaponKind) => number
  (kind: WeaponKind, kills: number): number
} = Function.dual(
  2,
  (kind: WeaponKind, kills: number): number =>
    Array.filter(UPGRADE_TIERS[kind], tier => kills >= tier.kills).length,
)

export const maybeLevelProgress = (gun: CarriedGun): Option.Option<number> =>
  pipe(
    Array.get(UPGRADE_TIERS[gun.kind], gun.tier),
    Option.map(next => {
      const from = pipe(
        Array.get(UPGRADE_TIERS[gun.kind], gun.tier - 1),
        Option.match({ onNone: () => 0, onSome: ({ kills }) => kills }),
      )
      return Math.max(
        0,
        Math.min(1, (gun.kills - from) / Math.max(1, next.kills - from)),
      )
    }),
  )

export const maybeNextLevelKills = (gun: CarriedGun): Option.Option<number> =>
  pipe(
    Array.get(UPGRADE_TIERS[gun.kind], gun.tier),
    Option.map(({ kills }) => kills),
  )

const levelGun = (gun: CarriedGun, calling: Player['calling']): CarriedGun => {
  const kills = gun.kills
  const tier = Math.min(maxTier(gun.kind), tierForKills(gun.kind, kills))
  if (tier <= gun.tier) {
    return gun
  }
  const leveled = UiStruct.evolve(gun, { tier: () => tier })
  const grown =
    carriedMagazine(calling, leveled) - carriedMagazine(calling, gun)
  return UiStruct.evolve(leveled, {
    loaded: loaded => loaded + Math.max(0, grown),
  })
}

const tierCarried = (player: Player, kind: WeaponKind): number =>
  Option.match(maybeCarried(player, kind), {
    onNone: () => 0,
    onSome: gun => gun.tier,
  })

export const creditGunKills: {
  (slot: PlayerSlot, kind: WeaponKind, kills: number): (world: World) => World
  (world: World, slot: PlayerSlot, kind: WeaponKind, kills: number): World
} = Function.dual(
  4,
  (world: World, slot: PlayerSlot, kind: WeaponKind, kills: number): World =>
    kills <= 0
      ? world
      : Option.match(maybePlayerAt(world, slot), {
          onNone: () => world,
          onSome: ({ player }) => {
            const credited = mapCarried(player, gun =>
              gun.kind === kind
                ? levelGun(
                    UiStruct.evolve(gun, { kills: count => count + kills }),
                    player.calling,
                  )
                : gun,
            )
            const withGun = modifySeat(world, slot, { player: () => credited })
            const tier = tierCarried(credited, kind)
            return tier > tierCarried(player, kind)
              ? UiStruct.evolve(withGun, {
                  frameEvents: Array.append(
                    GameEvent.GunLeveled({
                      x: player.x,
                      y: player.y,
                      slot,
                      weapon: kind,
                      tier,
                    }),
                  ),
                })
              : withGun
          },
        }),
)

export const killerSlotOf: {
  (maybeSlot: Option.Option<PlayerSlot>): (world: World) => PlayerSlot
  (world: World, maybeSlot: Option.Option<PlayerSlot>): PlayerSlot
} = Function.dual(
  2,
  (world: World, maybeSlot: Option.Option<PlayerSlot>): PlayerSlot =>
    isCoop(world) ? Option.getOrElse(maybeSlot, () => SOLO_SLOT) : SOLO_SLOT,
)
