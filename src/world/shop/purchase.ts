import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { caseOffers, takeCase } from '../feats/cases'
import { fridgeOffers, pullFridge, takePrize } from '../fridge/leftovers'
import { buyValve, valveOffers } from '../kitchen/gasValve'
import { STOVE_RULES, cookGun, stoveOffers } from '../kitchen/stove'
import { type Box, distanceToBox } from '../level/arena'
import { buyExit, exitOffers } from '../level/exits'
import { isStanding as isOnFeet, modifySeat, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  Purchasable,
  Purchase,
  ShopState,
  type Vector,
} from '../schema/worldSchema'

// Buying things in the world by standing still or holding the interact key
// beside them, the way a wall buy works: no dialog, nothing paused or
// covered. Walk up to a purchasable and either hold the key (or the touch
// HUD's hold button) for half a second, or just stand still there for a
// second, the way a teammate revives (src/world/party/revive.ts); either fills the same
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
// to `Purchasable` in src/world/schema/worldSchema.ts, its offers to `offersOf`, its buy
// to `buy`, and its tag to the view's `tagOf` (src/features/shop/purchaseView.ts).

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
// stove with no gun it cooks in hand: a press shakes it, and standing never
// buys.
export type Offer = Readonly<{
  target: Purchasable
  price: number
  box: Box
  reachPx: number
  spot: Vector
  isFull: boolean
}>

export const offersOf: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<Offer>
  (world: World, slot: PlayerSlot): ReadonlyArray<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): ReadonlyArray<Offer> => [
  ...exitOffers(world),
  ...fridgeOffers(world, slot),
  ...stoveOffers(world, slot),
  ...valveOffers(world, slot),
  ...caseOffers(world, slot),
])

const buy = (
  world: World,
  slot: PlayerSlot,
  offer: Offer,
): Option.Option<World> =>
  Purchasable.match(offer.target, {
    Exit: ({ exit }) => buyExit(world, slot, exit, offer.price),
    Fridge: () => pullFridge(world, slot, offer.price),
    Prize: () => takePrize(world, slot),
    Stove: () => cookGun(world, slot, offer.price),
    Valve: () => buyValve(world, slot, offer.price),
    Case: ({ id }) => takeCase(world, slot, id),
  })

export const isSamePurchasable: {
  (second: Purchasable): (first: Purchasable) => boolean
  (first: Purchasable, second: Purchasable): boolean
} = Function.dual(2, (first: Purchasable, second: Purchasable): boolean =>
  Purchasable.match(first, {
    Exit: ({ exit }) => second._tag === 'Exit' && second.exit === exit,
    Fridge: () => second._tag === 'Fridge',
    Prize: () => second._tag === 'Prize',
    Stove: () => second._tag === 'Stove',
    Valve: () => second._tag === 'Valve',
    Case: ({ id }) => second._tag === 'Case' && second.id === id,
  }),
)

// NOTE: how long the key holds to buy: half a second, but two at the
// stove, since a cook is a choice for the rest of the run. Standing fills
// at half the key's speed, as everywhere.
const holdMsOf = (target: Purchasable): number =>
  Purchasable.isAnyOf(['Stove'])(target)
    ? STOVE_RULES.holdMs
    : PURCHASE_RULES.holdMs

const reachOf = (world: World, slot: PlayerSlot, offer: Offer): number =>
  distanceToBox(seatStateAt(world, slot).player, offer.box)

// NOTE: the nearest offer the player stands within reach of.
// NOTE: a downed or bled-out player buys nothing (src/world/step/simulation.ts,
// visitStall), so nothing is in their reach: no lit tag, hold button, or
// spoken price for them.
export const maybeOfferInReach: {
  (slot: PlayerSlot): (world: World) => Option.Option<Offer>
  (world: World, slot: PlayerSlot): Option.Option<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): Option.Option<Offer> =>
  pipe(
    isOnFeet(seatStateAt(world, slot).seat) ? offersOf(world, slot) : [],
    Array.filter(offer => reachOf(world, slot, offer) <= offer.reachPx),
    Array.match({
      onEmpty: () => Option.none(),
      onNonEmpty: inReach =>
        Option.some(
          Array.reduce(
            inReach,
            Array.headNonEmpty(inReach),
            (nearest, offer) =>
              reachOf(world, slot, offer) < reachOf(world, slot, nearest)
                ? offer
                : nearest,
          ),
        ),
    }),
  ),
)

export const maybeOfferOf: {
  (
    slot: PlayerSlot,
    target: Purchasable,
  ): (world: World) => Option.Option<Offer>
  (world: World, slot: PlayerSlot, target: Purchasable): Option.Option<Offer>
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, target: Purchasable): Option.Option<Offer> =>
    Array.findFirst(offersOf(world, slot), offer =>
      isSamePurchasable(offer.target, target),
    ),
)

export const shortfallFor: {
  (slot: PlayerSlot, offer: Offer): (world: World) => number
  (world: World, slot: PlayerSlot, offer: Offer): number
} = Function.dual(3, (world: World, slot: PlayerSlot, offer: Offer): number =>
  Math.max(0, offer.price - seatStateAt(world, slot).wallet.balance),
)

// NOTE: how far the hold has filled, from 0 to 1. `heldMs` counts in the
// key's time: standing adds to it at half speed.
export const holdProgress = (purchase: Purchase): number =>
  Purchase.match(purchase, {
    Idle: () => 0,
    Holding: ({ target, heldMs }) => Math.min(1, heldMs / holdMsOf(target)),
    Refused: () => 0,
    Done: () => 1,
    Spent: () => 0,
  })

// NOTE: standing still to buy: not moving, firing, or stabbing (the
// trigger, with the knife in hand), the shop shut, and the wave past its
// first moments.
export const isStandingToBuy: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): boolean =>
    seatStateAt(world, slot).intent.move.x === 0 &&
    seatStateAt(world, slot).intent.move.y === 0 &&
    seatStateAt(world, slot).intent.trigger === 'Released' &&
    !ShopState.isAnyOf(['Browsing'])(seatStateAt(world, slot).shop) &&
    !(
      Phase.isAnyOf(['Wave'])(world.phase) &&
      world.phase.elapsedMs < PURCHASE_RULES.waveGraceMs
    ),
)

const STAND_RATE = PURCHASE_RULES.holdMs / PURCHASE_RULES.standMs

// STEP

const withPurchase = (
  world: World,
  slot: PlayerSlot,
  purchase: Purchase,
): World => modifySeat(world, slot, { purchase: () => purchase })

const withEvent = (world: World, event: GameEvent): World =>
  modifyFields(world, { frameEvents: events => [...events, event] })

const refuse = (world: World, slot: PlayerSlot, offer: Offer): World =>
  withEvent(
    withPurchase(
      world,
      slot,
      Purchase.Refused({
        target: offer.target,
        shortBy: shortfallFor(world, slot, offer),
        sinceMs: 0,
      }),
    ),
    GameEvent.PurchaseRefused({ x: offer.spot.x, y: offer.spot.y }),
  )

const press = (world: World, slot: PlayerSlot, offer: Offer): World =>
  offer.isFull || shortfallFor(world, slot, offer) > 0
    ? refuse(world, slot, offer)
    : withPurchase(
        world,
        slot,
        Purchase.Holding({ target: offer.target, heldMs: 0 }),
      )

const complete = (world: World, slot: PlayerSlot, offer: Offer): World =>
  Option.match(buy(world, slot, offer), {
    onNone: () => refuse(world, slot, offer),
    onSome: bought =>
      withEvent(
        withPurchase(bought, slot, Purchase.Done()),
        GameEvent.Purchased({
          x: seatStateAt(world, slot).player.x,
          y: seatStateAt(world, slot).player.y,
        }),
      ),
  })

// NOTE: one tick of the seat at `slot` at whatever it may be holding the
// interact key beside. Called for standing players.
export const advancePurchase: {
  (slot: PlayerSlot, deltaMs: number): (world: World) => World
  (world: World, slot: PlayerSlot, deltaMs: number): World
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, deltaMs: number): World => {
    const isHeld = seatStateAt(world, slot).intent.interact === 'Held'
    const isStanding = isStandingToBuy(world, slot)
    const fromIdle = (): World =>
      Option.match(maybeOfferInReach(world, slot), {
        onNone: () => world,
        onSome: offer =>
          isHeld
            ? press(world, slot, offer)
            : isStanding &&
                !offer.isFull &&
                shortfallFor(world, slot, offer) === 0
              ? withPurchase(
                  world,
                  slot,
                  Purchase.Holding({
                    target: offer.target,
                    heldMs: deltaMs * STAND_RATE,
                  }),
                )
              : world,
      })
    return Purchase.match(seatStateAt(world, slot).purchase, {
      Idle: fromIdle,
      Holding: ({ target, heldMs }) => {
        const maybeHeld = Option.filter(maybeOfferInReach(world, slot), offer =>
          isSamePurchasable(offer.target, target),
        )
        if ((!isHeld && !isStanding) || Option.isNone(maybeHeld)) {
          return withPurchase(world, slot, Purchase.Idle())
        }
        const nextMs = heldMs + (isHeld ? deltaMs : deltaMs * STAND_RATE)
        return nextMs >= holdMsOf(target)
          ? complete(world, slot, maybeHeld.value)
          : withPurchase(
              world,
              slot,
              Purchase.Holding({ target, heldMs: nextMs }),
            )
      },
      Refused: ({ target, shortBy, sinceMs }) => {
        const nextMs = Math.min(PURCHASE_RULES.refusedMs, sinceMs + deltaMs)
        return !isHeld && nextMs >= PURCHASE_RULES.refusedMs
          ? withPurchase(world, slot, Purchase.Idle())
          : withPurchase(
              world,
              slot,
              Purchase.Refused({ target, shortBy, sinceMs: nextMs }),
            )
      },
      Done: () =>
        isHeld
          ? world
          : withPurchase(
              world,
              slot,
              isStanding ? Purchase.Spent() : Purchase.Idle(),
            ),
      Spent: () =>
        isHeld
          ? fromIdle()
          : isStanding
            ? world
            : withPurchase(world, slot, Purchase.Idle()),
    })
  },
)

// NOTE: whether the interact key belongs to a purchasable right now, so a
// press there holds to buy instead of starting the wave.
export const isInteractTaken: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean =>
  Option.isSome(maybeOfferInReach(world, slot)),
)
