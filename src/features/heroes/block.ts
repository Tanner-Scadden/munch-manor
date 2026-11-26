import { Schema } from 'effect'

import type { View } from '@effect/ui'
import { Html, HtmlSubscription } from '@effect/ui/html'

import { pixelArtStyle } from '../../art/artSize'
import { CLOSE_ICON } from '../../art/icons'
import {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '../../shared/playerData'
import {
  callingBalanceView,
  callingBuyView,
  callingCardsView,
} from './callingCards'
import { Events, Message } from './message'

// The hero picker (GAME_DESIGN.md, "Rank and Bones"): five cards, each the
// player's own look wearing the hero's prop, with its specials, the Bones,
// and BUY for a hero being tried on. Bound twice: in the solo lobby's
// Dialog (src/features/lobby/view.ts) and over co-op's lobby. The parent
// owns all its state: whether it is drawn, the hero tried on, and every
// rule a tap meets. It holds none, and its close keys are its own
// Subscription.

// NOTE: where the picker stands. `Panel` is inside the solo lobby's Dialog,
// which draws the title; `Overlay` is over co-op's lobby, with its own head.
const PickerLayout = Schema.Literals(['Panel', 'Overlay'])

// NOTE: what a parent hands the picker: the look its cards wear, the hero
// worn, the hero for sale being tried on (its BUY pill buys it), the rank
// and the heroes bought (each card's standing), the Bones (the balance and
// BUY), the unlocks that wear a NEW badge, and where it stands.
export const HeroPickerProps = Schema.Struct({
  look: Appearance,
  chosen: Calling,
  trying: Schema.NullOr(Calling),
  rank: Schema.Finite,
  bought: SavedBoughtCosmetics,
  bones: Schema.Finite,
  fresh: Schema.Array(Schema.String),
  layout: PickerLayout,
})
export type HeroPickerProps = typeof HeroPickerProps.Type

// NOTE: Escape and Y, the key that opened it, close the picker.
const CLOSE_KEYS = [
  { key: 'Escape', message: Message.PressedCloseKey() },
  { key: 'y', message: Message.PressedCloseKey() },
] as const

// NOTE: the menus' corner close button (src/ui/cornerButtons.ts's look):
// a red pixel X on a 32 px face in a bigger see-through button.
const closeView = (h: Html.H<Message>): View.Content<Message> =>
  h.button
    .attrs({
      type: 'button',
      'aria-label': 'Close',
      'aria-keyshortcuts': 'Escape',
    })
    .class('menu-close panel-close')
    .on('click', Message.ClickedCloseButton())
    .children(
      h.span
        .class('menu-close-face')
        .attr('aria-hidden', 'true')
        .children(
          h.span.class('menu-close-icon').style(pixelArtStyle(CLOSE_ICON)),
        ),
    )

// NOTE: the cards, the Bones, and the actions, the same in both parents so
// the picker looks and lays out alike.
const bodyView = (props: HeroPickerProps, h: Html.H<Message>) => [
  callingCardsView(
    {
      look: props.look,
      chosen: props.chosen,
      rank: props.rank,
      bought: props.bought,
      trying: props.trying,
      fresh: props.fresh,
      isChosenFocused: props.layout === 'Panel',
      onCard: calling => Message.ClickedCard({ calling }),
    },
    h,
  ),
  callingBalanceView(props.bones, h),
  h.div.class('panel-actions calling-actions').children(
    props.trying !== null &&
      callingBuyView(
        {
          calling: props.trying,
          bones: props.bones,
          onBuy: Message.ClickedBuyButton({ calling: props.trying }),
        },
        h,
      ),
    closeView(h),
  ),
]

// NOTE: a component is called as `HeroPicker(h, { props, onEmit })`, a
// function Effect UI makes, with no data-last form to give it.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const HeroPicker = Html.component({
  name: 'HeroPicker',
  props: HeroPickerProps,
  model: Schema.Struct({}),
  message: Message,
  events: Events,
}).make({
  init: () => ({}),
  update: {
    ClickedCard: ($, { calling }) => $.emit(Events.Picked({ calling })),
    ClickedBuyButton: ($, { calling }) =>
      $.emit(Events.RequestedBuy({ calling })),
    ClickedCloseButton: $ => $.emit(Events.RequestedClose()),
    PressedCloseKey: $ => $.emit(Events.RequestedClose()),
  },
  subscriptions: () => [HtmlSubscription.shortcuts(CLOSE_KEYS)],
  // NOTE: inside the solo lobby's Dialog, under the title it draws, its box
  // taking no room of its own; over co-op's lobby while the room still
  // waits, the same panel, title and all, on a dim of its own.
  view: h =>
    h.props.layout === 'Panel'
      ? h.div.class('calling-picker').children(bodyView(h.props, h))
      : h.div
          .class('coop-calling-picker')
          .attrs({ role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hero' })
          .children(
            h.div
              .class('panel calling-panel')
              .children(
                h.h2.class('panel-title').children('Hero'),
                bodyView(h.props, h),
              ),
          ),
})
