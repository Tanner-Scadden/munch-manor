import { Function, Option, String } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import { HOLD_ICON } from '../../art/icons'
import { InputMessage, RunButtonMessage } from '../../input/message'
import { maybeStovePerk } from '../../world/kitchen/stove'
import { exitName } from '../../world/level/exits'
import {
  FRIDGE_NAME,
  GUN_PERK_NAMES,
  STOVE_NAME,
  VALVE_NAME,
} from '../../world/names'
import { focusOf, focusSlotOf } from '../../world/party/party'
import { Purchasable, Purchase } from '../../world/schema/worldSchema'
import {
  type Offer,
  PURCHASE_RULES,
  holdProgress,
  isSamePurchasable,
  maybeOfferInReach,
  maybeOfferOf,
  shortfallFor,
} from '../../world/shop/purchase'

// NOTE: the kitchen tour's free boards and pull are read as free.
// NOTE: a price is in skeleton keys off the crew's ring (src/world/keys/keys.ts).
const keyWords = (count: number): string =>
  `${count} ${count === 1 ? 'key' : 'keys'}`

const priceWords = (price: number): string =>
  price === 0 ? 'free' : keyWords(price)

// The HTML half of buying in the world (src/world/shop/purchase.ts): on touch, a hold
// button beside the guns while the player stands at a purchasable, in the
// right thumb's reach, and for a screen reader a polite line with the name
// and the price. The canvas half is src/features/shop/purchaseView.ts.

const nameOf = (target: Purchasable): string =>
  Purchasable.match(target, {
    Exit: ({ exit }) => String.toLowerCase(exitName(exit)),
    Fridge: () => String.toLowerCase(FRIDGE_NAME),
    Prize: () => 'the prize from the fridge, free',
    Stove: () => String.toLowerCase(STOVE_NAME),
    Valve: () => String.toLowerCase(VALVE_NAME),
    Case: () => 'the prize in the case',
  })

// NOTE: a weapon on offer is already paid for, so its button says TAKE
// where a price would be.
const badgeOf = (offer: Offer): string => {
  if (Purchasable.isAnyOf(['Prize', 'Case'])(offer.target)) {
    return 'TAKE'
  } else if (offer.isFull) {
    return Purchasable.isAnyOf(['Stove'])(offer.target) ? 'NOPE' : 'FULL'
  } else {
    return `${offer.price}`
  }
}

const labelOf = (model: Model, offer: Offer): string =>
  Purchasable.match(offer.target, {
    Exit: () =>
      `Hold to open ${nameOf(offer.target)} for ${priceWords(offer.price)}`,
    Fridge: () =>
      `Hold to open ${nameOf(offer.target)} for ${priceWords(offer.price)}`,
    Prize: () => 'Hold to take the prize from the fridge',
    Stove: () =>
      offer.isFull
        ? 'Only a gun from the stall cooks'
        : `Hold to cook your gun ${Option.match(maybeStovePerk(model), {
            onNone: () => '',
            onSome: perk => String.toLowerCase(GUN_PERK_NAMES[perk]),
          })} for ${priceWords(offer.price)}`,
    Valve: () => 'Hold to light the fireplace',
    Case: () => 'Hold to take the prize from the case',
  })

// NOTE: what the player is at: the offer in reach, or the one they still
// hold or were refused at a moment ago.
const maybeShownOffer = (model: Model): Option.Option<Offer> =>
  Purchase.match(focusOf(model).purchase, {
    Idle: () => maybeOfferInReach(model, focusSlotOf(model)),
    Holding: ({ target }) => maybeOfferOf(model, focusSlotOf(model), target),
    Refused: ({ target }) =>
      Option.orElse(maybeOfferOf(model, focusSlotOf(model), target), () =>
        maybeOfferInReach(model, focusSlotOf(model)),
      ),
    Done: () => maybeOfferInReach(model, focusSlotOf(model)),
    Spent: () => maybeOfferInReach(model, focusSlotOf(model)),
  })

const isRefusedAt = (model: Model, offer: Offer): boolean =>
  Purchase.match(focusOf(model).purchase, {
    Idle: () => false,
    Holding: () => false,
    Refused: ({ target, sinceMs }) =>
      isSamePurchasable(target, offer.target) &&
      sinceMs < PURCHASE_RULES.refusedMs,
    Done: () => false,
    Spent: () => false,
  })

const progressAt = (model: Model, offer: Offer): number =>
  Purchase.match(focusOf(model).purchase, {
    Idle: () => 0,
    Holding: ({ target }) =>
      isSamePurchasable(target, offer.target)
        ? holdProgress(focusOf(model).purchase)
        : 0,
    Refused: () => 0,
    Done: () => 0,
    Spent: () => 0,
  })

// NOTE: the button is held, not clicked: the finger that lands on it holds
// the intent's interact until it lifts (src/input/input.ts). It sits outside the
// game surface, so it never takes a stick's finger.
const toPressedHoldButton = (
  pointerType: string,
  _button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  _clientX: number,
  _clientY: number,
  pointerId: number,
): Option.Option<RunButtonMessage> =>
  pointerType === 'mouse'
    ? Option.none()
    : Option.some(RunButtonMessage.PressedHoldButton({ pointerId }))

const holdButtonFor = (
  model: Model,
  offer: Offer,
  h: ApplicationViewBuilder,
): Html => {
  const isShort = shortfallFor(model, offer) > 0
  return h.button(
    [
      h.Type('button'),
      h.Class(
        isRefusedAt(model, offer)
          ? 'icon-button cluster-button hold-buy-button is-refused'
          : 'icon-button cluster-button hold-buy-button',
      ),
      h.AriaLabel(labelOf(model, offer)),
      ...(isShort ? [h.AriaDisabled(true)] : []),
      h.DataAttribute('short', isShort ? 'true' : 'false'),
      h.Style({ '--hold': `${progressAt(model, offer)}` }),
      h.OnPointerDown(toPressedHoldButton),
      h.OnContextMenu(InputMessage.SuppressedContextMenu()),
    ],
    [
      h.span([h.Class('hold-buy-ring'), h.AriaHidden(true)]),
      h.span([
        h.Class('icon-button-glyph'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: HOLD_ICON }),
      ]),
      h.span(
        [h.Class('icon-button-badge hold-buy-price'), h.AriaHidden(true)],
        [badgeOf(offer)],
      ),
    ],
  )
}

export const holdButtonView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  model.lastDevice === 'Touch'
    ? Option.match(maybeShownOffer(model), {
        onNone: () => h.empty,
        onSome: offer => holdButtonFor(model, offer, h),
      })
    : h.empty,
)

const howToBuy = (model: Model): string =>
  model.lastDevice === 'Touch'
    ? 'Stand still or hold the button to buy.'
    : 'Stand still or hold Enter to buy.'

const announcementOf = (model: Model, offer: Offer): string => {
  const shortBy = shortfallFor(model, offer)
  const how = howToBuy(model)
  return shortBy > 0
    ? `${nameOf(offer.target)}, ${priceWords(offer.price)}. ${keyWords(shortBy)} short.`
    : `${nameOf(offer.target)}, ${priceWords(offer.price)}. ${how}`
}

// NOTE: spoken once as the player reaches a purchasable, and again when
// the key ring's verdict changes, never while the fight goes on around it.
export const purchaseAnnouncementView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  h.p(
    [h.Class('sr-only'), h.Role('status'), h.AriaLive('polite')],
    [
      Option.match(maybeOfferInReach(model, focusSlotOf(model)), {
        onNone: () => '',
        onSome: offer => announcementOf(model, offer),
      }),
    ],
  ),
)
