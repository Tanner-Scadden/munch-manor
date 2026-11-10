import { Option, Result } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { isRunOn } from '../../domain/onlineRun'
import { learnShop } from '../../features/onboarding/onboarding'
import { isShopGuideOpen } from '../../features/shop/model'
import { releaseAll } from '../../input/input'
import { burstCoins } from '../../render/particles/particles'
import { stepWhen } from '../../shared/stepWhen'
import { focusOf, focusSlotOf, modifyFocus } from '../../world/party/party'
import {
  ShopGood,
  StockTag,
  isBrowsing,
  maybeDisplacedFocus,
  shopItem,
  stockTag,
  suggestedItem,
} from '../../world/shop/shop'
import { ActionRefusal, SeatAction } from '../../world/step/stepWorld'
import { CoopBinding, ShopDialogBinding } from '../bindings'
import { makeStep } from '../definition'
import { refreshIntent } from '../frame'
import { isShopDialogOpen } from '../menuState'
import {
  type Model,
  type ShopCategory,
  ShopChatter,
  type ShopItemId,
  ShopState,
  TrapHint,
} from '../model'
import { tryAsLead } from './action'
import { type SoundCue, playSounds, uiCue } from './sound'
import {
  type UpdateStep,
  modelStep,
  toModel,
  unchanged,
  withInput,
} from './step'

// The root's side of Rattles' shop dialog (src/features/shop/, bound as
// ShopDialogBinding). The World is the truth for the shop: whether the
// player is at the counter, the tab, and the row in focus are the seat's
// `shop` and `shopCategory`. The dialog follows them (`syncShopDialog`), and
// what the player does in it comes up as the shop's OutMessages, made here
// as the seat's actions (src/app/composition.ts).

// LEAVING

const leaveShopModel = (model: Model): Model =>
  Result.match(tryAsLead(model, SeatAction.LeaveCounter()), {
    onFailure: () => model,
    onSuccess: refreshIntent,
  })

const leaveCounter = modelStep(leaveShopModel)

// NOTE: the shop dialog closed. In an online run the room hears LEAVE, so
// the player can walk off once it does.
const leaveShop = makeStep(model =>
  isRunOn(model)
    ? Update.combineSteps([
        leaveCounter,
        CoopBinding.requestPressAction({ action: SeatAction.LeaveCounter() }),
      ])
    : leaveCounter,
)

// NOTE: the dialog closed. At the counter with the guide up it was not the
// player leaving but Escape reaching for the guide, so the dialog opens
// again on the shelves (the shop closes the guide as it opens); otherwise
// the player leaves the counter.
const isGuideEscape = (model: Model): boolean =>
  isShopGuideOpen(model.shopDialog) && isBrowsing(focusOf(model).shop)

export const closedShop = makeStep(model =>
  isGuideEscape(model) ? ShopDialogBinding.requestOpen() : leaveShop,
)

// THE TABS

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

// NOTE: a tab counts only while the player is at the counter.
export const chooseCategory = (category: ShopCategory): UpdateStep =>
  stepWhen(
    model => isBrowsing(focusOf(model).shop),
    model => ({ model: selectShopCategory(model, category) }),
  )

// ENTERING AND LEAVING

const greetAtCounter: UpdateStep = stepModel => ({
  model: modifyFields(withInput(stepModel, releaseAll), {
    shopChatter: () => ShopChatter.Greeting(),
  }),
})

const enterShop = makeStep(() =>
  Update.combineSteps([
    greetAtCounter,
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
// the wave starts (src/world/waves/waves.ts, startWaveEarly). A dialog that
// failed to show resets to closed without its Closed fold, so the next
// frame leaves the counter; while it opens normally it is open by the end
// of the Step.
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

// NOTE: at the counter every key goes to the shop with the tab the player
// is looking at: the ? key (Slash) toggles its guide.
export const shopFromKey = (code: string) =>
  makeStep(model =>
    ShopDialogBinding.requestPressKey({
      code,
      section: focusOf(model).shopCategory,
    }),
  )

// BUYING

const purchaseCues = (): ReadonlyArray<SoundCue> => [uiCue('Purchase')]

// NOTE: a row picked in the dialog is the lead seat's Buy. A refusal
// shrugs, a buy rings up, and a row the buy moved focus off (a gun bought
// takes its row away) hands focus to the World's next row.
export const buy = (item: ShopItemId) =>
  makeStep(model =>
    Result.match(tryAsLead(model, SeatAction.Buy({ item })), {
      onFailure: refusal =>
        ActionRefusal.match(refusal, {
          NotNow: () => unchanged,
          Refused: () =>
            Update.combineSteps([
              toModel(refusedChatter(model, item)),
              playSounds([uiCue('Denied')]),
            ]),
        }),
      onSuccess: world => {
        const bought = withHint(item, world)
        return Update.combineSteps([
          toModel(
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
          ),
          playSounds(purchaseCues()),
          refocusDisplacedRow,
        ])
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

const refocusDisplacedRow = makeStep(model =>
  Option.match(maybeDisplacedFocus(model, focusSlotOf(model)), {
    onNone: () => unchanged,
    onSome: nextItem =>
      Update.combineSteps([
        modelStep(current => focusShopItem(current, nextItem)),
        ShopDialogBinding.requestFocusItem({ item: nextItem }),
      ]),
  }),
)

// FOCUS

// NOTE: a row focused, by the keyboard or a tap, is the seat's row in the
// World while the player browses.
const focusShopItem = (model: Model, item: ShopItemId): Model =>
  ShopState.match(focusOf(model).shop, {
    Away: () => model,
    Browsing: () =>
      modifyFocus(model, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    Dismissed: () => model,
  })

export const focusItem =
  (item: ShopItemId): UpdateStep =>
  model => ({ model: focusShopItem(model, item) })

// NOTE: an arrow key in the rows moves the World's focus and, while the
// player browses, the keyboard's with it.
export const moveFocus = (item: ShopItemId) =>
  makeStep(model =>
    isBrowsing(focusOf(model).shop)
      ? Update.combineSteps([
          focusItem(item),
          ShopDialogBinding.requestFocusItem({ item }),
        ])
      : unchanged,
  )
