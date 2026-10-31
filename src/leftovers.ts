import { Array, Option, Record, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Box,
  COVER_SYMBOLS,
  type Level,
  distanceToBox,
  levelOf,
  tileBox,
  tilesWithSymbol,
} from './arena'
import { PLAYER_MAX_HP } from './constants'
import { boxAround } from './exits'
import { dropCharge, isFridgeWeapon } from './fridgeWeapons'
import { isKitchenOpen } from './kitchen'
import { leadSeatOf, maybePlayerAt } from './party'
import { nextRandom } from './prng'
import type { Offer } from './purchase'
import { isKitchenTourOn } from './tutorialRules'
import { freshGun, isCarrying, putGunInHand, takeGun, takePan } from './weapons'
import type { World } from './world'
import {
  type Fridge,
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  Phase,
  type Player,
  Purchasable,
  type WeaponKind,
} from './worldSchema'

// Mystery Leftovers (GAME_DESIGN.md): a grimy fridge against the kitchen's
// back wall. Once the kitchen is open it is for sale any time the round
// runs, through the hold to buy (src/purchase.ts): hold the interact key at
// its door and the price is paid, the door creaks open in a puff of green
// fog, and the prize pops up and flies to whoever pulled. Its prizes are
// the fridge-only weapons (src/fridgeWeapons.ts), the Cooker and Brain
// Freeze into a gun slot as a bought gun goes and the Clang Pan into the
// melee slot in place of the knife, or a gag: a moldy Sandwich that heals a heart, or a Dud
// that burps half the price back. After three or four pulls it slams shut
// with a rumble for a while, and the rare prize comes a little more often
// after each slam.
//
// The pull draws from the fridge's own stream (`fridgeRngState` in the
// World's loot), so it never changes the drops or which zombies come.

type FridgeRules = Readonly<{
  price: number
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

export const FRIDGE_RULES: FridgeRules = {
  price: 75,
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

// NOTE: out of 100 on a first pull. Brain Freeze, the rare one, is 8 in
// 100, and each slam adds 3 more, up to 20; the gags are one pull in five.
// The weapon the puller already carries is never pulled again: its share
// goes to the rest.
const PRIZE_WEIGHTS: Readonly<Record<FridgePrize, number>> = {
  Cooker: 36,
  Pan: 36,
  Freeze: 8,
  Sandwich: 11,
  Dud: 9,
}

export const PRIZE_ORDER: ReadonlyArray<FridgePrize> = [
  'Cooker',
  'Pan',
  'Freeze',
  'Sandwich',
  'Dud',
]

export const DUD_REFUND = Math.round(FRIDGE_RULES.price / 2)

const weaponOf = (prize: FridgePrize): Option.Option<WeaponKind> =>
  prize === 'Cooker' || prize === 'Pan' || prize === 'Freeze'
    ? Option.some(prize)
    : Option.none()

const isCarried = (player: Player, prize: FridgePrize): boolean =>
  Option.exists(weaponOf(prize), kind => isCarrying(player, kind))

export const prizeWeights = (
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
  })

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

// NOTE: a roll from 0 to 1 against the weights, in their order.
export const pickPrize = (
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
}

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
// the door is shut.
const isFridgeForSale = (world: World): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(world.phase) &&
  isKitchenOpen(levelOf(world)) &&
  FridgeDoor.isAnyOf(['Shut'])(world.fridge.door)

export const fridgeSpot = (box: Box) => ({
  x: Math.round((box.left + box.right) / 2),
  y: box.top + FRIDGE_RULES.tagDropPx,
})

// NOTE: a weapon on offer is the puller's alone to take, for nothing: the
// pull already paid for it.
const isOfferedTo = (world: World): boolean =>
  FridgeDoor.isAnyOf(['Offering'])(world.fridge.door) &&
  world.fridge.door.slot === leadSeatOf(world).slot

// NOTE: the kitchen tour's pull is free (src/tutorialRules.ts).
export const fridgePriceFor = (world: World): number =>
  isKitchenTourOn(world) ? 0 : FRIDGE_RULES.price

export const fridgeOffers = (world: World): ReadonlyArray<Offer> =>
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
        : isOfferedTo(world)
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
  })

// THE PULL

// NOTE: the Cooker and Brain Freeze go in a gun slot, as a bought gun
// does. The Pan goes in the melee slot in place of the knife and both guns
// stay; a reload of the last gun carries on, as it does with the knife out.
const giveWeapon = (player: Player, kind: WeaponKind): Player =>
  kind === 'Pan'
    ? modifyFields(takePan(dropCharge(player), freshGun(kind)), {
        fireCooldownMs: () => 0,
      })
    : modifyFields(dropCharge(putGunInHand(player)), {
        arsenal: arsenal => takeGun(arsenal, freshGun(kind)),
        wield: () => 'Gun',
        fireCooldownMs: () => 0,
      })

// NOTE: a gag resolves at once; a weapon waits on offer in the door.
const givePrize = (world: World, prize: FridgePrize): World =>
  Option.match(weaponOf(prize), {
    onSome: () => world,
    onNone: () =>
      prize === 'Sandwich'
        ? modifyFields(world, {
            player: player =>
              modifyFields(player, {
                hp: hp => Math.min(PLAYER_MAX_HP, hp + 1),
              }),
          })
        : modifyFields(world, {
            wallet: wallet =>
              modifyFields(wallet, {
                balance: balance => balance + DUD_REFUND,
              }),
            frameEvents: frameEvents => [
              ...frameEvents,
              GameEvent.DudBurped({
                x: world.player.x,
                y: world.player.y,
                refund: DUD_REFUND,
              }),
            ],
          }),
  })

// NOTE: the pull: the price is paid, the prize drawn from the fridge's own
// stream and given to the seat that held, and the door swings open.
export const pullFridge = (
  world: World,
  price: number,
): Option.Option<World> => {
  if (!isFridgeForSale(world) || world.wallet.balance < price) {
    return Option.none()
  }
  return Option.map(fridgeBoxOf(levelOf(world)), box => {
    const draw = nextRandom(world.loot.fridgeRngState)
    const weights = prizeWeights(world.fridge, world.player)
    const prize = pickPrize(
      isKitchenTourOn(world) ? weaponsOnly(weights) : weights,
      draw.value,
    )
    const spot = fridgeSpot(box)
    const paid = modifyFields(world, {
      wallet: wallet =>
        modifyFields(wallet, {
          balance: balance => balance - price,
        }),
      stats: stats =>
        modifyFields(stats, { purchases: purchases => purchases + 1 }),
      loot: loot =>
        modifyFields(loot, { fridgeRngState: () => draw.nextState }),
      fridge: fridge =>
        modifyFields(fridge, {
          pulls: pulls => pulls + 1,
          door: () =>
            FridgeDoor.Open({
              prize,
              slot: leadSeatOf(world).slot,
              remainingMs: FRIDGE_RULES.openMs,
              durationMs: FRIDGE_RULES.openMs,
            }),
        }),
      frameEvents: frameEvents => [
        ...frameEvents,
        GameEvent.FridgeOpened({ x: spot.x, y: spot.y, prize }),
      ],
    })
    return givePrize(paid, prize)
  })
}

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
    onNone: () => ({ x: world.player.x, y: world.player.y }),
    onSome: fridgeSpot,
  })
  return modifyFields(rolled, {
    fridge: fridge => ({
      door: FridgeDoor.Slammed({
        remainingMs: FRIDGE_RULES.slamMs,
        durationMs: FRIDGE_RULES.slamMs,
      }),
      pulls: 0,
      luck: fridge.luck + 1,
    }),
    frameEvents: frameEvents => [
      ...frameEvents,
      GameEvent.FridgeSlammed({ x: spot.x, y: spot.y }),
    ],
  })
}

const spotOf = (world: World) =>
  Option.match(fridgeBoxOf(levelOf(world)), {
    onNone: () => ({ x: world.player.x, y: world.player.y }),
    onSome: fridgeSpot,
  })

// NOTE: take it: the puller holds at the door and the weapon is theirs: a
// gun slot for the Cooker or Brain Freeze, the melee slot for the Pan.
export const takePrize = (world: World): Option.Option<World> =>
  isOfferedTo(world) && FridgeDoor.isAnyOf(['Offering'])(world.fridge.door)
    ? Option.map(weaponOf(world.fridge.door.prize), kind => {
        const spot = spotOf(world)
        return shut(
          modifyFields(world, {
            player: player => giveWeapon(player, kind),
            frameEvents: frameEvents => [
              ...frameEvents,
              GameEvent.PrizeTaken({ x: spot.x, y: spot.y }),
            ],
          }),
        )
      })
    : Option.none()

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
export const advanceFridge = (world: World, deltaMs: number): World =>
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
  })

export const isFridgePrizeWeapon = (prize: FridgePrize): boolean =>
  Option.exists(weaponOf(prize), isFridgeWeapon)
