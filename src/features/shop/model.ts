import { Schema } from 'effect'

import { DialogBlock } from '@foldkit/ui'

import { GuideBlock } from '../guide/block'
import { isGuideOpen } from '../guide/model'
import { ShopTabsBlock } from './shopTabs'

export const SHOP_DIALOG_ID = 'shop'

export const SHOP_TABS_ID = 'shop-tabs'

// NOTE: the shop dialog's own state: the Dialog it stands in, its tab strip,
// and the guide its ? opens, each a child on its own field. What it shows
// (the seat's wallet and guns, the open tab, the row in focus, whether the
// player is at the counter at all) is the World's, handed to its view
// (`ViewInputs` in block.ts) and kept in step by the root's
// `syncShopDialog` (src/app/update/shop.ts).
export const Model = Schema.Struct({
  dialog: DialogBlock.Model,
  tabs: ShopTabsBlock.Model,
  guide: GuideBlock.Model,
})
export type Model = typeof Model.Type

// NOTE: reads for the root, so it never reads the shop's fields: whether
// the dialog is up, and whether its guide is.
export const isShopShown = (model: Model): boolean => model.dialog.isOpen

// NOTE: shut is neither open nor playing its leave animation: the dialog
// shows nothing at all.
export const isShopShut = (model: Model): boolean =>
  !model.dialog.isOpen && model.dialog.animation.transitionState === 'Idle'

export const isShopGuideOpen = (model: Model): boolean =>
  isGuideOpen(model.guide)
