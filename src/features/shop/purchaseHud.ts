import { Function, Option, Stream, String } from 'effect'

import { Mount } from '@effect/ui'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { pixelArtStyle } from '../../art/artSize'
import { GRAB_ICON, HOLD_ICON } from '../../art/icons'
import { spriteImage } from '../../art/sprite'
import { InputMessage, RunButtonMessage } from '../../input/message'
import { iconView } from '../../ui/menuParts'
import { isCrewAtBackDoor } from '../../world/kitchen/backDoor'
import { maybeStovePerk } from '../../world/kitchen/stove'
import { exitName } from '../../world/level/exits'
import {
  BACK_DOOR_NAME,
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
import { maybeTakenIcon } from './purchaseView'

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
    BackDoor: () => String.toLowerCase(BACK_DOOR_NAME),
  })

const badgeOf = (offer: Offer): string =>
  offer.isFull
    ? Purchasable.isAnyOf(['Stove', 'BackDoor'])(offer.target)
      ? 'NOPE'
      : 'FULL'
    : Purchasable.isAnyOf(['BackDoor'])(offer.target)
      ? 'OUT'
      : `${offer.price}`

// NOTE: the prize's picture doubled, crisp, as on the canvas tag.
const TAKE_IMAGE_SCALE = 2

// NOTE: a prize on offer is already paid for, so where a price would be,
// its button shows an open hand and the prize's own picture: what you
// take, with no word.
const takeBadgeView = (
  model: Model,
  offer: Offer,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.span
    .class('icon-button-badge hold-buy-price hold-buy-take')
    .attr('aria-hidden', 'true')
    .children(
      iconView('hold-buy-take-hand', GRAB_ICON, h),
      ...Option.match(
        Option.flatMap(maybeTakenIcon(model, offer.target), spriteImage),
        {
          onNone: () => [],
          onSome: image => [
            h.img
              .class('hold-buy-take-item')
              .attr('src', image.src)
              .attr('alt', '')
              .style({
                width: `${image.width * TAKE_IMAGE_SCALE}px`,
                height: `${image.height * TAKE_IMAGE_SCALE}px`,
              }),
          ],
        },
      ),
    )

const badgeView = (model: Model, offer: Offer, h: ApplicationViewBuilder) =>
  Purchasable.isAnyOf(['Prize', 'Case'])(offer.target)
    ? takeBadgeView(model, offer, h)
    : h.span
        .class('icon-button-badge hold-buy-price')
        .attr('aria-hidden', 'true')
        .children(badgeOf(offer))

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
    BackDoor: () =>
      offer.isFull
        ? 'Find a thing on the dare first'
        : isCrewAtBackDoor(model)
          ? `Hold to leave early by the ${nameOf(offer.target)}`
          : `Bring the whole crew to the ${nameOf(offer.target)} to leave early`,
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
// NOTE: a Mount, as the element's own `pointerdown` carries no pointer id,
// and the hold lasts until that finger lifts (ReleasedPointer).
export const PressHoldButton = Mount.makeStream(
  'PressHoldButton',
  { args: {} },
  (node: HTMLElement) =>
    Stream.fromEventListener<PointerEvent>(node, 'pointerdown').pipe(
      Stream.filter(event => event.pointerType !== 'mouse'),
      Stream.map(event =>
        RunButtonMessage.PressedHoldButton({ pointerId: event.pointerId }),
      ),
    ),
)

const holdButtonFor = (
  model: Model,
  offer: Offer,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const isShort = shortfallFor(model, offer) > 0
  return h.button
    .attr('type', 'button')
    .class(
      isRefusedAt(model, offer)
        ? 'icon-button cluster-button hold-buy-button is-refused'
        : 'icon-button cluster-button hold-buy-button',
    )
    .attr('aria-label', labelOf(model, offer))
    .attr('aria-disabled', isShort ? 'true' : undefined)
    .attr('data-short', isShort ? 'true' : 'false')
    .style({ '--hold': `${progressAt(model, offer)}` })
    .onMount(PressHoldButton())
    .on('contextmenu', InputMessage.SuppressedContextMenu())
    .children(
      h.span.class('hold-buy-ring').attr('aria-hidden', 'true'),
      h.span
        .class('icon-button-glyph')
        .attr('aria-hidden', 'true')
        .style(pixelArtStyle(HOLD_ICON)),
      badgeView(model, offer, h),
    )
}

export const holdButtonView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    model.lastDevice === 'Touch'
      ? Option.match(maybeShownOffer(model), {
          onNone: () => null,
          onSome: offer => holdButtonFor(model, offer, h),
        })
      : null,
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
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    h.p
      .class('sr-only')
      .attr('role', 'status')
      .attr('aria-live', 'polite')
      .children(
        Option.match(maybeOfferInReach(model, focusSlotOf(model)), {
          onNone: () => '',
          onSome: offer => announcementOf(model, offer),
        }),
      ),
)
