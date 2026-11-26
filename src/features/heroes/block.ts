import { Schema } from 'effect'

import type { View } from '@effect/ui'
import { Html, HtmlSubscription } from '@effect/ui/html'

import { pixelArtStyle } from '#art/artSize.ts'
import { CLOSE_ICON } from '#art/icons.ts'
import {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '#shared/playerData.ts'

import {
  callingBalanceView,
  callingBuyView,
  callingCardsView,
} from './callingCards.ts'
import { Events, Message } from './message.ts'

const PickerLayout = Schema.Literals(['Panel', 'Overlay'])

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

const CLOSE_KEYS = [
  { key: 'Escape', message: Message.PressedCloseKey() },
  { key: 'y', message: Message.PressedCloseKey() },
] as const

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
