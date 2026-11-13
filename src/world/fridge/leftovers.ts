import { Array, Function, Option, Record, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { nextRandom } from '../../shared/prng'
import {
  freshGun,
  isCarrying,
  putGunInHand,
  takeGun,
  takePan,
} from '../gear/weapons'
import { maxHpOf } from '../heroes/calling'
import { grantKeys, heldKeys, spendKeys } from '../keys/keys'
import { isKitchenOpen } from '../kitchen/kitchen'
import { type Level, levelOf } from '../level/arena'
import { boxAround } from '../level/exits'
import {
  type Box,
  COVER_SYMBOLS,
  distanceToBox,
  tileBox,
  tilesWithSymbol,
} from '../level/tileGrid'
import { atSeat, focusOf, maybePlayerAt, seatStateAt } from '../party/party'
import { activeModifiersOf } from '../run/dareLadder'
import { isKitchenTourOn } from '../run/tutorialRules'
import type { World } from '../schema/world'
import {
  type Fridge,
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  Phase,
  type Player,
  type PlayerSlot,
  Purchasable,
  type WeaponKind,
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { dropCharge, isFridgeWeapon } from './fridgeWeapons'

// Mystery Leftovers (GAME_DESIGN.md): a grimy fridge against the kitchen's
// back wall. Once the kitchen is open it is for sale any time the round
// runs, through the hold to buy (src/world/shop/purchase.ts): hold the interact key at
// its door and two skeleton keys come off the crew's ring
// (src/world/keys/keys.ts), the door creaks open in a puff of green
// fog, and the prize pops up and flies to whoever pulled. Its prizes are
// the fridge-only weapons (src/world/fridge/fridgeWeapons.ts), the Cooker and Brain
// Freeze into a gun slot as a bought gun goes and the Clang Pan into the
// melee slot in place of the knife, or a gag: a moldy Sandwich that heals a
// heart, or a Dud that burps one key back. A weapon arrives fresh, at tier
// 0, and levels on its own kills. After
// three or four pulls it slams shut with a rumble for a while, and the rare
// prize comes a little more often after each slam.
//
// The pull draws from the fridge's own stream (`fridgeRngState` in the
// World's loot), so it never changes the drops or which zombies come.

type FridgeRules = Readonly<{
  keys: number
  dudRefund: number
  reachPx: number
  tagDropPx: number
  openMs: number
  slamMs: number
  pullsBeforeSlam: number
  maxPulls: number
  slamChance: number
  luckBoost: number
  maxLuck: number
  offerMs: number
  leavePx: number
}>

// NOTE: two keys a pull, and the Dud gives one back (docs/ESCAPE_PLAN.md,
// "Key costs and drops"): starting points, not tuned on the balance bot yet.
export const FRIDGE_RULES: FridgeRules = {
  keys: 2,
  dudRefund: 1,
  reachPx: 14,
  tagDropPx: 4,
  openMs: 1100,
  slamMs: 30_000,
  pullsBeforeSlam: 3,
  maxPulls: 4,
  slamChance: 0.5,
  luckBoost: 3,
  maxLuck: 4,
  offerMs: 6000,
  leavePx: 40,
}

// NOTE: out of 100 on a first pull. Brain Freeze, the rare one, is 8.5 in
// 100, and each slam adds 3 more, up to 20; the gags are about one pull in
// seven. The Dud went from 9 to 4 (owner, 2026-11-02), its 5 shared out to
// the weapons by their weights (36, 36, 8). The weapon the puller already
// carries is never pulled again: its share goes to the rest.
export const PRIZE_WEIGHTS: Readonly<Record<FridgePrize, number>> = {
  Cooker: 38.25,
  Pan: 38.25,
  Freeze: 8.5,
  Sandwich: 11,
  Dud: 4,
}

export const PRIZE_ORDER: ReadonlyArray<FridgePrize> = [
  'Cooker',
  'Pan',
  'Freeze',
  'Sandwich',
  'Dud',
]

// NOTE: the gag that burps a key back: the Dud, so it never feels like a
// total loss. The Sandwich's heart is its own reward.
export const refundOf = (prize: FridgePrize): number =>
  prize === 'Dud' ? FRIDGE_RULES.dudRefund : 0

const weaponOf = (prize: FridgePrize): Option.Option<WeaponKind> =>
  prize === 'Cooker' || prize === 'Pan' || prize === 'Freeze'
    ? Option.some(prize)
    : Option.none()

const isCarried = (player: Player, prize: FridgePrize): boolean =>
  Option.exists(weaponOf(prize), kind => isCarrying(player, kind))

export const prizeWeights: {
  (
    player: Player,
  ): (fridge: Fridge) => ReadonlyArray<readonly [FridgePrize, number]>
  (
    fridge: Fridge,
    player: Player,
  ): ReadonlyArray<readonly [FridgePrize, number]>
} = Function.dual(
  2,
  (
    fridge: Fridge,
    player: Player,
  ): ReadonlyArray<readonly [FridgePrize, number]> =>
    Array.map(PRIZE_ORDER, prize => {
      const base = PRIZE_WEIGHTS[prize]
      const lucky =
        prize === 'Freeze'
          ? base +
            FRIDGE_RULES.luckBoost * Math.min(FRIDGE_RULES.maxLuck, fridge.luck)
          : base
      return [prize, isCarried(player, prize) ? 0 : lucky] as const
    }),
)

// NOTE: a Glass run (src/world/run/modifiers.ts) pulls no Sandwich: one heart is
// one heart. Its share goes to the rest, as a carried weapon's does.
const withoutHealing = (
  weights: ReadonlyArray<readonly [FridgePrize, number]>,
): ReadonlyArray<readonly [FridgePrize, number]> =>
  Array.map(
    weights,
    ([prize, weight]) => [prize, prize === 'Sandwich' ? 0 : weight] as const,
  )

// NOTE: the kitchen tour's free pull shows off a weapon, never a gag: the
// same draw from the fridge's own stream, against the weapons' weights alone,
// so it never shifts the waves or the drops.
const weaponsOnly = (
  weights: ReadonlyArray<readonly [FridgePrize, number]>,
): ReadonlyArray<readonly [FridgePrize, number]> =>
  Array.map(
    weights,
    ([prize, weight]) =>
      [prize, isFridgePrizeWeapon(prize) ? weight : 0] as const,
  )

// NOTE: the odds the seat at `slot` would pull with right now, as each
// prize's share of 1: what the fridge door's odds card shows.
export const prizeOddsFor: {
  (
    slot: PlayerSlot,
  ): (world: World) => ReadonlyArray<readonly [FridgePrize, number]>
  (
    world: World,
    slot: PlayerSlot,
  ): ReadonlyArray<readonly [FridgePrize, number]>
} = Function.dual(
  2,
  (
    world: World,
    slot: PlayerSlot,
  ): ReadonlyArray<readonly [FridgePrize, number]> => {
    const weights = weightsFor(world, slot)
    const total = Array.reduce(weights, 0, (sum, [, weight]) => sum + weight)
    return Array.map(
      weights,
      ([prize, weight]) => [prize, total > 0 ? weight / total : 0] as const,
    )
  },
)

const weightsFor = (
  world: World,
  slot: PlayerSlot,
): ReadonlyArray<readonly [FridgePrize, number]> => {
  const offered = prizeWeights(world.fridge, seatStateAt(world, slot).player)
  const weights = activeModifiersOf(world).glass
    ? withoutHealing(offered)
    : offered
  return isKitchenTourOn(world) ? weaponsOnly(weights) : weights
}

// NOTE: a roll from 0 to 1 against the weights, in their order.
export const pickPrize: {
  (
    roll: number,
  ): (weights: ReadonlyArray<readonly [FridgePrize, number]>) => FridgePrize
  (
    weights: ReadonlyArray<readonly [FridgePrize, number]>,
    roll: number,
  ): FridgePrize
} = Function.dual(
  2,
  (
    weights: ReadonlyArray<readonly [FridgePrize, number]>,
    roll: number,
  ): FridgePrize => {
    const total = Array.reduce(weights, 0, (sum, [, weight]) => sum + weight)
    const target = roll * total
    return pipe(
      weights,
      Array.reduce(
        { at: 0, maybePrize: Option.none<FridgePrize>() },
        (walk, [prize, weight]) =>
          Option.isSome(walk.maybePrize) || weight <= 0
            ? walk
            : target < walk.at + weight
              ? { at: walk.at + weight, maybePrize: Option.some(prize) }
              : { at: walk.at + weight, maybePrize: walk.maybePrize },
      ),
      ({ maybePrize }) =>
        Option.getOrElse(
          maybePrize,
          () =>
            Option.getOrElse(
              Array.findLast(weights, ([, weight]) => weight > 0),
              () => ['Dud', 1] as const,
            )[0],
        ),
    )
  },
)

// WHERE

const FRIDGE_SYMBOL = pipe(
  Record.toEntries(COVER_SYMBOLS),
  Array.findFirst(([, kind]) => kind === 'Fridge'),
  Option.map(([symbol]) => symbol),
  Option.getOrElse(() => 'Z'),
)

const fridgeBoxes = new WeakMap<Level, Option.Option<Box>>()

// NOTE: the fridge's tiles on the map; a level keeps its box.
export const fridgeBoxOf = (level: Level): Option.Option<Box> => {
  const cached = fridgeBoxes.get(level)
  if (cached !== undefined) {
    return cached
  }
  const box = boxAround(
    Array.map(tilesWithSymbol(level, FRIDGE_SYMBOL), tileBox),
  )
  fridgeBoxes.set(level, box)
  return box
}

// NOTE: for sale once the kitchen is open, in a break or mid-wave, while
// the door is shut. Never for a Broke run: there are no pulls.
const isFridgeForSale = (world: World): boolean =>
  !activeModifiersOf(world).broke &&
  Phase.isAnyOf(['Preparation', 'Wave'])(world.phase) &&
  isKitchenOpen(levelOf(world)) &&
  FridgeDoor.isAnyOf(['Shut'])(world.fridge.door)

export const fridgeSpot = (box: Box) => ({
  x: Math.round((box.left + box.right) / 2),
  y: box.top + FRIDGE_RULES.tagDropPx,
})

// NOTE: a weapon on offer is the puller's alone to take, for nothing: the
// pull already paid for it.
const isOfferedTo = (world: World, slot: PlayerSlot): boolean =>
  FridgeDoor.isAnyOf(['Offering'])(world.fridge.door) &&
  world.fridge.door.slot === slot

// NOTE: the kitchen tour's pull is free (src/world/run/tutorialRules.ts);
// every other costs FRIDGE_RULES.keys.
export const fridgePriceFor = (world: World): number =>
  isKitchenTourOn(world) ? 0 : FRIDGE_RULES.keys

export const fridgeOffers: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<Offer>
  (world: World, slot: PlayerSlot): ReadonlyArray<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): ReadonlyArray<Offer> =>
  Option.match(fridgeBoxOf(levelOf(world)), {
    onNone: () => [],
    onSome: box =>
      isFridgeForSale(world)
        ? [
            {
              target: Purchasable.Fridge(),
              price: fridgePriceFor(world),
              box,
              reachPx: FRIDGE_RULES.reachPx,
              isFull: false,
              spot: fridgeSpot(box),
            },
          ]
        : isOfferedTo(world, slot)
          ? [
              {
                target: Purchasable.Prize(),
                price: 0,
                box,
                reachPx: FRIDGE_RULES.reachPx,
                isFull: false,
                spot: fridgeSpot(box),
              },
            ]
          : [],
  }),
)

// THE PULL

// NOTE: a fridge weapon arrives at tier 0 with no kills of its own, and
// levels on its own kills like any gun (src/world/gear/gunLevels.ts). The
// gun it replaces takes its kills and tier with it.
// NOTE: the Cooker and Brain Freeze go in a gun slot, as a bought gun
// does. The Pan goes in the melee slot in place of the knife and both guns
// stay; a reload of the last gun carries on, as it does with the knife out.
export const giveWeapon: {
  (kind: WeaponKind): (player: Player) => Player
  (player: Player, kind: WeaponKind): Player
} = Function.dual(2, (player: Player, kind: WeaponKind): Player =>
  kind === 'Pan'
    ? modifyFields(takePan(dropCharge(player), freshGun(kind)), {
        fireCooldownMs: () => 0,
      })
    : modifyFields(dropCharge(putGunInHand(player)), {
        arsenal: arsenal => takeGun(arsenal, freshGun(kind, player.calling)),
        wield: () => 'Gun',
        fireCooldownMs: () => 0,
      }),
)

// NOTE: a gag resolves at once: the Sandwich heals a heart, and the Dud
// burps a key back onto the ring. A weapon waits on offer in the door.
const givePrize = (world: World, slot: PlayerSlot, prize: FridgePrize): World =>
  Option.match(weaponOf(prize), {
    onSome: () => world,
    onNone: () => {
      const at = {
        x: seatStateAt(world, slot).player.x,
        y: seatStateAt(world, slot).player.y,
      }
      return grantKeys(
        modifyFields(world, {
          seats: atSeat(slot, {
            player: player =>
              prize === 'Sandwich'
                ? modifyFields(player, {
                    hp: hp => Math.min(maxHpOf(player), hp + 1),
                  })
                : player,
          }),
          frameEvents: frameEvents => [
            ...frameEvents,
            GameEvent.DudBurped({ ...at, refund: refundOf(prize) }),
          ],
        }),
        refundOf(prize),
        at,
      )
    },
  })

// NOTE: the pull: the keys come off the ring, the prize drawn from the fridge's own
// stream and given to the seat that held, and the door swings open.
export const pullFridge: {
  (slot: PlayerSlot, price: number): (world: World) => Option.Option<World>
  (world: World, slot: PlayerSlot, price: number): Option.Option<World>
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, price: number): Option.Option<World> => {
    if (!isFridgeForSale(world) || heldKeys(world) < price) {
      return Option.none()
    }
    return Option.map(fridgeBoxOf(levelOf(world)), box => {
      const draw = nextRandom(world.loot.fridgeRngState)
      const prize = pickPrize(weightsFor(world, slot), draw.value)
      const spot = fridgeSpot(box)
      const paid = modifyFields(spendKeys(world, price), {
        loot: loot =>
          modifyFields(loot, { fridgeRngState: () => draw.nextState }),
        fridge: fridge =>
          modifyFields(fridge, {
            pulls: pulls => pulls + 1,
            door: () =>
              FridgeDoor.Open({
                prize,
                slot,
                remainingMs: FRIDGE_RULES.openMs,
                durationMs: FRIDGE_RULES.openMs,
              }),
          }),
        frameEvents: frameEvents => [
          ...frameEvents,
          GameEvent.FridgeOpened({ x: spot.x, y: spot.y, prize }),
        ],
      })
      return givePrize(paid, slot, prize)
    })
  },
)

// NOTE: after a pull the door shuts, unless that was the batch's last: the
// third pull slams it half the time and the fourth always does.
const shut = (world: World): World => {
  const { pulls } = world.fridge
  const draw = nextRandom(world.loot.fridgeRngState)
  const isLast =
    pulls >= FRIDGE_RULES.maxPulls ||
    (pulls >= FRIDGE_RULES.pullsBeforeSlam &&
      draw.value < FRIDGE_RULES.slamChance)
  const rolled =
    pulls >= FRIDGE_RULES.pullsBeforeSlam && pulls < FRIDGE_RULES.maxPulls
      ? modifyFields(world, {
          loot: loot =>
            modifyFields(loot, { fridgeRngState: () => draw.nextState }),
        })
      : world
  if (!isLast) {
    return modifyFields(rolled, {
      fridge: fridge => modifyFields(fridge, { door: () => FridgeDoor.Shut() }),
    })
  }
  const spot = Option.match(fridgeBoxOf(levelOf(world)), {
    onNone: () => ({ x: focusOf(world).player.x, y: focusOf(world).player.y }),
    onSome: fridgeSpot,
  })
  return modifyFields(rolled, {
    fridge: fridge =>
      modifyFields(fridge, {
        door: () =>
          FridgeDoor.Slammed({
            remainingMs: FRIDGE_RULES.slamMs,
            durationMs: FRIDGE_RULES.slamMs,
          }),
        pulls: () => 0,
        luck: luck => luck + 1,
      }),
    frameEvents: frameEvents => [
      ...frameEvents,
      GameEvent.FridgeSlammed({ x: spot.x, y: spot.y }),
    ],
  })
}

const spotOf = (world: World) =>
  Option.match(fridgeBoxOf(levelOf(world)), {
    onNone: () => ({ x: focusOf(world).player.x, y: focusOf(world).player.y }),
    onSome: fridgeSpot,
  })

// NOTE: take it: the puller holds at the door and the weapon is theirs: a
// gun slot for the Cooker or Brain Freeze, the melee slot for the Pan.
export const takePrize: {
  (slot: PlayerSlot): (world: World) => Option.Option<World>
  (world: World, slot: PlayerSlot): Option.Option<World>
} = Function.dual(2, (world: World, slot: PlayerSlot): Option.Option<World> =>
  isOfferedTo(world, slot) &&
  FridgeDoor.isAnyOf(['Offering'])(world.fridge.door)
    ? Option.map(weaponOf(world.fridge.door.prize), kind => {
        const spot = spotOf(world)
        return shut(
          modifyFields(world, {
            seats: atSeat(slot, {
              player: player => giveWeapon(player, kind),
            }),
            frameEvents: frameEvents => [
              ...frameEvents,
              GameEvent.PrizeTaken({ x: spot.x, y: spot.y }),
            ],
          }),
        )
      })
    : Option.none(),
)

// NOTE: leave it: the puller walked off or the time ran out, and the
// weapon sinks back into the fridge. The pull stays paid.
const leavePrize = (world: World): World => {
  const spot = spotOf(world)
  return shut(
    modifyFields(world, {
      frameEvents: frameEvents => [
        ...frameEvents,
        GameEvent.PrizeLeft({ x: spot.x, y: spot.y }),
      ],
    }),
  )
}

const hasWalkedOff = (world: World, slot: number): boolean =>
  Option.match(maybePlayerAt(world, slot), {
    onNone: () => true,
    onSome: ({ player }) =>
      Option.exists(
        fridgeBoxOf(levelOf(world)),
        box => distanceToBox(player, box) > FRIDGE_RULES.leavePx,
      ),
  })

const afterReveal = (world: World, prize: FridgePrize, slot: number): World =>
  Option.isSome(weaponOf(prize))
    ? modifyFields(world, {
        fridge: fridge =>
          modifyFields(fridge, {
            door: () =>
              FridgeDoor.Offering({
                prize,
                slot,
                remainingMs: FRIDGE_RULES.offerMs,
                durationMs: FRIDGE_RULES.offerMs,
              }),
          }),
      })
    : shut(world)

// NOTE: one tick of the fridge's door, while the round runs.
export const advanceFridge: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  FridgeDoor.match(world.fridge.door, {
    Shut: () => world,
    Open: door =>
      door.remainingMs > deltaMs
        ? modifyFields(world, {
            fridge: fridge =>
              modifyFields(fridge, {
                door: () =>
                  FridgeDoor.Open({
                    ...door,
                    remainingMs: door.remainingMs - deltaMs,
                  }),
              }),
          })
        : afterReveal(world, door.prize, door.slot),
    Offering: door =>
      door.remainingMs <= deltaMs || hasWalkedOff(world, door.slot)
        ? leavePrize(world)
        : modifyFields(world, {
            fridge: fridge =>
              modifyFields(fridge, {
                door: () =>
                  FridgeDoor.Offering({
                    ...door,
                    remainingMs: door.remainingMs - deltaMs,
                  }),
              }),
          }),
    Slammed: ({ remainingMs, durationMs }) =>
      modifyFields(world, {
        fridge: fridge =>
          modifyFields(fridge, {
            door: () =>
              remainingMs > deltaMs
                ? FridgeDoor.Slammed({
                    remainingMs: remainingMs - deltaMs,
                    durationMs,
                  })
                : FridgeDoor.Shut(),
          }),
      }),
  }),
)

export const isFridgePrizeWeapon = (prize: FridgePrize): boolean =>
  Option.exists(weaponOf(prize), isFridgeWeapon)
