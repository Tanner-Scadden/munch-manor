// What the balance bot does in a break: shopping at Rattles' stall,
// buying the kitchen, the fridge, taking planks and gnomes from the trap
// crates, placing and mending them, and the plan that picks between them.

import { Array, Function, Option, Schema } from 'effect'

import { DialogBlock } from '@foldkit/ui'

import { ShopDialogBinding } from '../../../src/app/bindings'
import { Envelope } from '../../../src/app/pureApp'
import { DialogBinding } from '../../../src/features/shop/bindings'
import { Message as ShopMessage } from '../../../src/features/shop/message'
import {
  FRIDGE_RULES,
  fridgeBoxOf,
  fridgePriceFor,
} from '../../../src/world/fridge/leftovers'
import { crateSpotOf, maybeFindIn } from '../../../src/world/gear/crates'
import {
  MEND_RULES,
  isDamaged,
  ownedCount,
  trapBox,
  trapLimitOf,
} from '../../../src/world/gear/traps'
import { freshGun, isCarrying, maxTier } from '../../../src/world/gear/weapons'
import { distanceToBox, levelOf } from '../../../src/world/level/arena'
import {
  EXIT_RULES,
  KITCHEN_EXIT,
  isExitOfferOpenFor,
} from '../../../src/world/level/exits'
import {
  focusOf,
  focusSlotOf,
  leadSeatOf,
} from '../../../src/world/party/party'
import type { TrapKind } from '../../../src/world/schema/worldSchema'
import { maybeOfferInReach } from '../../../src/world/shop/purchase'
import {
  STALL_BOX,
  isShopOpenFor,
  priceFor,
} from '../../../src/world/shop/shop'
import { doorCounts } from '../../../src/world/waves/endlessWaves'
import { KEYS, type Model, type Vector, send } from './basics'
import {
  type Gun,
  firearmOf,
  gunValue,
  gunsOfBot,
  pistolOf,
  weakerGun,
} from './guns'
import { isKnobSet, knobNumber, knobText } from './knobs'
import { isInKitchen } from './route'
import { type BotState } from './state'

// SHOPPING

export const STALL_FRONT: Vector = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.top - 3,
}

// The bot shops the way a careful player would, and Rattles has nothing
// left it wants: guns sit in display cases (src/world/feats/cases.ts),
// which the bot leaves alone, a gun's tiers are earned by its kills
// (src/world/gear/gunLevels.ts), traps come from the trap crates (THE
// CRATES below), and hearts only drop. NO_GNOME=1 is the bot that never
// takes a gnome, and NO_PLANKS=1 one that never takes a Plank Pile, to
// check planks help without carrying.
const NO_GNOME = isKnobSet('NO_GNOME')
const NO_PLANKS = isKnobSet('NO_PLANKS')
const RESERVE = knobNumber('RESERVE', 30)

type ItemId = Parameters<typeof priceFor>[2]
// The gun a purchase would replace, if it is a gun.
export const replacedBy: {
  (item: ItemId): (model: Model) => Gun | undefined
  (model: Model, item: ItemId): Gun | undefined
} = Function.dual(2, (model: Model, item: ItemId): Gun | undefined => {
  if (item === 'Pistol') {
    return weakerGun(model)
  }
  if (item !== 'Smg' && item !== 'Shotgun') {
    return undefined
  }
  const guns = gunsOfBot(model)
  if (guns.length < 2) {
    return undefined
  }
  return (
    Option.getOrUndefined(
      Array.findFirst(guns, gun => gun.kind === 'Shotgun'),
    ) ?? weakerGun(model)
  )
})

export const wantedPurchase: {
  (model: Model): (state: BotState) => ItemId | undefined
  (state: BotState, model: Model): ItemId | undefined
} = Function.dual(
  2,
  (_state: BotState, _model: Model): ItemId | undefined => undefined,
)

// THE KITCHEN

// The bot buys the kitchen open the way the analytical model does: once it
// holds a gun at its second tier (earned by kills),
// while it keeps its reserve. It walks to the boarded door and holds the interact key. KITCHEN=0 is the bot
// that never opens it, to see what the kitchen does to a run.
const NO_KITCHEN = knobText('KITCHEN') === '0'
export const KITCHEN_DOOR_PUSH: Vector = { x: 70, y: 16 }

export const isKitchenOpen = (model: Model) =>
  levelOf(model).openExits.includes(KITCHEN_EXIT)

const wantsKitchen = (model: Model): boolean => {
  const spare = firearmOf(model) ?? pistolOf(model)
  return (
    !NO_KITCHEN &&
    !isKitchenOpen(model) &&
    isExitOfferOpenFor(model.phase) &&
    spare !== undefined &&
    spare.tier >= Math.min(2, maxTier(spare.kind)) &&
    focusOf(model).wallet.balance - EXIT_RULES.price >= RESERVE
  )
}

// The bot buys the room as a player does: it holds the interact key at the
// boards until the hold fills (src/world/shop/purchase.ts), mid-wave too when it
// happens to stand there while it wants the room.
export const holdingAtKitchen: {
  (keys: Set<string>): (model: Model) => Set<string>
  (model: Model, keys: Set<string>): Set<string>
} = Function.dual(2, (model: Model, keys: Set<string>): Set<string> =>
  wantsKitchen(model) &&
  Option.isSome(maybeOfferInReach(model, focusSlotOf(model)))
    ? new Set([...keys, KEYS.interact])
    : keys,
)

// THE FRIDGE

// The bot pulls from Mystery Leftovers in a break once the kitchen is open,
// after it has shopped, placed its traps, and kept its reserve: the balance
// after the pull must still cover RESERVE, a heart while it is down to 4
// hearts or fewer, and whatever its shopping list still wants. It never
// pulls while the door is open or slammed. A weapon is offered, not given:
// see wouldTake.
// FRIDGE=0 is the bot that never pulls.
const NO_FRIDGE = knobText('FRIDGE') === '0'
const FRIDGE_STAND_PX = 6

export const fridgeStand = (model: Model): Vector | undefined =>
  Option.getOrUndefined(
    Option.map(fridgeBoxOf(levelOf(model)), box => ({
      x: (box.left + box.right) / 2,
      y: box.bottom + FRIDGE_STAND_PX,
    })),
  )

export const isFridgeInReach = (model: Model): boolean =>
  Option.exists(
    fridgeBoxOf(levelOf(model)),
    box =>
      distanceToBox(focusOf(model).player, box) <= FRIDGE_RULES.reachPx - 2,
  )

// NOTE: take it or leave it: the bot takes a weapon on offer when it beats
// the weaker of its two guns (or a slot is free), and gives that gun up for
// it. With an upgraded Chatterbox and a plain pistol, the pistol goes.
const FRIDGE_PRIZES = ['Cooker', 'Pan', 'Freeze'] as const

// The Pan takes the knife's place, not a gun's, so it always beats what
// it replaces.
const beatsWeaker = (model: Model, kind: Gun['kind']): boolean => {
  const weaker = weakerGun(model)
  return (
    kind === 'Pan' ||
    weaker === undefined ||
    gunValue(freshGun(kind)) > gunValue(weaker)
  )
}

export const offeredWeapon = (model: Model): Gun['kind'] | undefined => {
  const { door } = model.fridge
  return door._tag === 'Offering' &&
    (door.prize === 'Cooker' || door.prize === 'Pan' || door.prize === 'Freeze')
    ? door.prize
    : undefined
}

export const wouldTake = (model: Model): boolean => {
  const prize = offeredWeapon(model)
  return prize !== undefined && beatsWeaker(model, prize)
}

// It pulls only when it would take whatever weapon came out: the worst of
// the weapons the fridge can still give it (never the one it carries) must
// beat its weaker gun. Otherwise the pull buys a prize it walks away from.
const wouldTakeAnyPrize = (model: Model): boolean =>
  Array.every(
    Array.filter(
      FRIDGE_PRIZES,
      kind => !isCarrying(focusOf(model).player, kind),
    ),
    kind => beatsWeaker(model, kind),
  )

export const isOfferedToBot = (model: Model): boolean =>
  model.fridge.door._tag === 'Offering' &&
  model.fridge.door.slot === leadSeatOf(model).slot

const fridgeReserve = (state: BotState, model: Model): number => {
  const want = wantedPurchase(state, model)
  return (
    RESERVE +
    (want === undefined ? 0 : priceFor(model, focusSlotOf(model), want))
  )
}

const wantsFridge = (state: BotState, model: Model): boolean =>
  !NO_FRIDGE &&
  model.phase._tag === 'Preparation' &&
  isKitchenOpen(model) &&
  fridgeStand(model) !== undefined &&
  (model.fridge.door._tag === 'Open' ||
    (isOfferedToBot(model) && wouldTake(model)) ||
    (model.fridge.door._tag === 'Shut' &&
      wouldTakeAnyPrize(model) &&
      focusOf(model).wallet.balance -
        fridgePriceFor(model, focusSlotOf(model)) >=
        fridgeReserve(state, model)))

// At the fridge it holds the interact key while the door is shut, lets go
// once a pull is done so the next hold starts fresh, and waits while the
// door stands open.
export const fridgeKeys = (model: Model): Set<string> =>
  (model.fridge.door._tag === 'Shut' ||
    (isOfferedToBot(model) && wouldTake(model))) &&
  focusOf(model).purchase._tag !== 'Done'
    ? new Set([KEYS.interact])
    : new Set()

// NOTE: what the shop dialog's close button sends: a Dialog Message inside
// the shop's, in the root's envelope (src/app/pureApp.ts, Envelope).
const closeShopDialog = () =>
  Envelope.inRoot(
    ShopDialogBinding,
    Envelope.inShop(DialogBinding, DialogBlock.Message.ClickedCloseButton()),
  )

const buyAtCounter = (item: ItemId) =>
  Envelope.inRoot(ShopDialogBinding, ShopMessage.ClickedBuyButton({ item }))

export const shop: {
  (model: Model): (state: BotState) => Model
  (state: BotState, model: Model): Model
} = Function.dual(2, (state: BotState, model: Model): Model => {
  const item = wantedPurchase(state, model)
  if (item === undefined) {
    return send(model, closeShopDialog())
  }
  const bought = send(model, buyAtCounter(item))
  const { phase } = model
  if (
    focusOf(bought).wallet.balance !== focusOf(model).wallet.balance &&
    phase._tag === 'Preparation'
  ) {
    const maybeVisit = Array.findFirst(
      state.shopVisits,
      visit => visit.wave === phase.wave,
    )
    if (Option.isSome(maybeVisit)) {
      maybeVisit.value.bought.push(item)
    }
  }
  return focusOf(bought).wallet.balance === focusOf(model).wallet.balance
    ? send(bought, closeShopDialog())
    : bought
})

// The bot holds the parlour, so its planks go in the parlour's doorways.
const isParlourDoor = Schema.is(
  Schema.Literals(['North', 'West', 'East', 'South']),
)

export const busiestDoor = (model: Model) => {
  if (model.phase._tag !== 'Preparation') {
    return undefined
  }
  // Counts follow the planks already up: a boarded door's packs come through
  // the next open door, so the second pile goes where they pile up.
  const counts = new Map<string, number>()
  Array.forEach(
    doorCounts(model.phase.spawns, model.traps, levelOf(model).doorIds),
    ({ door, count }) => {
      counts.set(door, count)
    },
  )
  const boarded = new Set<string>(
    Array.flatMap(model.traps, trap =>
      trap._tag === 'Barricade' ? [trap.door] : [],
    ),
  )
  return Array.flatMap([...counts.entries()], ([door, count]) =>
    !boarded.has(door) && isParlourDoor(door) ? [{ door, count }] : [],
  ).sort((a, b) => b.count - a.count)[0]?.door
}

// THE CRATES

// A crate's find is taken by walking onto it, so the bot walks to the
// first crate whose trap it wants and may carry. A damaged trap mends while
// the bot stands still beside it, so it walks up to the most worn one and
// waits there with no keys down.
const wantsFind = (trap: TrapKind): boolean =>
  trap === 'Barricade' ? !NO_PLANKS : !NO_GNOME

export const crateTarget = (model: Model): Vector | undefined =>
  Option.getOrUndefined(
    Array.findFirst(model.crates.crates, crate =>
      Option.exists(
        maybeFindIn(model, crate),
        trap =>
          wantsFind(trap) &&
          ownedCount(model, focusSlotOf(model), trap) <
            trapLimitOf(model, trap),
      ),
    ).pipe(Option.map(crate => crateSpotOf(crate.room))),
  )

const MEND_BELOW = 0.75

const wornTrap = (model: Model) =>
  Option.getOrUndefined(
    Array.findFirst(
      Array.filter(model.traps, isDamaged),
      trap => trap.hp / trap.maxHp < MEND_BELOW,
    ),
  )

export const mendTarget = (model: Model): Vector | undefined => {
  const trap = wornTrap(model)
  if (trap === undefined) {
    return undefined
  }
  const box = trapBox(levelOf(model), trap)
  return {
    x: Math.min(Math.max(focusOf(model).player.x, box.left), box.right),
    y: Math.min(Math.max(focusOf(model).player.y, box.top), box.bottom),
  }
}

// NOTE: close enough to mend: within reach of the trap's box, with a pixel
// to spare, so the bot stops walking (standing still is what mends).
export const isAtMend = (model: Model): boolean => {
  const trap = wornTrap(model)
  return (
    trap !== undefined &&
    distanceToBox(focusOf(model).player, trapBox(levelOf(model), trap)) <=
      MEND_RULES.reachPx - 1
  )
}

type PrepPlan =
  | 'Shop'
  | 'Kitchen'
  | 'Crate'
  | 'Barricade'
  | 'Gnome'
  | 'Mend'
  | 'Fridge'
  | 'Return'
  | 'Go'

// Gnomes go a little off the middle of the room, where the bot fights.
const GNOME_SPOTS: Array<Vector> = [
  { x: 146, y: 88 },
  { x: 176, y: 104 },
]

export const gnomeSpot = (model: Model): Vector =>
  GNOME_SPOTS[
    Math.min(
      GNOME_SPOTS.length - 1,
      Array.filter(model.traps, trap => trap._tag === 'Turret').length,
    )
  ] ?? focusOf(model).player

export const prepPlan: {
  (model: Model, shopped: boolean): (state: BotState) => PrepPlan
  (state: BotState, model: Model, shopped: boolean): PrepPlan
} = Function.dual(
  3,
  (state: BotState, model: Model, shopped: boolean): PrepPlan => {
    if (
      isShopOpenFor(model.phase) &&
      !shopped &&
      wantedPurchase(state, model) !== undefined
    ) {
      return 'Shop'
    }
    if (wantsKitchen(model)) {
      return 'Kitchen'
    }
    if (crateTarget(model) !== undefined) {
      return 'Crate'
    }
    if (
      focusOf(model).trapStock.Barricade > 0 &&
      busiestDoor(model) !== undefined
    ) {
      return 'Barricade'
    }
    if (focusOf(model).trapStock.Turret > 0 && state.gnomeTries < 90) {
      return 'Gnome'
    }
    if (mendTarget(model) !== undefined) {
      return 'Mend'
    }
    if (wantsFridge(state, model)) {
      return 'Fridge'
    }
    if (isInKitchen(focusOf(model).player)) {
      return 'Return'
    }
    return 'Go'
  },
)
