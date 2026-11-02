import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { callingPriceOf } from './calling'
import { callingCardsView } from './callingCards'
import { startingCallingOf } from './callingPick'
import type { ApplicationViewBuilder } from './composition'
import { Message } from './message'
import type { Bot, Model } from './model'
import type { Calling } from './playerData'
import { bonesBalanceOf, rankOf, totalPointsOf } from './rank'
import { boneCountView } from './rankBadgeView'

// The hero picker the lobby's hero card opens (src/callingCards.ts): five
// cards, each the player's own look wearing the hero's prop, with its
// specials.

// NOTE: the bot whose hero the picker is choosing, when the lobby's bot card
// opened it.
const maybeBotOf = (model: Model): Option.Option<Bot> =>
  Option.flatMap(model.home.maybePickingBot, index =>
    Array.get(model.home.bots, index),
  )

export const callingPanelText = (
  model: Model,
): Readonly<{
  title: string
  blurb: string
}> => ({
  title: 'Hero',
  blurb: Option.match(maybeBotOf(model), {
    onNone: () => 'Pick who you play.',
    onSome: bot => `Pick for ${bot.name}.`,
  }),
})

// NOTE: the player's Bones by the title, so a price has its context.
const balanceView = (model: Model, h: ApplicationViewBuilder): Html => {
  const bones = bonesBalanceOf(model.rank)
  return h.div(
    [
      h.Class('calling-balance'),
      h.Role('group'),
      h.AriaLabel(`${bones} Bones`),
    ],
    [boneCountView(bones, 'calling-balance-count', h)],
  )
}

// NOTE: the BUY button: a bright gold arcade button when the Bones cover
// the hero, dim and red with how many more it needs when they do not.
const buyButtonView = (
  model: Model,
  calling: Calling,
  h: ApplicationViewBuilder,
): Html => {
  const price = Option.getOrElse(callingPriceOf(calling), () => 0)
  const lacking = Math.max(0, price - bonesBalanceOf(model.rank))
  return h.button(
    [
      h.Type('button'),
      h.Key('calling-buy'),
      h.Class('calling-buy'),
      h.AriaLabel(
        lacking > 0
          ? `Buy for ${price} Bones, too few`
          : `Buy for ${price} Bones`,
      ),
      ...(lacking > 0
        ? [h.Disabled(true), h.DataAttribute('short', 'true')]
        : [h.OnClick(Message.ClickedBuyCallingButton())]),
    ],
    [
      h.span([h.Class('calling-buy-word'), h.AriaHidden(true)], ['BUY']),
      boneCountView(price, 'calling-buy-price', h),
      ...(lacking > 0
        ? [
            h.span(
              [h.Class('calling-buy-need'), h.AriaHidden(true)],
              [`NEED ${lacking} MORE`],
            ),
          ]
        : []),
    ],
  )
}

export const callingBodyView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  done: Html,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  callingCardsView(
    {
      look: Option.match(maybeBotOf(model), {
        onNone: () => model.appearance,
        onSome: bot => bot.look,
      }),
      chosen: Option.match(maybeBotOf(model), {
        onNone: () => startingCallingOf(model),
        onSome: bot => bot.calling,
      }),
      rank: rankOf(totalPointsOf(model.rank)),
      bought: model.boughtCosmetics,
      maybeTrying: model.home.maybeTryingCalling,
      fresh: model.freshUnlocks,
      attributesOf: (calling, isChosen) => [
        ...(isChosen ? renderInfo.initialFocus : []),
        h.OnClick(Message.ClickedCallingCardButton({ calling }), {
          focusSelector: '.game-surface',
          propagation: 'Stop',
        }),
      ],
    },
    h,
  ),
  balanceView(model, h),
  h.div(
    [h.Class('panel-actions')],
    [
      ...Option.match(model.home.maybeTryingCalling, {
        onNone: () => [],
        onSome: calling => [buyButtonView(model, calling, h)],
      }),
      done,
    ],
  ),
]
