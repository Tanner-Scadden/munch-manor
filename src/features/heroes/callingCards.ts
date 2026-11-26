import { Array, Function, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { pixelArtStyle } from '#art/artSize.ts'
import { portraitOf } from '#art/coopIcons.ts'
import { PADLOCK_ICON } from '#art/icons.ts'
import {
  type Special,
  specialsNoteOf,
  specialsOf,
} from '#domain/callingSpecials.ts'
import { callingUnlockId } from '#domain/unlocks.ts'
import type {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '#shared/playerData.ts'
import { iconView, newBadgeView } from '#ui/menuParts.ts'
import { boneCountView, rankMarkView } from '#ui/rankBadgeView.ts'
import {
  CALLINGS,
  type CallingStanding,
  UNLOCK_RANKS,
  callingPriceOf,
  callingStandingOf,
} from '#world/heroes/calling.ts'
import { CALLING_NAMES, SPECIAL_LINES } from '#world/names.ts'

export type CardsInput<Message> = {
  readonly look: Appearance
  readonly chosen: Calling
  readonly rank: number
  readonly bought: SavedBoughtCosmetics
  readonly trying: Calling | null
  readonly fresh: ReadonlyArray<string>
  readonly isChosenFocused: boolean
  readonly onCard: (calling: Calling) => Message
}

const priceOf = (calling: Calling): number =>
  Option.getOrElse(callingPriceOf(calling), () => 0)

const LABELS: {
  readonly [Standing in CallingStanding]: (calling: Calling) => string
} = {
  Owned: calling => `${CALLING_NAMES[calling]}. ${specialsNoteOf(calling)}`,
  ForSale: calling =>
    `${CALLING_NAMES[calling]}, for sale, ${priceOf(calling)} Bones. ${specialsNoteOf(calling)}`,
  Locked: calling =>
    `${CALLING_NAMES[calling]}, locked. Reach rank ${UNLOCK_RANKS[calling]} to unlock. ${specialsNoteOf(calling)}`,
}

const specialView = <Message>(
  special: Special,
  h: Html.H<Message>,
): View.Content<Message> =>
  h.li
    .class('calling-special')
    .attr('data-sign', special.isPerk ? 'Perk' : 'Drawback')
    .children(
      iconView('calling-special-icon', special.art, h),
      h.span
        .class('calling-special-sign')
        .attr('aria-hidden', 'true')
        .children(special.isPerk ? '+' : '-'),
      h.span.class('calling-special-line').children(special.line),
    )

const needView = <Message>(
  standing: CallingStanding,
  calling: Calling,
  h: Html.H<Message>,
): View.Content<Message> | null =>
  standing === 'Owned'
    ? null
    : h.span
        .class('calling-need')
        .children(
          standing === 'ForSale'
            ? boneCountView(priceOf(calling), 'calling-price', h)
            : [
                iconView('calling-lock-icon', PADLOCK_ICON, h),
                rankMarkView(UNLOCK_RANKS[calling], h),
              ],
        )

const cardView = <Message>(
  input: CardsInput<Message>,
  calling: Calling,
  h: Html.H<Message>,
): View.Content<Message> => {
  const standing = callingStandingOf(calling, input.rank, input.bought)
  const isChosen = calling === input.chosen
  const specials = specialsOf(calling)
  const isNew = Array.contains(input.fresh, callingUnlockId(calling))
  return h.button
    .attrs({
      type: 'button',
      'data-calling': calling,
      'data-lock': standing,
      'aria-label': LABELS[standing](calling),
    })
    .class('calling-card')
    .attr('data-trying', input.trying === calling ? 'true' : undefined)
    .attr('data-chosen', isChosen ? 'Chosen' : undefined)
    .attr('data-new', isNew ? 'true' : undefined)
    .attr('aria-disabled', standing === 'Locked' ? 'true' : undefined)
    .attr('autofocus', isChosen && input.isChosenFocused ? '' : undefined)
    .on('click', input.onCard(calling))
    .children(
      h.span
        .class('calling-figure')
        .attr('aria-hidden', 'true')
        .children(
          h.span
            .class('calling-figure-img')
            .style(pixelArtStyle(portraitOf(input.look, calling))),
        ),
      h.span
        .class('calling-body')
        .attr('aria-hidden', 'true')
        .children(
          h.span
            .class('calling-head')
            .children(
              h.span.class('calling-name').children(CALLING_NAMES[calling]),
              isNew && newBadgeView(h),
              needView(standing, calling, h),
            ),
          h.ul
            .class('calling-specials')
            .children(
              Array.isReadonlyArrayEmpty(specials)
                ? h.li
                    .class('calling-special calling-special-none')
                    .children(SPECIAL_LINES.noSpecials)
                : Array.map(specials, special => specialView(special, h)),
            ),
        ),
    )
}

export const callingCardsView: {
  <Message>(
    h: Html.H<Message>,
  ): (input: CardsInput<Message>) => View.Content<Message>
  <Message>(
    input: CardsInput<Message>,
    h: Html.H<Message>,
  ): View.Content<Message>
} = Function.dual(
  2,
  <Message>(
    input: CardsInput<Message>,
    h: Html.H<Message>,
  ): View.Content<Message> =>
    h.div
      .class('calling-cards')
      .children(Array.map(CALLINGS, calling => cardView(input, calling, h))),
)

export const callingBalanceView: {
  <Message>(h: Html.H<Message>): (bones: number) => View.Content<Message>
  <Message>(bones: number, h: Html.H<Message>): View.Content<Message>
} = Function.dual(
  2,
  <Message>(bones: number, h: Html.H<Message>): View.Content<Message> =>
    h.div
      .class('calling-balance')
      .attrs({ role: 'group', 'aria-label': `${bones} Bones` })
      .children(boneCountView(bones, 'calling-balance-count', h)),
)

type BuyInput<Message> = Readonly<{
  calling: Calling
  bones: number
  onBuy: Message
}>

export const callingBuyView: {
  <Message>(
    h: Html.H<Message>,
  ): (input: BuyInput<Message>) => View.Content<Message>
  <Message>(input: BuyInput<Message>, h: Html.H<Message>): View.Content<Message>
} = Function.dual(
  2,
  <Message>(
    input: BuyInput<Message>,
    h: Html.H<Message>,
  ): View.Content<Message> => {
    const price = priceOf(input.calling)
    const lacking = Math.max(0, price - input.bones)
    const button = h.button
      .key('calling-buy')
      .class('calling-buy')
      .attrs({
        type: 'button',
        'aria-label':
          lacking > 0
            ? `Buy for ${price} Bones, too few`
            : `Buy for ${price} Bones`,
      })
    const ready =
      lacking > 0
        ? button.disabled(true).attr('data-short', 'true')
        : button.on('click', input.onBuy)
    return ready.children(
      h.span
        .class('calling-buy-word')
        .attr('aria-hidden', 'true')
        .children('BUY'),
      boneCountView(price, 'calling-buy-price', h),
      lacking > 0 &&
        h.span
          .class('calling-buy-need')
          .attr('aria-hidden', 'true')
          .children(`NEED ${lacking} MORE`),
    )
  },
)
