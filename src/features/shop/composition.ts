import type { Block } from 'foldkit'

import { DialogBlock } from '@foldkit/ui'

import { DialogBinding, GuideBinding, TabsBinding } from './bindings'
import {
  ShopBlock,
  makeComposition,
  makeNoopStep,
  makeOutMessageStep,
} from './block'
import { OutMessage } from './message'
import { ShopTabsBlock } from './shopTabs'

// NOTE: the shop's children and their folds. The Dialog opening shows the
// shelves, not the guide; its closing goes up as Closed for the root to
// judge. A tab goes up to the root, which keeps the seat's tab in the
// World. The guide tells the shop nothing, so it has no fold.

const DialogBindingWithOutMessagePolicy = DialogBinding.withOutMessagePolicy({
  fold: ShopBlock.makeOutMessageFold(DialogBlock, {
    Opened: () => GuideBinding.requestClose(),
    Closed: () => makeOutMessageStep(() => OutMessage.Closed()),
    CompletedClose: makeNoopStep,
  }),
})

const TabsBindingWithOutMessagePolicy = TabsBinding.withOutMessagePolicy({
  fold: ShopBlock.makeOutMessageFold(ShopTabsBlock, {
    Selected: ({ value }) =>
      makeOutMessageStep(() => OutMessage.ChoseCategory({ category: value })),
  }),
})

export const ShopComposition = makeComposition({
  bindings: [
    DialogBindingWithOutMessagePolicy,
    TabsBindingWithOutMessagePolicy,
    GuideBinding,
  ],
})
export type ShopViewBuilder = Block.ViewBuilderFor<typeof ShopComposition>
