import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { nextRandom } from '../../shared/prng'
import {
  carriedMagazine,
  heldGun,
  isCookable,
  isWieldingMelee,
  mapHeld,
} from '../gear/weapons'
import { type Box, levelOf } from '../level/arena'
import { spendOn } from '../level/exits'
import { atSeat, seatStateAt } from '../party/party'
import { type World, modifyWorldFields } from '../schema/world'
import {
  type CarriedGun,
  type GunPerk,
  Phase,
  type Player,
  type PlayerSlot,
  Purchasable,
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { isKitchenOpen, ovenBoxesOf } from './kitchen'

// The kitchen's stove bench (owner, 2026-11-02): one of the two stoves
// cooks the gun in a player's hands into a perk for the rest of the run,
// one Rattles never sells. Each break it offers one perk, rolled from its
// own generator, shown on its tag over the stove. A player cooks by the
// same stand or hold to buy as the boards and the fridge (src/world/shop/purchase.ts),
// with a longer hold, once a break, at a price that climbs with each cook.
// The perks themselves are in src/world/gear/weapons.ts (PERK_RULES).

type StoveRules = Readonly<{
  prices: Array.NonEmptyReadonlyArray<number>
  holdMs: number
  reachPx: number
  tagDropPx: number
  ovenIndex: number
}>

// NOTE: `ovenIndex` picks the stove from the level's ovens in reading
// order: the east one, by the back door, so a cook is a little risky.
// `holdMs` is the key's one second; standing takes twice that, two.
export const STOVE_RULES: StoveRules = {
  prices: [90, 180, 300],
  holdMs: 1000,
  reachPx: 14,
  tagDropPx: 2,
  ovenIndex: 1,
}

const PERKS: Array.NonEmptyReadonlyArray<GunPerk> = [
  'Spicy',
  'Crispy',
  'Hearty',
]

export const stoveBoxOf = (world: World): Option.Option<Box> =>
  Array.get(ovenBoxesOf(levelOf(world)), STOVE_RULES.ovenIndex)

// THE OFFER

// NOTE: each break rolls the stove's perk once, as the break begins, from
// the stove's own generator, so the run's other rolls never move.
export const rollStove = <M extends World>(world: M): M => {
  const { phase, stove } = world
  if (!Phase.isAnyOf(['Preparation'])(phase) || stove.wave === phase.wave) {
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

// NOTE: the perk on offer right now: in a break with the kitchen open,
// once the break has rolled it.
export const maybeStovePerk = (world: World): Option.Option<GunPerk> =>
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  isKitchenOpen(levelOf(world)) &&
  world.stove.wave === world.phase.wave
    ? Option.some(world.stove.perk)
    : Option.none()

const hasCookedThisBreak = (world: World, slot: PlayerSlot): boolean =>
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  seatStateAt(world, slot).cooking.lastWave === world.phase.wave

const cookPriceFor = (world: World, slot: PlayerSlot): number => {
  const { prices } = STOVE_RULES
  return Option.getOrElse(
    Array.get(prices, seatStateAt(world, slot).cooking.cooks),
    () => Array.lastNonEmpty(prices),
  )
}

// NOTE: only a gun Rattles sells, in the player's hands, cooks: never the
// knife, the Clang Pan, or a fridge weapon.
const canCook = (player: Player): boolean =>
  !isWieldingMelee(player) && isCookable(heldGun(player.arsenal).kind)

export const stoveOffers: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<Offer>
  (world: World, slot: PlayerSlot): ReadonlyArray<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): ReadonlyArray<Offer> =>
  Option.match(
    Option.filter(
      Option.zipWith(maybeStovePerk(world), stoveBoxOf(world), (_, box) => box),
      () => !hasCookedThisBreak(world, slot),
    ),
    {
      onNone: () => [],
      onSome: box => [
        {
          target: Purchasable.Stove(),
          price: cookPriceFor(world, slot),
          box,
          reachPx: STOVE_RULES.reachPx,
          isFull: !canCook(seatStateAt(world, slot).player),
          spot: {
            x: Math.round((box.left + box.right) / 2),
            y: box.top + STOVE_RULES.tagDropPx,
          },
        },
      ],
    },
  ),
)

// THE COOK

// NOTE: a gun holds one perk, so a new one takes the old one's place. A
// Hearty gun cooked into another keeps no rounds over its new magazine.
const cooked = (player: Player, perk: GunPerk): Player =>
  modifyFields(player, {
    arsenal: arsenal =>
      mapHeld(arsenal, gun => {
        const withPerk: CarriedGun = { ...gun, perk }
        return modifyFields(withPerk, {
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
      const { player, wallet } = seatStateAt(world, slot)
      if (
        hasCookedThisBreak(world, slot) ||
        !canCook(player) ||
        wallet.balance < price
      ) {
        return Option.none()
      }
      const wave = world.stove.wave
      return Option.some(
        modifyFields(spendOn(world, slot, price), {
          seats: atSeat(slot, {
            player: current => cooked(current, perk),
            cooking: cooking =>
              modifyFields(cooking, {
                cooks: cooks => cooks + 1,
                lastWave: () => wave,
              }),
          }),
        }),
      )
    }),
)
