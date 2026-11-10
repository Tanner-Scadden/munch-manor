// What the balance bot does in a break: shopping at Rattles' stall,
// buying the kitchen, the fridge, planks and
// gnomes, and the plan that picks between them.

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
import { freshGun, isCarrying } from '../../../src/world/gear/weapons'
import { maxHpOf } from '../../../src/world/heroes/calling'
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
import { maybeOfferInReach } from '../../../src/world/shop/purchase'
import {
  STALL_BOX,
  isShopOpenFor,
  priceFor,
  repairItemId,
  verdictFor,
} from '../../../src/world/shop/shop'
import { doorCounts } from '../../../src/world/waves/endlessWaves'
import { KEYS, type Model, type Vector, send } from './basics'
import {
  type Gun,
  firearmOf,
  fridgeSpareOf,
  gunValue,
  gunsOfBot,
  pistolOf,
  spareOf,
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

// The bot shops the way a careful player would: a heart when low, the
// first gun it can afford (the cheap shotgun right after the tutorial, the
// SMG once it can), two Plank Piles, then Grumpy Gnomes while it keeps a
// small reserve for a heart. A gun's tiers are earned by its kills
// (src/world/gear/gunLevels.ts), so it buys none.
// NO_GNOME=1 keeps the old bot that never buys a gnome, and NO_PLANKS=1 a
// bot that never buys a Plank Pile, to check planks help without carrying.
const NO_GNOME = isKnobSet('NO_GNOME')
const NO_PLANKS = isKnobSet('NO_PLANKS')
// NOTE: GUN=shotgun plays a Barn Buster run: the bot buys the shotgun as its
// gun and never trades it for the Chatterbox.
const IS_SHOTGUN_RUN = knobText('GUN') === 'shotgun'
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
} = Function.dual(2, (state: BotState, model: Model): ItemId | undefined => {
  const firearm = firearmOf(model)
  const fridge = fridgeSpareOf(model)
  const spare = spareOf(model)
  const isAvailable = (item: ItemId) =>
    verdictFor(model, focusSlotOf(model), item)._tag === 'Available'
  const canSpare = (item: ItemId) =>
    isAvailable(item) &&
    focusOf(model).wallet.balance - priceFor(model, focusSlotOf(model), item) >=
      RESERVE
  if (focusOf(model).player.hp <= 3 && isAvailable('Heart')) {
    return 'Heart'
  }
  // NOTE: a Line Cook starts with the Cooker and no pistol, so its first
  // buy is a firearm, as a player would make it, with the pot kept as a spare.
  const isCook =
    state.options.calling === 'LineCook' && pistolOf(model) === undefined
  if (firearm === undefined && (fridge === undefined || isCook)) {
    if (!IS_SHOTGUN_RUN && isAvailable('Smg')) {
      return 'Smg'
    }
    if (isAvailable('Shotgun')) {
      return 'Shotgun'
    }
    return undefined
  }
  if (spare === undefined) {
    return undefined
  }
  if (
    !IS_SHOTGUN_RUN &&
    spare.kind === 'Shotgun' &&
    spare.tier === 0 &&
    isAvailable('Smg')
  ) {
    return 'Smg'
  }
  const barricades =
    focusOf(model).trapStock.Barricade +
    Array.filter(model.traps, trap => trap._tag === 'Barricade').length
  if (!NO_PLANKS && barricades < 2 && isAvailable('Barricade')) {
    return 'Barricade'
  }
  if (focusOf(model).player.hp <= 4 && isAvailable('Heart')) {
    return 'Heart'
  }
  const repairs = Array.filter(
    Array.map(model.traps, trap => repairItemId(trap.id)),
    item => isAvailable(item),
  )
  const repairTotal = Array.reduce(
    repairs,
    0,
    (total, item) => total + priceFor(model, focusSlotOf(model), item),
  )
  if (repairs.length > 0 && repairTotal <= 25) {
    return repairs[0]
  }
  // NOTE: NO_UPGRADES=1 once stopped the bot's upgrades. Tiers are earned
  // by kills now, so it stops the gnomes it would buy next.
  if (state.options.noUpgrades) {
    return undefined
  }
  const turrets =
    focusOf(model).trapStock.Turret +
    Array.filter(model.traps, trap => trap._tag === 'Turret').length
  if (!NO_GNOME && turrets < 1 && canSpare('Turret')) {
    return 'Turret'
  }
  if (wantsKitchen(model)) {
    return undefined
  }
  if (!NO_GNOME && turrets < 2 && spare.tier >= 2 && canSpare('Turret')) {
    return 'Turret'
  }
  return undefined
})

// THE KITCHEN

// The bot buys the kitchen open the way the analytical model does: once it
// holds the SMG at its second upgrade, both Plank Piles, and a Grumpy Gnome,
// while it keeps its reserve. It walks to the boarded door and holds the interact key. KITCHEN=0 is the bot
// that never opens it, to see what the kitchen does to a run.
const NO_KITCHEN = knobText('KITCHEN') === '0'
export const KITCHEN_DOOR_PUSH: Vector = { x: 70, y: 16 }

export const isKitchenOpen = (model: Model) =>
  levelOf(model).openExits.includes(KITCHEN_EXIT)

const turretCount = (model: Model) =>
  focusOf(model).trapStock.Turret +
  Array.filter(model.traps, trap => trap._tag === 'Turret').length

const plankCount = (model: Model) =>
  focusOf(model).trapStock.Barricade +
  Array.filter(model.traps, trap => trap._tag === 'Barricade').length

const wantsKitchen = (model: Model): boolean => {
  const spare = firearmOf(model)
  return (
    !NO_KITCHEN &&
    !isKitchenOpen(model) &&
    isExitOfferOpenFor(model.phase) &&
    spare?.kind === 'Smg' &&
    spare.tier >= 2 &&
    (NO_GNOME || turretCount(model) >= 1) &&
    (NO_PLANKS || plankCount(model) >= 2) &&
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
  const heart =
    focusOf(model).player.hp <= 4 &&
    focusOf(model).player.hp < maxHpOf(focusOf(model).player)
      ? priceFor(model, focusSlotOf(model), 'Heart')
      : 0
  const want = wantedPurchase(state, model)
  return (
    RESERVE +
    heart +
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

type PrepPlan =
  | 'Shop'
  | 'Kitchen'
  | 'Barricade'
  | 'Gnome'
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
    if (
      focusOf(model).trapStock.Barricade > 0 &&
      busiestDoor(model) !== undefined
    ) {
      return 'Barricade'
    }
    if (focusOf(model).trapStock.Turret > 0 && state.gnomeTries < 90) {
      return 'Gnome'
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
