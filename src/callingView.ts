import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { callingCardsView } from './callingCards'
import type { ApplicationViewBuilder } from './composition'
import { Message } from './message'
import type { Model } from './model'
import { rankOf, totalPointsOf } from './rank'

// The hero picker the lobby's hero card opens (src/callingCards.ts): five
// cards, each the player's own look wearing the hero's prop, with its
// specials.

export const callingPanelText = (): Readonly<{
  title: string
  blurb: string
}> => ({
  title: 'Hero',
  blurb: 'Pick who you play.',
})

export const callingBodyView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  done: Html,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  callingCardsView(
    {
      look: model.appearance,
      chosen: model.calling,
      rank: rankOf(totalPointsOf(model.rank)),
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
  h.div([h.Class('panel-actions')], [done]),
]
