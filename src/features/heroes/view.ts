import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import { closeButtonView } from '../../app/dialogs'
import type { ViewInputs } from './block'
import {
  callingBalanceView,
  callingBuyView,
  callingCardsView,
} from './callingCards'
import {
  HeroPickerComposition,
  type HeroPickerViewBuilder,
} from './composition'
import { Message } from './message'
import { type Model, isPickerOpen } from './model'

// The hero picker (GAME_DESIGN.md, "Rank and Bones"): five cards, each the
// player's own look wearing the hero's prop, with its specials, the Bones,
// and BUY for a hero being tried on. src/features/heroes/callingCards.ts
// draws the cards.

const cardsView = (
  model: Model,
  inputs: ViewInputs,
  h: HeroPickerViewBuilder,
): Html =>
  callingCardsView(
    {
      look: inputs.look,
      chosen: inputs.chosen,
      rank: inputs.rank,
      bought: inputs.bought,
      maybeTrying: model.maybeTrying,
      fresh: inputs.fresh,
      attributesOf: calling => [
        inputs.layout === 'Panel'
          ? h.OnClick(Message.ClickedCard({ calling }), {
              focusSelector: '.game-surface',
              propagation: 'Stop',
            })
          : h.OnClick(Message.ClickedCard({ calling })),
      ],
    },
    h,
  )

const buyView = (
  model: Model,
  inputs: ViewInputs,
  h: HeroPickerViewBuilder,
): ReadonlyArray<Html> =>
  Option.match(model.maybeTrying, {
    onNone: () => [],
    onSome: calling => [
      callingBuyView(
        { calling, bones: inputs.bones, onBuy: Message.ClickedBuyButton() },
        h,
      ),
    ],
  })

const closeView = (className: string, h: HeroPickerViewBuilder): Html =>
  closeButtonView(
    {
      attributes: [h.OnClick(Message.ClickedCloseButton())],
      className,
      label: 'Close',
    },
    h,
  )

// NOTE: inside the solo lobby's Dialog, under the title it draws: the
// cards, the Bones, and the actions. Its box takes no room of its own, so
// the panel lays them out as before.
const panelView = (
  model: Model,
  inputs: ViewInputs,
  h: HeroPickerViewBuilder,
): Html =>
  h.div(
    [h.Class('calling-picker')],
    [
      cardsView(model, inputs, h),
      callingBalanceView(inputs.bones, h),
      h.div(
        [h.Class('panel-actions')],
        [...buyView(model, inputs, h), closeView('panel-close', h)],
      ),
    ],
  )

// NOTE: over co-op's lobby while the room still waits, with its own head.
// A card the player's rank has not reached stays shut with the rank it
// needs.
const overlayView = (
  model: Model,
  inputs: ViewInputs,
  h: HeroPickerViewBuilder,
): Html =>
  h.div(
    [
      h.Class('coop-calling-picker'),
      h.Role('dialog'),
      h.AriaModal(true),
      h.AriaLabel('Hero'),
    ],
    [
      h.div(
        [h.Class('coop-calling-picker-head')],
        [
          callingBalanceView(inputs.bones, h),
          h.span([h.Class('coop-calling-picker-title')], ['Hero']),
          closeView('coop-close', h),
        ],
      ),
      cardsView(model, inputs, h),
      ...Array.match(buyView(model, inputs, h), {
        onEmpty: () => [],
        onNonEmpty: buy => [h.div([h.Class('coop-calling-actions')], buy)],
      }),
    ],
  )

const view = HeroPickerComposition.makeView.withInputs<ViewInputs>(
  (model, inputs, h) => {
    if (!isPickerOpen(model)) {
      return h.empty
    } else if (inputs.layout === 'Panel') {
      return panelView(model, inputs, h)
    } else {
      return overlayView(model, inputs, h)
    }
  },
)

// NOTE: the picker's view, gathered here so it is not exported alone: a
// view is a function of three arguments with no pipeable form, and Foldkit
// knows a view by its identity. src/features/heroes/layer.ts completes it.
export const heroPickerImplementation = { view }
