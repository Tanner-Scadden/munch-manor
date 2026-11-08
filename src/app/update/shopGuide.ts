import { Update } from 'foldkit'

import { isGuideOpen } from '../../features/guide/model'
import { focusOf } from '../../world/party/party'
import { isBrowsing } from '../../world/shop/shop'
import { ShopDialogBinding, ShopGuideBinding } from '../bindings'
import { makeStep } from '../definition'
import { isShopDialogOpen } from '../menuState'
import type { Model } from '../model'
import { unchanged } from './step'

// NOTE: the root's side of the shop guide in Rattles' shop
// (src/features/guide/, bound as ShopGuideBinding). The ? opens it on the
// tab the player is looking at, the ? key toggles it, and a Close the
// dialog did not ask for, such as Escape, goes back to the shelves while
// the player is still at the counter. The guide turns its sections, goes
// back, and moves focus on its own.

const sectionOf = (model: Model) => ({ section: focusOf(model).shopCategory })

export const openShopGuide = makeStep(model =>
  isShopDialogOpen(model)
    ? ShopGuideBinding.requestOpen(sectionOf(model))
    : unchanged,
)

// NOTE: the ? key (Slash) toggles the guide while the player is at the
// counter, so the shop's guide is reachable without a pointer. It opens
// only over the shop dialog, and an open guide always closes.
const SHOP_GUIDE_KEY = 'Slash'

export const shopGuideFromKey = (code: string) =>
  makeStep(model =>
    code === SHOP_GUIDE_KEY &&
    (isShopDialogOpen(model) || isGuideOpen(model.shopGuide))
      ? ShopGuideBinding.requestToggle(sectionOf(model))
      : unchanged,
  )

// NOTE: the dialog closed. At the counter with the guide up it was not the
// player leaving but Escape reaching for the guide, so the guide closes and
// the dialog opens again; otherwise the shop's own close goes ahead.
export const isGuideEscape = (model: Model): boolean =>
  isGuideOpen(model.shopGuide) && isBrowsing(focusOf(model).shop)

export const reopenForGuide = makeStep(() =>
  Update.combineSteps([
    ShopGuideBinding.requestClose(),
    ShopDialogBinding.requestOpen(),
  ]),
)
