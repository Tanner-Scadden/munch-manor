import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { ammoCounterOffers, sellAmmo } from './ammoCounter'
import { type Box, distanceToBox } from './arena'
import { buyExit, exitOffers } from './exits'
import { fridgeOffers, pullFridge, takePrize } from './leftovers'
import type { World } from './world'
import {
  GameEvent,
  Phase,
  Purchasable,
  Purchase,
  ShopState,
  type Vector,
} from './worldSchema'

// Buying things in the world by standing still or holding the interact key
// beside them, the way a wall buy works: no dialog, nothing paused or
// covered. Walk up to a purchasable and either hold the key (or the touch
// HUD's hold button) for half a second, or just stand still there for a
// second, the way a teammate revives (src/revive.ts); either fills the same
// ring, and the key fills it twice as fast. Letting go, walking off, firing,
// or stabbing cancels. A press the wallet cannot cover is refused at once;
// standing there short of it does nothing.
//
// Standing never buys by accident: it counts only while the player neither
// moves, fires, nor stabs, never while the shop is open or in the first
// moments of a wave, and after any buy the player must move (or press the
// key) before standing buys again, so one buy never chains into the next.
//
// The hold is World state, stepped from each seat's own intent, so co-op
// works the same: each player holds for themselves and pays alone.
//
// A new kind of purchasable (like the Mystery Leftovers fridge) adds a case
// to `Purchasable` in src/worldSchema.ts, its offers to `offersOf`, its buy
// to `buy`, and its tag to the view's `tagOf` (src/purchaseView.ts).

type PurchaseRules = Readonly<{
  holdMs: number
  standMs: number
  refusedMs: number
  waveGraceMs: number
}>

// NOTE: a second of standing is twice the key's half second, so it reads as
// a choice and not a pause between strafes, and half a revive's two seconds,
// since a buy is undone by walking away while a revive is not.
export const PURCHASE_RULES: PurchaseRules = {
  holdMs: 500,
  standMs: 1000,
  refusedMs: 450,
  waveGraceMs: 1500,
}

// NOTE: a purchasable for sale right now: what it is, its price, the box a
// player must stand within `reachPx` of, and the spot its price tag hangs
// from (the top middle of the tag).
// `isFull` is an offer with nothing left to sell right now, such as the
// ammo window for a full gun: a press shakes it, and standing never buys.
export type Offer = Readonly<{
  target: Purchasable
  price: number
  box: Box
  reachPx: number
  spot: Vector
  isFull: boolean
}>

export const offersOf = (world: World): ReadonlyArray<Offer> => [
  ...exitOffers(world),
  ...fridgeOffers(world),
  ...ammoCounterOffers(world),
]

const buy = (world: World, offer: Offer): Option.Option<World> =>
  Purchasable.match(offer.target, {
    Exit: ({ exit }) => buyExit(world, exit, offer.price),
    Fridge: () => pullFridge(world, offer.price),
    Prize: () => takePrize(world),
    Ammo: () => sellAmmo(world),
  })

export const isSamePurchasable = (
  first: Purchasable,
  second: Purchasable,
): boolean =>
  Purchasable.match(first, {
    Exit: ({ exit }) => second._tag === 'Exit' && second.exit === exit,
    Fridge: () => second._tag === 'Fridge',
    Prize: () => second._tag === 'Prize',
    Ammo: () => second._tag === 'Ammo',
  })

const reachOf = (world: World, offer: Offer): number =>
  distanceToBox(world.player, offer.box)

// NOTE: the nearest offer the player stands within reach of.
export const maybeOfferInReach = (world: World): Option.Option<Offer> =>
  pipe(
    offersOf(world),
    Array.filter(offer => reachOf(world, offer) <= offer.reachPx),
    Array.match({
      onEmpty: () => Option.none(),
      onNonEmpty: inReach =>
        Option.some(
          Array.reduce(
            inReach,
            Array.headNonEmpty(inReach),
            (nearest, offer) =>
              reachOf(world, offer) < reachOf(world, nearest) ? offer : nearest,
          ),
        ),
    }),
  )

export const maybeOfferOf = (
  world: World,
  target: Purchasable,
): Option.Option<Offer> =>
  Array.findFirst(offersOf(world), offer =>
    isSamePurchasable(offer.target, target),
  )

export const shortfallFor = (world: World, offer: Offer): number =>
  Math.max(0, offer.price - world.wallet.balance)

// NOTE: how far the hold has filled, from 0 to 1. `heldMs` counts in the
// key's time: standing adds to it at half speed.
export const holdProgress = (purchase: Purchase): number =>
  Purchase.match(purchase, {
    Idle: () => 0,
    Holding: ({ heldMs }) => Math.min(1, heldMs / PURCHASE_RULES.holdMs),
    Refused: () => 0,
    Done: () => 1,
    Spent: () => 0,
  })

// NOTE: standing still to buy: not moving, firing, or stabbing (the
// trigger, with the knife in hand), the shop shut, and the wave past its
// first moments.
export const isStandingToBuy = (world: World): boolean =>
  world.intent.move.x === 0 &&
  world.intent.move.y === 0 &&
  world.intent.trigger === 'Released' &&
  !ShopState.isAnyOf(['Browsing'])(world.shop) &&
  !(
    Phase.isAnyOf(['Wave'])(world.phase) &&
    world.phase.elapsedMs < PURCHASE_RULES.waveGraceMs
  )

const STAND_RATE = PURCHASE_RULES.holdMs / PURCHASE_RULES.standMs

// STEP

const withPurchase = (world: World, purchase: Purchase): World =>
  modifyFields(world, { purchase: () => purchase })

const withEvent = (world: World, event: GameEvent): World =>
  modifyFields(world, { frameEvents: events => [...events, event] })

const refuse = (world: World, offer: Offer): World =>
  withEvent(
    withPurchase(
      world,
      Purchase.Refused({
        target: offer.target,
        shortBy: shortfallFor(world, offer),
        sinceMs: 0,
      }),
    ),
    GameEvent.PurchaseRefused({ x: offer.spot.x, y: offer.spot.y }),
  )

const press = (world: World, offer: Offer): World =>
  offer.isFull || shortfallFor(world, offer) > 0
    ? refuse(world, offer)
    : withPurchase(world, Purchase.Holding({ target: offer.target, heldMs: 0 }))

const complete = (world: World, offer: Offer): World =>
  Option.match(buy(world, offer), {
    onNone: () => refuse(world, offer),
    onSome: bought =>
      withEvent(
        withPurchase(bought, Purchase.Done()),
        GameEvent.Purchased({ x: world.player.x, y: world.player.y }),
      ),
  })

// NOTE: one tick of the seat in the World's per-player fields at whatever
// it may be holding the interact key beside. Called for standing players.
export const advancePurchase = (world: World, deltaMs: number): World => {
  const isHeld = world.intent.interact === 'Held'
  const isStanding = isStandingToBuy(world)
  const fromIdle = (): World =>
    Option.match(maybeOfferInReach(world), {
      onNone: () => world,
      onSome: offer =>
        isHeld
          ? press(world, offer)
          : isStanding && !offer.isFull && shortfallFor(world, offer) === 0
            ? withPurchase(
                world,
                Purchase.Holding({
                  target: offer.target,
                  heldMs: deltaMs * STAND_RATE,
                }),
              )
            : world,
    })
  return Purchase.match(world.purchase, {
    Idle: fromIdle,
    Holding: ({ target, heldMs }) => {
      const maybeHeld = Option.filter(maybeOfferInReach(world), offer =>
        isSamePurchasable(offer.target, target),
      )
      if ((!isHeld && !isStanding) || Option.isNone(maybeHeld)) {
        return withPurchase(world, Purchase.Idle())
      }
      const nextMs = heldMs + (isHeld ? deltaMs : deltaMs * STAND_RATE)
      return nextMs >= PURCHASE_RULES.holdMs
        ? complete(world, maybeHeld.value)
        : withPurchase(world, Purchase.Holding({ target, heldMs: nextMs }))
    },
    Refused: ({ target, shortBy, sinceMs }) => {
      const nextMs = Math.min(PURCHASE_RULES.refusedMs, sinceMs + deltaMs)
      return !isHeld && nextMs >= PURCHASE_RULES.refusedMs
        ? withPurchase(world, Purchase.Idle())
        : withPurchase(
            world,
            Purchase.Refused({ target, shortBy, sinceMs: nextMs }),
          )
    },
    Done: () =>
      isHeld
        ? world
        : withPurchase(world, isStanding ? Purchase.Spent() : Purchase.Idle()),
    Spent: () =>
      isHeld
        ? fromIdle()
        : isStanding
          ? world
          : withPurchase(world, Purchase.Idle()),
  })
}

// NOTE: whether the interact key belongs to a purchasable right now, so a
// press there holds to buy instead of starting the wave.
export const isInteractTaken = (world: World): boolean =>
  Option.isSome(maybeOfferInReach(world))
