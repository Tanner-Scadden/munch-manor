import { Array } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { CALLINGS, UNLOCK_RANKS } from './calling'
import { PROP_ICONS, QUIRK_MARKS } from './callingArt'
import { isPickable } from './callingPick'
import type { ApplicationViewBuilder } from './composition'
import { portraitOf } from './coop/icons'
import { PADLOCK_ICON } from './icons'
import { newBadgeView, newPipView } from './lookGearView'
import { iconView } from './menuParts'
import { Message } from './message'
import type { Model } from './model'
import { CALLING_NAMES, CALLING_NOTES } from './names'
import type { Calling } from './playerData'
import { rankOf, totalPointsOf } from './rank'
import { rankMarkView } from './rankBadgeView'
import { callingUnlockId, hasUnseenCalling } from './unlocks'

// The calling pill by the difficulty on the home menu, and the picker it
// opens: five cards, each the player's own look wearing the calling's prop
// with its quirk as pictures, and the locked ones as dark shapes with the
// rank that opens them. Pictures and numbers only; the words are read aloud.

type ButtonAttributes = Parameters<ApplicationViewBuilder['button']>[0]

// NOTE: the pill shows the chosen calling's prop, the one the next run
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
        `Calling: ${CALLING_NAMES[model.calling]}. ${CALLING_NOTES[model.calling]}. Change it${isNew ? '. Something new' : ''}`,
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
  title: 'Calling',
  blurb: 'Pick what you bring to a run.',
})

const quirkView = (
  mark: (typeof QUIRK_MARKS)[Calling][number],
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [h.Class('calling-quirk'), h.AriaHidden(true)],
    [
      iconView('calling-quirk-icon', mark.art, h),
      ...(mark.label === ''
        ? []
        : [h.span([h.Class('calling-quirk-sign')], [mark.label])]),
    ],
  )

const cardView = (
  model: Model,
  calling: Calling,
  renderInfo: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): Html => {
  const isOpen = isPickable(model, calling)
  const isChosen = calling === model.calling
  const need = UNLOCK_RANKS[calling]
  const isNew = Array.contains(model.freshUnlocks, callingUnlockId(calling))
  return h.button(
    [
      ...(isChosen ? renderInfo.initialFocus : []),
      h.Type('button'),
      h.Class('calling-card'),
      h.DataAttribute('calling', calling),
      h.DataAttribute('lock', isOpen ? 'Open' : 'Locked'),
      ...(isChosen ? [h.DataAttribute('chosen', 'Chosen')] : []),
      ...(isNew ? [h.DataAttribute('new', 'true')] : []),
      h.AriaLabel(
        isOpen
          ? `${CALLING_NAMES[calling]}: ${CALLING_NOTES[calling]}`
          : `Locked. Reach rank ${need} to unlock`,
      ),
      ...(isOpen ? [] : [h.AriaDisabled(true)]),
      h.OnClick(Message.ClickedCallingCardButton({ calling }), {
        focusSelector: '.game-surface',
        propagation: 'Stop',
      }),
    ],
    [
      h.span(
        [h.Class('calling-figure'), h.AriaHidden(true)],
        [
          h.span([
            h.Class('calling-figure-img'),
            h.Style({ backgroundImage: portraitOf(model.appearance, calling) }),
          ]),
        ],
      ),
      isOpen
        ? h.span(
            [h.Class('calling-quirks')],
            Array.map(QUIRK_MARKS[calling], mark => quirkView(mark, h)),
          )
        : h.span(
            [h.Class('calling-need'), h.AriaHidden(true)],
            [
              iconView('calling-lock-icon', PADLOCK_ICON, h),
              rankMarkView(need, h),
            ],
          ),
      ...(isNew ? [newBadgeView(h)] : []),
    ],
  )
}

export const callingBodyView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  done: Html,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  h.div(
    [h.Class('calling-cards')],
    Array.map(CALLINGS, calling => cardView(model, calling, renderInfo, h)),
  ),
  h.div([h.Class('panel-actions')], [done]),
]
