import { Effect, Function, Option, Result } from 'effect'
import { Dom, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { CoopBinding, ShopDialogBinding } from '../bindings'
import { ApplicationDefinition, makeStep } from '../definition'
import { refreshIntent } from '../frame'
import { releaseAll } from '../input'
import { isShopDialogOpen } from '../menuState'
import { Message } from '../message'
import {
  type Model,
  type ShopCategory,
  ShopChatter,
  ShopItemId,
  ShopState,
  TrapHint,
} from '../model'
import { learnShop } from '../onboarding'
import { isRunOn } from '../onlineRun'
import { burstCoins } from '../particles'
import { focusOf, focusSlotOf, modifyFocus } from '../party'
import {
  ShopGood,
  StockTag,
  isBrowsing,
  maybeDisplacedFocus,
  shopItem,
  shopItemElementId,
  stockTag,
  suggestedItem,
} from '../shop'
import { ActionRefusal, SeatAction } from '../stepWorld'
import { tryAsLead } from './action'
import { forgetShopGuide } from './shopGuide'
import { type SoundCue, playSounds, uiCue } from './sound'
import {
  type UpdateReturn,
  type UpdateStep,
  combine,
  modelStep,
  unchanged,
  withInput,
} from './step'

// COMMAND

export const FocusShopItem = ApplicationDefinition.makeCommand(
  'FocusShopItem',
  {
    args: { item: ShopItemId },
    messages: [Message.CompletedFocusShopItem],
    handler: function* () {
      return ({ item }) =>
        Dom.focus(`#${shopItemElementId(item)}`).pipe(
          Effect.ignore,
          Effect.as(Message.CompletedFocusShopItem()),
        )
    },
  },
)

// DIALOG

const leaveShopModel = (model: Model): Model =>
  Result.match(tryAsLead(model, SeatAction.LeaveCounter()), {
    onFailure: () => model,
    onSuccess: refreshIntent,
  })

const leaveCounter = modelStep(leaveShopModel)

// NOTE: the shop dialog closed. In an online run the room hears LEAVE, so
// the player can walk off once it does.
export const leaveShop = makeStep(model =>
  isRunOn(model)
    ? Update.combineSteps([
        leaveCounter,
        CoopBinding.requestPressAction({ action: SeatAction.LeaveCounter() }),
      ])
    : leaveCounter,
)

const selectShopCategory = (model: Model, category: ShopCategory): Model =>
  modifyFocus(
    modifyFields(model, { shopChatter: () => ShopChatter.Greeting() }),
    {
      shopCategory: () => category,
      shop: shop =>
        ShopState.match(shop, {
          Away: () => shop,
          Browsing: () =>
            ShopState.Browsing({
              focusedItem: suggestedItem(model, focusSlotOf(model), category),
            }),
          Dismissed: () => shop,
        }),
    },
  )

export const selectCategory =
  (category: ShopCategory): UpdateStep =>
  stepModel => ({ model: selectShopCategory(stepModel, category) })

// ENTERING AND LEAVING

const greetAtCounter: UpdateStep = stepModel => ({
  model: modifyFields(withInput(stepModel, releaseAll), {
    shopChatter: () => ShopChatter.Greeting(),
  }),
})

const enterShop = makeStep(() =>
  Update.combineSteps([
    greetAtCounter,
    forgetShopGuide,
    ShopDialogBinding.requestOpen(),
    playSounds([uiCue('ShopBell')]),
  ]),
)

export const closeShop = makeStep(model =>
  isBrowsing(focusOf(model).shop)
    ? Update.combineSteps([ShopDialogBinding.requestClose(), leaveCounter])
    : unchanged,
)

// NOTE: the shop dialog follows the World's shop after each frame, single
// player's and an online run's alike. It opens as the player arrives at the
// counter (`wasBrowsing` is the shop before the frame: an online run reads
// the room's), and closes once the World has them away from it, as when
// the wave starts (src/waves.ts, startWaveEarly). A dialog that failed to
// show resets to closed without its Closed fold, so the next frame leaves
// the counter; while it opens normally it is open by the end of the Step.
export const syncShopDialog = (wasBrowsing: boolean) =>
  makeStep(model => {
    const isAtCounterNow = isBrowsing(focusOf(model).shop)
    if (isAtCounterNow && !wasBrowsing) {
      return Update.combineSteps([modelStep(learnShop), enterShop])
    } else if (!isAtCounterNow && isShopDialogOpen(model)) {
      return ShopDialogBinding.requestClose()
    } else if (isAtCounterNow && !isShopDialogOpen(model)) {
      return leaveShop
    } else {
      return unchanged
    }
  })

// BUYING

const purchaseCues = (item: ShopItemId): ReadonlyArray<SoundCue> =>
  ShopGood.isAnyOf(['Upgrade'])(shopItem(item).good)
    ? [uiCue('Purchase'), uiCue('PowerUp')]
    : [uiCue('Purchase')]

export const buy: {
  (item: ShopItemId): (model: Model) => UpdateReturn
  (model: Model, item: ShopItemId): UpdateReturn
} = Function.dual(2, (model: Model, item: ShopItemId): UpdateReturn =>
  Result.match(tryAsLead(model, SeatAction.Buy({ item })), {
    onFailure: refusal =>
      ActionRefusal.match(refusal, {
        NotNow: () => ({ model }),
        Refused: () =>
          playSounds([uiCue('Denied')])(refusedChatter(model, item)),
      }),
    onSuccess: world => {
      const bought = withHint(item, world)
      return combine(
        modifyFields(
          burstCoins(
            bought,
            focusOf(bought).player.x,
            focusOf(bought).player.y,
          ),
          {
            shopChatter: () => ShopChatter.Bought({ item }),
          },
        ),
        [playSounds(purchaseCues(item)), refocusDisplacedRow],
      )
    },
  }),
)

// NOTE: the first trap a player stocks brings up the hint for placing it.
const showTrapHint = (model: Model): Model =>
  modifyFields(model, {
    trapHint: hint =>
      TrapHint.match(hint, {
        Unseen: () => TrapHint.Showing(),
        Showing: () => hint,
        Seen: () => hint,
      }),
  })

const withHint = (item: ShopItemId, model: Model): Model =>
  ShopGood.isAnyOf(['Trap'])(shopItem(item).good) ? showTrapHint(model) : model

const refusedChatter = (model: Model, item: ShopItemId): Model =>
  modifyFields(model, {
    shopChatter: () =>
      StockTag.isAnyOf(['Short'])(stockTag(model, focusSlotOf(model), item))
        ? ShopChatter.TooPricey({ item })
        : ShopChatter.Refused({ item }),
  })

const refocusDisplacedRow: UpdateStep = stepModel =>
  Option.match(maybeDisplacedFocus(stepModel, focusSlotOf(stepModel)), {
    onNone: () => ({ model: stepModel }),
    onSome: nextItem => ({
      model: focusShopItem(stepModel, nextItem),
      commands: [FocusShopItem({ item: nextItem })],
    }),
  })

// FOCUS

export const focusShopItem: {
  (item: ShopItemId): (model: Model) => Model
  (model: Model, item: ShopItemId): Model
} = Function.dual(2, (model: Model, item: ShopItemId): Model =>
  ShopState.match(focusOf(model).shop, {
    Away: () => model,
    Browsing: () =>
      modifyFocus(model, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    Dismissed: () => model,
  }),
)

export const moveShopFocus: {
  (item: ShopItemId): (model: Model) => UpdateReturn
  (model: Model, item: ShopItemId): UpdateReturn
} = Function.dual(2, (model: Model, item: ShopItemId): UpdateReturn =>
  isBrowsing(focusOf(model).shop)
    ? { model: focusShopItem(model, item), commands: [FocusShopItem({ item })] }
    : { model },
)
