import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { caseOffers, takeCase } from '#world/feats/cases.ts'
import { fridgeOffers, pullFridge, takePrize } from '#world/fridge/leftovers.ts'
import { heldKeys } from '#world/keys/keys.ts'
import {
  BACK_DOOR_RULES,
  backDoorOffers,
  isBackDoorHoldPaused,
  leaveEarly,
} from '#world/kitchen/backDoor.ts'
import { buyValve, valveOffers } from '#world/kitchen/gasValve.ts'
import { STOVE_RULES, cookGun, stoveOffers } from '#world/kitchen/stove.ts'
import { buyExit, exitOffers } from '#world/level/exits.ts'
import { type Box, distanceToBox } from '#world/level/tileGrid.ts'
import {
  isStanding as isOnFeet,
  modifySeat,
  seatStateAt,
} from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  Purchasable,
  Purchase,
  type Vector,
} from '#world/schema/worldSchema.ts'

type PurchaseRules = Readonly<{
  holdMs: number
  standMs: number
  refusedMs: number
  waveGraceMs: number
}>

export const PURCHASE_RULES: PurchaseRules = {
  holdMs: 500,
  standMs: 1000,
  refusedMs: 450,
  waveGraceMs: 1500,
}

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
  ...backDoorOffers(world),
])

const buy = (
  world: World,
  slot: PlayerSlot,
  offer: Offer,
): Option.Option<World> =>
  Purchasable.match(offer.target, {
    Exit: ({ exit }) => buyExit(world, exit, offer.price),
    Fridge: () => pullFridge(world, slot, offer.price),
    Prize: () => takePrize(world, slot),
    Stove: () => cookGun(world, slot, offer.price),
    Valve: () => buyValve(world, slot, offer.price),
    Case: ({ id }) => takeCase(world, slot, id),
    BackDoor: () => leaveEarly(world),
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
    BackDoor: () => second._tag === 'BackDoor',
  }),
)

const holdMsOf = (target: Purchasable): number =>
  Purchasable.match(target, {
    Exit: () => PURCHASE_RULES.holdMs,
    Fridge: () => PURCHASE_RULES.holdMs,
    Prize: () => PURCHASE_RULES.holdMs,
    Stove: () => STOVE_RULES.holdMs,
    Valve: () => PURCHASE_RULES.holdMs,
    Case: () => PURCHASE_RULES.holdMs,
    BackDoor: () => BACK_DOOR_RULES.holdMs,
  })

const reachOf = (world: World, slot: PlayerSlot, offer: Offer): number =>
  distanceToBox(seatStateAt(world, slot).player, offer.box)

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
  (offer: Offer): (world: World) => number
  (world: World, offer: Offer): number
} = Function.dual(2, (world: World, offer: Offer): number =>
  Math.max(0, offer.price - heldKeys(world)),
)

export const holdProgress = (purchase: Purchase): number =>
  Purchase.match(purchase, {
    Idle: () => 0,
    Holding: ({ target, heldMs }) => Math.min(1, heldMs / holdMsOf(target)),
    Refused: () => 0,
    Done: () => 1,
    Spent: () => 0,
  })

const isStandingToBuy: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): boolean =>
    seatStateAt(world, slot).intent.move.x === 0 &&
    seatStateAt(world, slot).intent.move.y === 0 &&
    seatStateAt(world, slot).intent.trigger === 'Released' &&
    !(
      Phase.isAnyOf(['Wave'])(world.phase) &&
      world.phase.elapsedMs < PURCHASE_RULES.waveGraceMs
    ),
)

const STAND_RATE = PURCHASE_RULES.holdMs / PURCHASE_RULES.standMs

const withPurchase = (
  world: World,
  slot: PlayerSlot,
  purchase: Purchase,
): World => modifySeat(world, slot, { purchase: () => purchase })

const withEvent = (world: World, event: GameEvent): World =>
  UiStruct.evolve(world, { frameEvents: events => [...events, event] })

const refuse = (world: World, slot: PlayerSlot, offer: Offer): World =>
  withEvent(
    withPurchase(
      world,
      slot,
      Purchase.Refused({
        target: offer.target,
        shortBy: shortfallFor(world, offer),
        sinceMs: 0,
      }),
    ),
    GameEvent.PurchaseRefused({ x: offer.spot.x, y: offer.spot.y }),
  )

const press = (world: World, slot: PlayerSlot, offer: Offer): World =>
  offer.isFull || shortfallFor(world, offer) > 0
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
            : isStanding && !offer.isFull && shortfallFor(world, offer) === 0
              ? withPurchase(
                  world,
                  slot,
                  Purchase.Holding({
                    target: offer.target,
                    heldMs: isBackDoorHoldPaused(world, offer.target)
                      ? 0
                      : deltaMs * STAND_RATE,
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
        const nextMs = isBackDoorHoldPaused(world, target)
          ? heldMs
          : heldMs + (isHeld ? deltaMs : deltaMs * STAND_RATE)
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

export const isInteractTaken: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean =>
  Option.isSome(maybeOfferInReach(world, slot)),
)
