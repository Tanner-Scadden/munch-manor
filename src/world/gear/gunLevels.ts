import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { isCoop, maybePlayerAt, modifySeat } from '../party/party'
import type { World } from '../schema/world'
import {
  type CarriedGun,
  GameEvent,
  type Player,
  type PlayerSlot,
  SOLO_SLOT,
  type WeaponKind,
} from '../schema/worldSchema'
import {
  UPGRADE_TIERS,
  carriedMagazine,
  mapCarried,
  maxTier,
  maybeCarried,
} from './weapons'

// Guns level up with kills (docs/ESCAPE_PLAN.md, "Guns level up with
// kills"): each carried gun counts the kills it made, and its tier is the
// number of thresholds in UPGRADE_TIERS (src/world/gear/weapons.ts) those
// kills have passed. The knife never levels; a gun's own kills stay with it
// while it is carried, swapped out or not, and go with it when it is
// dropped or replaced.

// THE LADDER

export const tierForKills: {
  (kills: number): (kind: WeaponKind) => number
  (kind: WeaponKind, kills: number): number
} = Function.dual(
  2,
  (kind: WeaponKind, kills: number): number =>
    Array.filter(UPGRADE_TIERS[kind], tier => kills >= tier.kills).length,
)

// NOTE: how far a gun is from its last tier to its next, 0 to 1, for the
// HUD slot's bar. None once it is at its top tier, or for a gun with no
// tiers (Brain Freeze, the gnome's pea shooter).
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

// NOTE: a gun at a new tier holds the extra rounds its bigger magazine
// brings (the Pan its deeper dent meter), so a level up never reads as a
// magazine gone short.
const levelGun = (gun: CarriedGun, calling: Player['calling']): CarriedGun => {
  const kills = gun.kills
  const tier = Math.min(maxTier(gun.kind), tierForKills(gun.kind, kills))
  if (tier <= gun.tier) {
    return gun
  }
  const leveled = modifyFields(gun, { tier: () => tier })
  const grown =
    carriedMagazine(calling, leveled) - carriedMagazine(calling, gun)
  return modifyFields(leveled, {
    loaded: loaded => loaded + Math.max(0, grown),
  })
}

const tierCarried = (player: Player, kind: WeaponKind): number =>
  Option.match(maybeCarried(player, kind), {
    onNone: () => 0,
    onSome: gun => gun.tier,
  })

// CREDIT

// NOTE: `kills` more kills for the gun of `kind` the seat at `slot`
// carries, in either gun slot or the melee slot. A gun no longer carried
// (dropped while its bullet flew) gets nothing.
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
                    modifyFields(gun, { kills: count => count + kills }),
                    player.calling,
                  )
                : gun,
            )
            const withGun = modifySeat(world, slot, { player: () => credited })
            const tier = tierCarried(credited, kind)
            return tier > tierCarried(player, kind)
              ? modifyFields(withGun, {
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

// NOTE: the killer of a kill: the seat a shot or strike names, or single
// player's one seat when it names none.
export const killerSlotOf: {
  (maybeSlot: Option.Option<PlayerSlot>): (world: World) => PlayerSlot
  (world: World, maybeSlot: Option.Option<PlayerSlot>): PlayerSlot
} = Function.dual(
  2,
  (world: World, maybeSlot: Option.Option<PlayerSlot>): PlayerSlot =>
    isCoop(world) ? Option.getOrElse(maybeSlot, () => SOLO_SLOT) : SOLO_SLOT,
)
