// The shop tests' shared setup: a break beside the stall, the shop open on
// a row, money, hearts, and guns. src/features/shop/__tests__/shop.story.test.ts and
// src/features/shop/__tests__/shopDialog.story.test.ts start from it.

import { Function, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  type Arsenal,
  type CarriedGun,
  type Model,
  Phase,
  type ShopItemId,
  ShopState,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  pastFirstBreak,
  withPlayerAt,
} from '../../../test/model.fixture'
import { holdingSecond, showDialog } from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { magazineOf } from '../../../world/gear/weapons'
import { modifyFocus } from '../../../world/party/party'
import { STALL_BOX } from '../../../world/shop/shop'
import { Message as ShopMessage } from '../message'
import { FocusItem } from '../steps'

export const SHOP_FRAME_MS = 50
export const FRAMES_TO_STALL = 3

export const shopReady: Model = modifyFields(
  pastFirstBreak(asVeteran(initialModel)),
  {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  },
)

export const GRACE_TICK_MS = 50
export const resolveShowShop = showDialog()

export const preparing = (wave: number): Phase =>
  Phase.Preparation({
    wave,
    remainingMs: 15_000,
    durationMs: PREPARATION_MS,
    spawns: [DISTANT_SPAWN],
  })

export const besideStall = (phase: Phase): Model =>
  modifyFields(withPlayerAt(shopReady, BESIDE_STALL.x, BESIDE_STALL.y), {
    phase: () => phase,
  })

export const withMoney: {
  (balance: number): (base: Model) => Model
  (base: Model, balance: number): Model
} = Function.dual(2, (base: Model, balance: number): Model =>
  modifyFocus(base, {
    wallet: () => ({ balance, earned: balance, shown: balance }),
  }),
)

export const browsing = (base: Model): Model =>
  modifyFocus(modifyFields(base, { phase: () => preparing(2) }), {
    shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
  })

export const resolveFocusShopItem = Story.Command.resolve(
  FocusItem,
  ShopMessage.CompletedFocusItem(),
)

export const focusedOn: {
  (item: ShopItemId): (base: Model) => Model
  (base: Model, item: ShopItemId): Model
} = Function.dual(2, (base: Model, item: ShopItemId): Model =>
  modifyFocus(base, { shop: () => ShopState.Browsing({ focusedItem: item }) }),
)

export const withHp: {
  (hp: number): (base: Model) => Model
  (base: Model, hp: number): Model
} = Function.dual(2, (base: Model, hp: number): Model =>
  modifyFocus(base, {
    player: player => modifyFields(player, { hp: () => hp }),
  }),
)

// NOTE: data first when the kind leads: a kind is a string, rounds are not.
export const gun: {
  (rounds: number, tier?: number): (kind: CarriedGun['kind']) => CarriedGun
  (kind: CarriedGun['kind'], rounds: number, tier?: number): CarriedGun
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'string',
  (kind: CarriedGun['kind'], rounds: number, tier: number = 0): CarriedGun => ({
    kind,
    rounds,
    loaded: Math.min(rounds, magazineOf(kind, tier)),
    tier,
  }),
)

// NOTE: data first when the rounds lead: rounds are a number, a kind is not.
export const holdingSpare: {
  (kind?: CarriedGun['kind']): (rounds: number) => Arsenal
  (rounds: number, kind?: CarriedGun['kind']): Arsenal
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'number',
  (rounds: number, kind: CarriedGun['kind'] = 'Shotgun'): Arsenal =>
    holdingSecond(gun(kind, rounds)),
)

// NOTE: a few steps west of the stall and just below its foot, clear of the
// candelabra by its north-west corner.
const BESIDE_STALL = { x: STALL_BOX.left - 19, y: STALL_BOX.bottom + 8 }
