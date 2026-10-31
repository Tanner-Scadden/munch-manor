// The shop tests' shared setup: a break beside the stall, the shop open on
// a row, money, hearts, and guns. src/shop.story.test.ts and
// src/shopDialog.story.test.ts start from it.

import { Option } from 'effect'
import { Command } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { PREPARATION_MS } from './constants'
import { Message } from './message'
import {
  type CarriedGun,
  type Model,
  Phase,
  type ShopItemId,
  ShopState,
  initialModel,
} from './model'
import { DISTANT_SPAWN, pastFirstBreak, withPlayerAt } from './model.fixture'
import { holdingSecond } from './testing'
import { FocusShopItem } from './update/shop'
import { asVeteran } from './veteran'
import { magazineOf } from './weapons'

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
export const resolveShowShop = Command.resolve(
  Dialog.test.ShowDialog,
  DialogBlock.Message.SucceededShowDialog(),
)

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

export const withMoney = (base: Model, balance: number): Model =>
  modifyFields(base, {
    wallet: () => ({ balance, earned: balance, shown: balance }),
  })

export const browsing = (base: Model): Model =>
  modifyFields(base, {
    phase: () => preparing(2),
    shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
  })

export const resolveFocusShopItem = Command.resolve(
  FocusShopItem,
  Message.CompletedFocusShopItem(),
)

export const focusedOn = (base: Model, item: ShopItemId): Model =>
  modifyFields(base, { shop: () => ShopState.Browsing({ focusedItem: item }) })

export const withHp = (base: Model, hp: number): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { hp: () => hp }),
  })

export const gun = (
  kind: CarriedGun['kind'],
  rounds: number,
  tier = 0,
): CarriedGun => ({
  kind,
  rounds,
  loaded: Math.min(rounds, magazineOf(kind, tier)),
  tier,
})

export const holdingSpare = (
  rounds: number,
  kind: CarriedGun['kind'] = 'Shotgun',
) => holdingSecond(gun(kind, rounds))

const BESIDE_STALL = { x: 241, y: 142 }
