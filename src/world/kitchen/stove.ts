import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Calling } from '../../shared/playerData'
import { nextRandom } from '../../shared/prng'
import { type FeatLock, hasDone } from '../feats/feats'
import {
  carriedMagazine,
  heldGun,
  isCookable,
  isWieldingMelee,
  mapHeld,
} from '../gear/weapons'
import { stoveKillsFor } from '../heroes/calling'
import { heldKeys, spendKeys } from '../keys/keys'
import { type Box, levelOf } from '../level/arena'
import { atSeat, seatStateAt } from '../party/party'
import { type World, modifyWorldFields } from '../schema/world'
import {
  type CarriedGun,
  Feat,
  type GunPerk,
  Phase,
  type Player,
  type PlayerSlot,
  Purchasable,
  type Vector,
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { isKitchenOpen, ovenBoxesOf } from './kitchen'

// The kitchen's stove bench (owner, 2026-11-02): one of the two stoves
// cooks the gun in a player's hands into a perk for the rest of the run.
// Each break it offers one perk, rolled from its own generator, shown on its
// tag over the stove. It is never bought (owner, 2026-11-10): it opens for a
// player by a feat (src/world/feats/feats.ts), 15 kills in the kitchen in the
// last wave and this break, and they cook by the same stand or hold as the
// boards and the fridge (src/world/shop/purchase.ts), with a longer hold,
// once a break. The perks themselves are in src/world/gear/weapons.ts
// (PERK_RULES).

type StoveRules = Readonly<{
  kitchenKills: number
  holdMs: number
  reachPx: number
  tagDropPx: number
  ovenIndex: number
}>

// NOTE: `ovenIndex` picks the stove from the level's ovens in reading
// order: the east one, by the back door, so a cook is a little risky.
// `holdMs` is the key's one second; standing takes twice that, two.
export const STOVE_RULES: StoveRules = {
  kitchenKills: 15,
  holdMs: 1000,
  reachPx: 14,
  tagDropPx: 2,
  ovenIndex: 1,
}

// NOTE: the feat that lights the stove for a player: the Line Cook's asks
// for half the kills (src/world/heroes/calling.ts, stoveKillsFor).
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

// NOTE: whether the seat at `slot` has earned a cook this break.
const hasStoveFeat: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean =>
  hasDone(world, slot, stoveFeatOf(seatStateAt(world, slot).player.calling)),
)

// NOTE: only a gun Rattles sells, in the player's hands, cooks: never the
// knife, the Clang Pan, or a fridge weapon.
const canCook = (player: Player): boolean =>
  !isWieldingMelee(player) && isCookable(heldGun(player.arsenal).kind)

const stoveSpotOf = (box: Box): Vector => ({
  x: Math.round((box.left + box.right) / 2),
  y: box.top + STOVE_RULES.tagDropPx,
})

// NOTE: the stove a seat has not earned this break yet: its feat, and the
// spot its lock hangs from.
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
      () => !hasCookedThisBreak(world, slot) && !hasStoveFeat(world, slot),
    ),
)

export const stoveOffers: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<Offer>
  (world: World, slot: PlayerSlot): ReadonlyArray<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): ReadonlyArray<Offer> =>
  Option.match(
    Option.filter(
      Option.zipWith(maybeStovePerk(world), stoveBoxOf(world), (_, box) => box),
      () => !hasCookedThisBreak(world, slot) && hasStoveFeat(world, slot),
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
      const { player } = seatStateAt(world, slot)
      if (
        hasCookedThisBreak(world, slot) ||
        !hasStoveFeat(world, slot) ||
        !canCook(player) ||
        heldKeys(world) < price
      ) {
        return Option.none()
      }
      const wave = world.stove.wave
      return Option.some(
        modifyFields(spendKeys(world, price), {
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
