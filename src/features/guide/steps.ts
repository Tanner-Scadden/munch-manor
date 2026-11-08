import { Effect, Schema } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { ShopGuideSection } from '../../shared/nameKeys'
import { GuideBlock } from './block'
import { Message } from './message'
import {
  GUIDE_FOCUS_IDS,
  GuidePlacement,
  GuideStatus,
  type Model,
  isGuideOpen,
} from './model'

// The guide's own transitions, shared by its update and its InMessages
// (FOLDKIT.md, "File organization").

// FOCUS

// NOTE: opening puts focus on BACK; going back puts it on the button that
// opened the guide, so the keyboard never lands on nothing.
const FocusTarget = Schema.Literals(['Back', 'Opener'])
type FocusTarget = typeof FocusTarget.Type

export const FocusGuideControl = GuideBlock.makeCommand('FocusGuideControl', {
  args: { placement: GuidePlacement, target: FocusTarget },
  messages: [Message.CompletedFocusControl],
  handler: function* () {
    return ({ placement, target }) =>
      Dom.focus(
        `#${target === 'Back' ? GUIDE_FOCUS_IDS[placement].back : GUIDE_FOCUS_IDS[placement].opener}`,
      ).pipe(Effect.ignore, Effect.as(Message.CompletedFocusControl()))
  },
})

const focus = (model: Model, target: FocusTarget) =>
  FocusGuideControl({ placement: model.placement, target })

// OPENING AND CLOSING

const withStatus = (model: Model, status: GuideStatus): Model =>
  modifyFields(model, { status: () => status })

export const open = (section: ShopGuideSection) => (model: Model) => ({
  model: withStatus(model, GuideStatus.Open({ section })),
  commands: [focus(model, 'Back')],
})

// NOTE: shut with nothing focused, for a parent that focuses something of
// its own next.
export const closeQuietly = (model: Model): Model =>
  withStatus(model, GuideStatus.Closed())

export const goBack = (model: Model) =>
  isGuideOpen(model)
    ? { model: closeQuietly(model), commands: [focus(model, 'Opener')] }
    : { model }

// NOTE: a section button turns an open guide; a shut one has none to tap.
export const showSection =
  (section: ShopGuideSection) =>
  (model: Model): Model =>
    isGuideOpen(model)
      ? withStatus(model, GuideStatus.Open({ section }))
      : model
