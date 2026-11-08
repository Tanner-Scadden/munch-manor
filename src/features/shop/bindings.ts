import { DialogBlock } from '@foldkit/ui'

import { GuideBlock } from '../guide/block'
import { placedIn } from '../guide/model'
import { makeRequiredFieldBinding } from './block'
import { SHOP_DIALOG_ID, SHOP_TABS_ID, isShopShown } from './model'
import { ShopTabsBlock } from './shopTabs'

// NOTE: the shop dialog's children: the Dialog it stands in, its tab strip,
// and the guide its ? opens. A tab counts only while the dialog is up (the
// root also judges it by the World's shop: src/app/update/shop.ts,
// chooseCategory).
// Their folds are chosen in composition.ts, so the Steps that call them
// (steps.ts) and the folds import no cycle.

export const DialogBinding = makeRequiredFieldBinding(DialogBlock, {
  field: 'dialog',
  init: { contextToArgs: () => [{ id: SHOP_DIALOG_ID }] },
})

export const TabsBinding = makeRequiredFieldBinding(ShopTabsBlock, {
  field: 'tabs',
  init: { contextToArgs: () => [{ id: SHOP_TABS_ID }] },
  delivery: { when: isShopShown },
})

export const GuideBinding = makeRequiredFieldBinding(GuideBlock, {
  field: 'guide',
  init: { contextToArgs: () => placedIn('Shop') },
})
