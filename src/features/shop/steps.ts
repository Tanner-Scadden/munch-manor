import { Effect } from 'effect'
import { Dom } from 'foldkit'

import type { ShopGuideSection } from '../../shared/nameKeys'
import { ShopItemId } from '../../world/schema/worldSchema'
import { shopItemElementId } from '../../world/shop/shop'
import { DialogBinding, GuideBinding } from './bindings'
import { ShopBlock, makeNoopStep, makeStep } from './block'
import { Message } from './message'
import { type Model, isShopGuideOpen, isShopShown } from './model'

// The shop's own transitions, shared by its update and its InMessages
// (FOLDKIT.md, "File organization"). Buying, the row in focus, and the tab
// are the World's: here they only move the keyboard's focus and open and
// close what the shop draws.

// FOCUS

export const FocusItem = ShopBlock.makeCommand('FocusItem', {
  args: { item: ShopItemId },
  messages: [Message.CompletedFocusItem],
  handler: function* () {
    return ({ item }) =>
      Dom.focus(`#${shopItemElementId(item)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusItem()),
      )
  },
})

export const focusItem = (item: ShopItemId) => (model: Model) => ({
  model,
  commands: [FocusItem({ item })],
})

// OPENING AND CLOSING

// NOTE: the player reached the counter, or Escape only put the guide away:
// the shelves show. The Dialog opening closes the guide (its Opened fold in
// composition.ts): the Dialog's operations tell the shop it opened or
// closed, so they are returned alone, never combined.
export const open = makeStep(model =>
  isShopShown(model)
    ? GuideBinding.requestClose()
    : DialogBinding.requestOpen(),
)

// THE GUIDE

// NOTE: the ? opens the guide on the tab the player is looking at, over
// the dialog only.
export const openGuide = (section: ShopGuideSection) =>
  makeStep(model =>
    isShopShown(model) ? GuideBinding.requestOpen({ section }) : makeNoopStep(),
  )

// NOTE: the ? key (Slash) toggles the guide while the player is at the
// counter, so the shop's guide is reachable without a pointer. It opens
// only over the shop dialog, and an open guide always closes.
const GUIDE_KEY = 'Slash'

type KeyPress = Readonly<{ code: string; section: ShopGuideSection }>

export const pressKey = ({ code, section }: KeyPress) =>
  makeStep(model =>
    code === GUIDE_KEY && (isShopShown(model) || isShopGuideOpen(model))
      ? GuideBinding.requestToggle({ section })
      : makeNoopStep(),
  )
