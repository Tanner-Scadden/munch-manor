import { Effect, Function, Schema } from 'effect'
import { Dom, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ShopDialogBinding } from '../bindings'
import { ApplicationBlock, makeStep } from '../definition'
import { isShopDialogOpen } from '../menuState'
import { Message } from '../message'
import { type Model, ShopGuide, type ShopGuideSection } from '../model'
import { focusOf } from '../party'
import { isBrowsing } from '../shop'
import { SHOP_GUIDE_BACK_ID, SHOP_GUIDE_OPEN_ID } from '../shopGuide'
import { stepWhen } from '../stepWhen'
import { type UpdateReturn, type UpdateStep, modelStep } from './step'

// THE ? IN RATTLES' SHOP

// NOTE: the guide stands in the shop dialog's body (src/shopGuideView.ts).
// The ? opens it on the tab the player is looking at, BACK returns to the
// shelves, and a Close the dialog did not ask for, such as Escape, goes
// back to the shelves too while the player is still at the counter.

const FocusTarget = Schema.Literals(['Back', 'Open'])

export const FocusShopGuide = ApplicationBlock.makeCommand('FocusShopGuide', {
  args: { target: FocusTarget },
  messages: [Message.CompletedFocusShopGuide],
  handler: function* () {
    return ({ target }) =>
      Dom.focus(
        `#${target === 'Back' ? SHOP_GUIDE_BACK_ID : SHOP_GUIDE_OPEN_ID}`,
      ).pipe(Effect.ignore, Effect.as(Message.CompletedFocusShopGuide()))
  },
})

export const openShopGuide = (model: Model): UpdateReturn =>
  isShopDialogOpen(model)
    ? {
        model: modifyFields(model, {
          shopGuide: () =>
            ShopGuide.Open({ section: focusOf(model).shopCategory }),
        }),
        commands: [FocusShopGuide({ target: 'Back' })],
      }
    : { model }

export const showShopGuide: {
  (section: ShopGuideSection): (model: Model) => Model
  (model: Model, section: ShopGuideSection): Model
} = Function.dual(2, (model: Model, section: ShopGuideSection): Model =>
  ShopGuide.isAnyOf(['Open'])(model.shopGuide)
    ? modifyFields(model, { shopGuide: () => ShopGuide.Open({ section }) })
    : model,
)

const closedGuide = (model: Model): Model =>
  modifyFields(model, { shopGuide: () => ShopGuide.Closed() })

export const closeShopGuide = (model: Model): UpdateReturn =>
  ShopGuide.isAnyOf(['Open'])(model.shopGuide)
    ? {
        model: closedGuide(model),
        commands: [FocusShopGuide({ target: 'Open' })],
      }
    : { model }

// NOTE: the guide is gone as the player comes to the counter, so the shop
// always opens on its shelves.
export const forgetShopGuide = modelStep(closedGuide)

// NOTE: the dialog closed. At the counter with the guide up it was not the
// player leaving but Escape reaching for the guide, so the guide closes and
// the dialog opens again; otherwise the shop's own close goes ahead.
export const isGuideEscape = (model: Model): boolean =>
  ShopGuide.isAnyOf(['Open'])(model.shopGuide) &&
  isBrowsing(focusOf(model).shop)

export const reopenForGuide = makeStep(() =>
  Update.combineSteps([
    modelStep(closedGuide),
    ShopDialogBinding.requestOpen(),
  ]),
)

// NOTE: the ? key (Slash) toggles the guide while the player is at the
// counter, so the shop's guide is reachable without a pointer.
const SHOP_GUIDE_KEY = 'Slash'

const toggleShopGuide: UpdateStep = stepModel =>
  ShopGuide.match(stepModel.shopGuide, {
    Closed: () => openShopGuide(stepModel),
    Open: () => closeShopGuide(stepModel),
  })

export const shopGuideFromKey = (code: string): UpdateStep =>
  stepWhen(() => code === SHOP_GUIDE_KEY, toggleShopGuide)
