import { Array, Function, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { pixelArtStyle } from '../../art/artSize'
import { portraitOf } from '../../art/coopIcons'
import { PADLOCK_ICON } from '../../art/icons'
import {
  type Special,
  specialsNoteOf,
  specialsOf,
} from '../../domain/callingSpecials'
import { callingUnlockId } from '../../domain/unlocks'
import type {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '../../shared/playerData'
import { iconView, newBadgeView } from '../../ui/menuParts'
import { boneCountView, rankMarkView } from '../../ui/rankBadgeView'
import {
  CALLINGS,
  type CallingStanding,
  UNLOCK_RANKS,
  callingPriceOf,
  callingStandingOf,
} from '../../world/heroes/calling'
import { CALLING_NAMES, SPECIAL_LINES } from '../../world/names'

// The picker's cards, one per hero (GAME_DESIGN.md, "Rank and Bones"),
// shared by the solo lobby's picker and co-op's lobby picker: the player's
// own look wearing the hero's prop, its name, and each special as a picture
// with a short line, perks in green with a plus and drawbacks in red with a
// minus. A locked card shows the same lines dimmed, with the padlock and the
// rank that opens it, so a player knows what they are working toward. A
// card for sale (its rank reached, not bought) shows its price in Bones.

// NOTE: an object type, not Readonly<...>, so the pipeable check matches the
// view's two signatures.
export type CardsInput<Message> = {
  readonly look: Appearance
  readonly chosen: Calling
  readonly rank: number
  // NOTE: the heroes bought (the save's bought ids), and the one for sale
  // being tried on.
  readonly bought: SavedBoughtCosmetics
  readonly trying: Calling | null
  // NOTE: the unlock ids that wear a NEW badge (src/domain/unlocks.ts).
  readonly fresh: ReadonlyArray<string>
  // NOTE: the chosen card takes focus as the Dialog it stands in opens
  // (ui-kit's Dialog focuses the `autofocus` element inside it).
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

// NOTE: the player's Bones by the title, so a price has its context. Shared
// by the solo lobby's picker and co-op's lobby picker.
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

// NOTE: the BUY button: a bright gold arcade button when the Bones cover
// the hero, dim and red with how many more it needs when they do not. The
// caller says what a tap sends.
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
