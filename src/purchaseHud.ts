import { Option } from 'effect'
import type { Html } from 'foldkit/html'

import { screenCameraOf, worldToView } from './camera'
import type { ApplicationViewBuilder } from './composition'
import { exitName } from './exits'
import { HOLD_ICON } from './icons'
import { percentOf } from './menuParts'
import { Message } from './message'
import { type Model, Purchasable, Purchase } from './model'
import { FRIDGE_NAME } from './names'
import {
  type Offer,
  PURCHASE_RULES,
  holdProgress,
  isSamePurchasable,
  maybeOfferInReach,
  maybeOfferOf,
  maybeTapOffer,
  shortfallFor,
} from './purchase'
import { tagBoxOf } from './purchaseView'
import { screenOf } from './screen'

// NOTE: the kitchen tour's free boards and pull are read as free.
const priceWords = (price: number): string =>
  price === 0 ? 'free' : `${price} dollars`

// The HTML half of buying in the world (src/purchase.ts): on touch, a hold
// button beside the guns while the player stands at a purchasable, in the
// right thumb's reach, and for a screen reader a polite line with the name
// and the price. The canvas half is src/purchaseView.ts.

const nameOf = (target: Purchasable): string =>
  Purchasable.match(target, {
    Exit: ({ exit }) => exitName(exit).toLowerCase(),
    Fridge: () => FRIDGE_NAME.toLowerCase(),
    Prize: () => 'the prize from the fridge, free',
    Ammo: () => 'ammo for the gun in your hands',
  })

// NOTE: a weapon on offer is already paid for, so its button says TAKE
// where a price would be.
const badgeOf = (offer: Offer): string => {
  if (Purchasable.isAnyOf(['Prize'])(offer.target)) {
    return 'TAKE'
  } else if (offer.isFull) {
    return 'FULL'
  } else {
    return `$${offer.price}`
  }
}

const labelOf = (offer: Offer): string =>
  Purchasable.match(offer.target, {
    Exit: () =>
      `Hold to open ${nameOf(offer.target)} for ${priceWords(offer.price)}`,
    Fridge: () =>
      `Hold to open ${nameOf(offer.target)} for ${priceWords(offer.price)}`,
    Prize: () => 'Hold to take the prize from the fridge',
    Ammo: () =>
      offer.isFull
        ? 'Your gun is full'
        : `Buy ammo for ${priceWords(offer.price)}`,
  })

// NOTE: what the player is at: the offer in reach, or the one they still
// hold or were refused at a moment ago.
const maybeShownOffer = (model: Model): Option.Option<Offer> =>
  Purchase.match(model.purchase, {
    Idle: () => maybeOfferInReach(model),
    Holding: ({ target }) => maybeOfferOf(model, target),
    Refused: ({ target }) =>
      Option.orElse(maybeOfferOf(model, target), () =>
        maybeOfferInReach(model),
      ),
    Done: () => maybeOfferInReach(model),
    Spent: () => maybeOfferInReach(model),
    Tapped: ({ target }) => maybeOfferOf(model, target),
  })

const isRefusedAt = (model: Model, offer: Offer): boolean =>
  Purchase.match(model.purchase, {
    Idle: () => false,
    Holding: () => false,
    Refused: ({ target, sinceMs }) =>
      isSamePurchasable(target, offer.target) &&
      sinceMs < PURCHASE_RULES.refusedMs,
    Done: () => false,
    Spent: () => false,
    Tapped: () => false,
  })

const progressAt = (model: Model, offer: Offer): number =>
  Purchase.match(model.purchase, {
    Idle: () => 0,
    Holding: ({ target }) =>
      isSamePurchasable(target, offer.target)
        ? holdProgress(model.purchase)
        : 0,
    Refused: () => 0,
    Done: () => 0,
    Spent: () => 0,
    Tapped: () => 0,
  })

// NOTE: the button is held, not clicked: the finger that lands on it holds
// the intent's interact until it lifts (src/input.ts). It sits outside the
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
): Option.Option<Message> =>
  pointerType === 'mouse'
    ? Option.none()
    : Option.some(Message.PressedHoldButton({ pointerId }))

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
      h.AriaLabel(labelOf(offer)),
      ...(isShort ? [h.AriaDisabled(true)] : []),
      h.DataAttribute('short', isShort ? 'true' : 'false'),
      h.Style({ '--hold': `${progressAt(model, offer)}` }),
      h.OnPointerDown(toPressedHoldButton),
      h.OnContextMenu(Message.SuppressedContextMenu()),
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

export const holdButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  model.lastDevice === 'Touch'
    ? Option.match(maybeShownOffer(model), {
        onNone: () => h.empty,
        onSome: offer => holdButtonFor(model, offer, h),
      })
    : h.empty

// NOTE: the ammo window buys on a tap (src/purchase.ts, tapToBuy); the
// rest stand or hold.
const howToBuy = (model: Model, offer: Offer): string => {
  const isTouch = model.lastDevice === 'Touch'
  if (Purchasable.isAnyOf(['Ammo'])(offer.target)) {
    return isTouch ? 'Tap the tag or the button to buy.' : 'Press Enter to buy.'
  } else {
    return isTouch
      ? 'Stand still or hold the button to buy.'
      : 'Stand still or hold Enter to buy.'
  }
}

const announcementOf = (model: Model, offer: Offer): string => {
  const shortBy = shortfallFor(model, offer)
  const how = howToBuy(model, offer)
  return shortBy > 0
    ? `${nameOf(offer.target)}, ${priceWords(offer.price)}. ${shortBy} dollars short.`
    : `${nameOf(offer.target)}, ${priceWords(offer.price)}. ${how}`
}

// NOTE: spoken once as the player reaches a purchasable, and again when
// the wallet's verdict changes, never while the fight goes on around it.
export const purchaseAnnouncementView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  h.p(
    [h.Class('sr-only'), h.Role('status'), h.AriaLive('polite')],
    [
      Option.match(maybeOfferInReach(model), {
        onNone: () => '',
        onSome: offer => announcementOf(model, offer),
      }),
    ],
  )

// THE AMMO TAG

// NOTE: a click or a tap on the ammo window's tag buys there at once
// (src/purchase.ts, tapToBuy). The canvas draws the tag; this clear button
// lies over it, in screen units, only while the player is in its reach,
// and outside the game surface, so a click on it is no shot and a tap on
// it takes no stick.
const TAG_HIT_PAD = 2

const ammoTagButtonFor = (
  model: Model,
  offer: Offer,
  h: ApplicationViewBuilder,
): Html => {
  const screen = screenOf(model)
  const camera = screenCameraOf(model)
  const box = tagBoxOf(model, offer)
  const center = worldToView(camera, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  })
  return h.div(
    [h.Class('hud-tap-frame')],
    [
      h.div(
        [h.Class('hud-tap-stage')],
        [
          h.button([
            h.Type('button'),
            h.Class('ammo-tag-button'),
            h.AriaLabel(labelOf(offer)),
            h.AriaKeyshortcuts('Enter'),
            h.Style({
              left: percentOf(center.x, screen.width),
              top: percentOf(center.y, screen.height),
              width: `max(40px, ${percentOf((box.width + TAG_HIT_PAD * 2) * camera.scale, screen.width)})`,
              height: `max(40px, ${percentOf((box.height + TAG_HIT_PAD * 2) * camera.scale, screen.height)})`,
            }),
            h.OnClick(Message.ClickedAmmoTag(), {
              focusSelector: '.game-surface',
            }),
          ]),
        ],
      ),
    ],
  )
}

export const ammoTagButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  Option.match(maybeTapOffer(model), {
    onNone: () => h.empty,
    onSome: offer => ammoTagButtonFor(model, offer, h),
  })
