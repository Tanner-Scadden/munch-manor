import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import {
  callingBalanceView,
  callingBuyView,
  callingCardsView,
} from './callingCards'
import { startingCallingOf } from './callingPick'
import type { ApplicationViewBuilder } from './composition'
import { Message } from './message'
import type { Bot, Model } from './model'
import { bonesBalanceOf, rankOf, totalPointsOf } from './rank'

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

export const callingBodyView: {
  (
    renderInfo: Dialog.RenderInfo,
    done: Html,
    h: ApplicationViewBuilder,
  ): (model: Model) => ReadonlyArray<Html>
  (
    model: Model,
    renderInfo: Dialog.RenderInfo,
    done: Html,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<Html>
} = Function.dual(
  4,
  (
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
    callingBalanceView(bonesBalanceOf(model.rank), h),
    h.div(
      [h.Class('panel-actions')],
      [
        ...Option.match(model.home.maybeTryingCalling, {
          onNone: () => [],
          onSome: calling => [
            callingBuyView(
              {
                calling,
                bones: bonesBalanceOf(model.rank),
                onBuy: Message.ClickedBuyCallingButton(),
              },
              h,
            ),
          ],
        }),
        done,
      ],
    ),
  ],
)
