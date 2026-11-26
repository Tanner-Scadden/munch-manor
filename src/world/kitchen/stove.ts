import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { nextRandom } from '#shared/prng.ts'
import type { Calling } from '#shared/records/playerData.ts'
import { type FeatLock, hasDone } from '#world/feats/feats.ts'
import {
  carriedMagazine,
  heldGun,
  isCookable,
  isWieldingMelee,
  mapHeld,
} from '#world/gear/weapons.ts'
import { stoveKillsFor } from '#world/heroes/calling.ts'
import { heldKeys, spendKeys } from '#world/keys/keys.ts'
import { levelOf } from '#world/level/arena.ts'
import type { Box } from '#world/level/tileGrid.ts'
import { atSeat, seatStateAt } from '#world/party/party.ts'
import { type World, modifyWorldFields } from '#world/schema/world.ts'
import {
  type CarriedGun,
  Feat,
  type GunPerk,
  Phase,
  type Player,
  type PlayerSlot,
  Purchasable,
  type Vector,
} from '#world/schema/worldSchema.ts'
import type { Offer } from '#world/shop/purchase.ts'

import { isKitchenOpen, ovenBoxesOf } from './kitchen.ts'

type StoveRules = Readonly<{
  kitchenKills: number
  holdMs: number
  reachPx: number
  tagDropPx: number
  ovenIndex: number
}>

export const STOVE_RULES: StoveRules = {
  kitchenKills: 15,
  holdMs: 1000,
  reachPx: 14,
  tagDropPx: 2,
  ovenIndex: 1,
}

const stoveFeatOf = (calling: Calling): Feat =>
  Feat.KitchenKills({
    count: stoveKillsFor(calling, STOVE_RULES.kitchenKills),
  })

const PERKS: Array.NonEmptyReadonlyArray<GunPerk> = [
  'Spicy',
  'Crispy',
  'Hearty',
]

export const stoveBoxOf = (world: World): Option.Option<Box> =>
  Array.get(ovenBoxesOf(levelOf(world)), STOVE_RULES.ovenIndex)

export const rollStove = <M extends World>(world: M): M => {
  const { phase, stove } = world
  if (
    !Phase.isAnyOf(['Preparation', 'Wave'])(phase) ||
    stove.wave === phase.wave
  ) {
    return world
  }
  const draw = nextRandom(stove.rngState)
  return modifyWorldFields(world, {
    stove: () => ({
      rngState: draw.nextState,
      perk: Option.getOrElse(
        Array.get(PERKS, Math.floor(draw.value * PERKS.length)),
        () => PERKS[0],
      ),
      wave: phase.wave,
    }),
  })
}

export const maybeStovePerk = (world: World): Option.Option<GunPerk> =>
  Phase.isAnyOf(['Preparation', 'Wave'])(world.phase) &&
  isKitchenOpen(levelOf(world)) &&
  world.stove.wave === world.phase.wave
    ? Option.some(world.stove.perk)
    : Option.none()

const hasCookedThisRound = (world: World, slot: PlayerSlot): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(world.phase) &&
  seatStateAt(world, slot).cooking.lastWave === world.phase.wave

const hasStoveFeat: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean =>
  hasDone(world, slot, stoveFeatOf(seatStateAt(world, slot).player.calling)),
)

const canCook = (player: Player): boolean =>
  !isWieldingMelee(player) && isCookable(heldGun(player.arsenal).kind)

const stoveSpotOf = (box: Box): Vector => ({
  x: Math.round((box.left + box.right) / 2),
  y: box.top + STOVE_RULES.tagDropPx,
})

export const maybeStoveLock: {
  (slot: PlayerSlot): (world: World) => Option.Option<FeatLock>
  (world: World, slot: PlayerSlot): Option.Option<FeatLock>
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): Option.Option<FeatLock> =>
    Option.filter(
      Option.zipWith(maybeStovePerk(world), stoveBoxOf(world), (_, box) => ({
        feat: stoveFeatOf(seatStateAt(world, slot).player.calling),
        spot: stoveSpotOf(box),
      })),
      () => !hasCookedThisRound(world, slot) && !hasStoveFeat(world, slot),
    ),
)

export const stoveOffers: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<Offer>
  (world: World, slot: PlayerSlot): ReadonlyArray<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): ReadonlyArray<Offer> =>
  Option.match(
    Option.filter(
      Option.zipWith(maybeStovePerk(world), stoveBoxOf(world), (_, box) => box),
      () => !hasCookedThisRound(world, slot) && hasStoveFeat(world, slot),
    ),
    {
      onNone: () => [],
      onSome: box => [
        {
          target: Purchasable.Stove(),
          price: 0,
          box,
          reachPx: STOVE_RULES.reachPx,
          isFull: !canCook(seatStateAt(world, slot).player),
          spot: stoveSpotOf(box),
        },
      ],
    },
  ),
)

const cooked = (player: Player, perk: GunPerk): Player =>
  UiStruct.evolve(player, {
    arsenal: arsenal =>
      mapHeld(arsenal, gun => {
        const withPerk: CarriedGun = { ...gun, perk }
        return UiStruct.evolve(withPerk, {
          loaded: loaded =>
            Math.min(loaded, carriedMagazine(player.calling, withPerk)),
        })
      }),
  })

export const cookGun: {
  (slot: PlayerSlot, price: number): (world: World) => Option.Option<World>
  (world: World, slot: PlayerSlot, price: number): Option.Option<World>
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, price: number): Option.Option<World> =>
    Option.flatMap(maybeStovePerk(world), perk => {
      const { player } = seatStateAt(world, slot)
      if (
        hasCookedThisRound(world, slot) ||
        !hasStoveFeat(world, slot) ||
        !canCook(player) ||
        heldKeys(world) < price
      ) {
        return Option.none()
      }
      const wave = world.stove.wave
      return Option.some(
        UiStruct.evolve(spendKeys(world, price), {
          seats: atSeat(slot, {
            player: current => cooked(current, perk),
            cooking: cooking =>
              UiStruct.evolve(cooking, {
                cooks: cooks => cooks + 1,
                lastWave: () => wave,
              }),
          }),
        }),
      )
    }),
)
