import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { PROP_ICONS } from './callingArt'
import { callingCardsView } from './callingCards'
import { specialsNoteOf } from './callingSpecials'
import type { ApplicationViewBuilder } from './composition'
import { newPipView } from './lookGearView'
import { iconView } from './menuParts'
import { Message } from './message'
import type { Model } from './model'
import { CALLING_NAMES } from './names'
import { rankOf, totalPointsOf } from './rank'
import { hasUnseenCalling } from './unlocks'

// The hero pill by the difficulty on the home menu, and the picker it
// opens (src/callingCards.ts): five cards, each the player's own look
// wearing the hero's prop, with its specials.

type ButtonAttributes = Parameters<ApplicationViewBuilder['button']>[0]

// NOTE: the pill shows the chosen hero's prop, the one the next run
// starts with.
export const callingButtonView = (
  model: Model,
  attributes: ButtonAttributes,
  keyBadge: ReadonlyArray<Html>,
  h: ApplicationViewBuilder,
): Html => {
  const isNew = hasUnseenCalling(
    rankOf(totalPointsOf(model.rank)),
    model.seenUnlocks,
  )
  return h.button(
    [
      ...attributes,
      h.Class('home-pick home-calling'),
      h.DataAttribute('calling', model.calling),
      h.AriaLabel(
        `Hero: ${CALLING_NAMES[model.calling]}. ${specialsNoteOf(model.calling)}. Change it${isNew ? '. Something new' : ''}`,
      ),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedCallingBadge(), { propagation: 'Stop' }),
    ],
    [
      iconView('home-calling-icon', PROP_ICONS[model.calling], h),
      ...keyBadge,
      ...(isNew ? [newPipView(h)] : []),
    ],
  )
}

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
