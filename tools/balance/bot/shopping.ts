// What the balance bot does in a break: shopping at Rattles' stall,
// buying the kitchen, the ammo window mid-wave, the fridge, planks and
// gnomes, and the plan that picks between them.

import { Option, Schema } from 'effect'
import { toParentMessage } from 'foldkit/test'

import { DialogBlock } from '@foldkit/ui'

import { isCounterOpen, maybeAmmoItemOf } from '../../../src/ammoCounter'
import { ammoLevelOf } from '../../../src/ammoWarning'
import { distanceToBox, levelOf } from '../../../src/arena'
import { ShopDialogBinding } from '../../../src/bindings'
import { PLAYER_MAX_HP } from '../../../src/constants'
import { doorCounts } from '../../../src/endlessWaves'
import {
  EXIT_RULES,
  KITCHEN_EXIT,
  isExitOfferOpenFor,
} from '../../../src/exits'
import { isFridgeWeapon } from '../../../src/fridgeWeapons'
import { FRIDGE_RULES, fridgeBoxOf } from '../../../src/leftovers'
import { Message } from '../../../src/message'
import { leadSeatOf } from '../../../src/party'
import { maybeOfferInReach } from '../../../src/purchase'
import {
  STALL_BOX,
  isShopOpenFor,
  priceFor,
  repairItemId,
  verdictFor,
} from '../../../src/shop'
import {
  freshGun,
  heldGun,
  isCarrying,
  maxRounds,
  maxTier,
} from '../../../src/weapons'
import {
  KEYS,
  type Model,
  type Vector,
  distance,
  send,
  steerToward,
} from './basics'
import {
  type FridgeSpare,
  type Gun,
  firearmOf,
  fridgeSpareOf,
  gunValue,
  gunsOfBot,
  isSpent,
  panOf,
  pistolOf,
  spareOf,
  weakerGun,
} from './guns'
import { isInKitchen } from './route'
import { type BotState } from './state'

// SHOPPING

export const STALL_FRONT: Vector = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.top - 3,
}

// NOTE: where the bot stands at the ammo window, just below the counter.
export const STALL_BELOW: Vector = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.bottom + 6,
}

// The bot shops the way a careful player would: a heart when low, the
// first gun it can afford (the cheap shotgun right after the tutorial, the
// SMG once it can), ammo below half, two Plank Piles, then upgrades and a
// Grumpy Gnome while it keeps a small reserve for a refill and a heart. It
// takes the spare to its top tier before it upgrades the pistol.
// NO_GNOME=1 keeps the old bot that never buys a gnome, and NO_PLANKS=1 a
// bot that never buys a Plank Pile, to check planks help without carrying.
const NO_GNOME = process.env['NO_GNOME'] !== undefined
const NO_PLANKS = process.env['NO_PLANKS'] !== undefined
// NOTE: GUN=shotgun plays a Barn Buster run: the bot buys the shotgun as its
// gun, never trades it for the Chatterbox, and upgrades it as it would any gun.
const IS_SHOTGUN_RUN = process.env['GUN'] === 'shotgun'
const RESERVE = Number(process.env['RESERVE'] ?? 30)

type ItemId = Parameters<typeof priceFor>[1]
type SpareKind = FridgeSpare['kind']

// Each spare's ammo and upgrade on Rattles' shelves. The Cooker's ammo is a
// Lid Stack; the Pan never needs any and Brain Freeze is never refilled.
const REFILLS: Partial<Record<SpareKind, ItemId>> = {
  Smg: 'SmgRounds',
  Shotgun: 'ShotgunShells',
  Cooker: 'LidStack',
}

const UPGRADES: Partial<Record<SpareKind, ItemId>> = {
  Smg: 'SmgUpgrade',
  Shotgun: 'ShotgunUpgrade',
  Cooker: 'CookerUpgrade',
  Pan: 'PanUpgrade',
}

// The gun a purchase would replace, if it is a gun.
export const replacedBy = (model: Model, item: ItemId): Gun | undefined => {
  if (item === 'Pistol') {
    return gunsOfBot(model).find(isSpent) ?? weakerGun(model)
  }
  if (item !== 'Smg' && item !== 'Shotgun') {
    return undefined
  }
  const guns = gunsOfBot(model)
  if (guns.length < 2) {
    return undefined
  }
  return (
    guns.find(gun => gun.kind === 'Shotgun') ??
    guns.find(isSpent) ??
    weakerGun(model)
  )
}

export const wantedPurchase = (
  state: BotState,
  model: Model,
): ItemId | undefined => {
  const firearm = firearmOf(model)
  const fridge = fridgeSpareOf(model)
  const spare = spareOf(model)
  const isAvailable = (item: ItemId) =>
    verdictFor(model, item)._tag === 'Available'
  const canSpare = (item: ItemId) =>
    isAvailable(item) && model.wallet.balance - priceFor(model, item) >= RESERVE
  if (model.player.hp <= 3 && isAvailable('Heart')) {
    return 'Heart'
  }
  // Traded the pistol for a fridge weapon that is now spent: Rattles gives
  // the pistol back for nothing, in place of the spent one.
  if (
    pistolOf(model) === undefined &&
    fridge !== undefined &&
    isSpent(fridge) &&
    isAvailable('Pistol')
  ) {
    return 'Pistol'
  }
  // A spent fridge weapon is as good as no spare at all.
  if (
    firearm === undefined &&
    (fridge === undefined || (isSpent(fridge) && isAvailable('Smg')))
  ) {
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
  const refills = [firearm, fridge].flatMap(gun => {
    if (gun === undefined) {
      return []
    }
    const refill = REFILLS[gun.kind]
    const cap = maxRounds(gun.kind, gun.tier)
    return refill !== undefined && gun.rounds < cap / 2 && isAvailable(refill)
      ? [refill]
      : []
  })
  if (refills[0] !== undefined) {
    return refills[0]
  }
  const barricades =
    model.trapStock.Barricade +
    model.traps.filter(trap => trap._tag === 'Barricade').length
  if (!NO_PLANKS && barricades < 2 && isAvailable('Barricade')) {
    return 'Barricade'
  }
  if (model.player.hp <= 4 && isAvailable('Heart')) {
    return 'Heart'
  }
  const repairs = model.traps
    .map(trap => repairItemId(trap.id))
    .filter(item => isAvailable(item))
  const repairTotal = repairs.reduce(
    (total, item) => total + priceFor(model, item),
    0,
  )
  if (repairs.length > 0 && repairTotal <= 25) {
    return repairs[0]
  }
  if (state.options.noUpgrades) {
    return undefined
  }
  const turrets =
    model.trapStock.Turret +
    model.traps.filter(trap => trap._tag === 'Turret').length
  // A fridge weapon's upgrades (Rattles' line for a carried Cooker or Pan)
  // come after the hearts, planks, repairs, and the first gnome.
  const spareUpgrade = UPGRADES[spare.kind]
  const isFridgeSpare = isFridgeWeapon(spare.kind)
  if (
    !isFridgeSpare &&
    spareUpgrade !== undefined &&
    spare.tier < 1 &&
    canSpare(spareUpgrade)
  ) {
    return spareUpgrade
  }
  if (!NO_GNOME && turrets < 1 && canSpare('Turret')) {
    return 'Turret'
  }
  if (wantsKitchen(model)) {
    return undefined
  }
  if (
    spareUpgrade !== undefined &&
    spare.tier < maxTier(spare.kind) &&
    canSpare(spareUpgrade)
  ) {
    return spareUpgrade
  }
  // With a gun and a fridge weapon, the fridge weapon's tiers come next.
  const fridgeUpgrade =
    fridge !== undefined && fridge !== spare ? UPGRADES[fridge.kind] : undefined
  if (
    spare.tier >= maxTier(spare.kind) &&
    fridge !== undefined &&
    fridgeUpgrade !== undefined &&
    fridge.tier < maxTier(fridge.kind) &&
    canSpare(fridgeUpgrade)
  ) {
    return fridgeUpgrade
  }
  // The Pan in the melee slot gets its tiers in the same place.
  const pan = panOf(model)
  if (
    spare.tier >= maxTier(spare.kind) &&
    pan !== undefined &&
    pan.tier < maxTier(pan.kind) &&
    canSpare('PanUpgrade')
  ) {
    return 'PanUpgrade'
  }
  if (spare.tier >= maxTier(spare.kind) && canSpare('PistolUpgrade')) {
    return 'PistolUpgrade'
  }
  if (!NO_GNOME && turrets < 2 && spare.tier >= 2 && canSpare('Turret')) {
    return 'Turret'
  }
  return undefined
}

// THE KITCHEN

// The bot buys the kitchen open the way the analytical model does: once it
// holds the SMG at its second upgrade, both Plank Piles, and a Grumpy Gnome,
// while it keeps its reserve. It walks to the boarded door and holds the interact key. KITCHEN=0 is the bot
// that never opens it, to see what the kitchen does to a run.
const NO_KITCHEN = process.env['KITCHEN'] === '0'
export const KITCHEN_DOOR_PUSH: Vector = { x: 70, y: 16 }

export const isKitchenOpen = (model: Model) =>
  levelOf(model).openExits.includes(KITCHEN_EXIT)

const turretCount = (model: Model) =>
  model.trapStock.Turret +
  model.traps.filter(trap => trap._tag === 'Turret').length

const plankCount = (model: Model) =>
  model.trapStock.Barricade +
  model.traps.filter(trap => trap._tag === 'Barricade').length

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
    model.wallet.balance - EXIT_RULES.price >= RESERVE
  )
}

// THE AMMO WINDOW

// Mid-wave, when the gun in its hands runs low and it stands near the
// stall with the price in hand, the bot walks up to the ammo window
// (src/ammoCounter.ts) and holds the interact key until it buys. It keeps
// shooting on the way, so standing alone never buys for it. AMMO=0 is the
// bot that never uses the window.
const NO_AMMO_WINDOW = process.env['AMMO'] === '0'
export const AMMO_WINDOW_NEAR_PX = 70

const wantsAmmoWindow = (model: Model): boolean => {
  const gun = heldGun(model.player.arsenal)
  return (
    !NO_AMMO_WINDOW &&
    isCounterOpen(model) &&
    ammoLevelOf(gun) !== 'Plenty' &&
    Option.exists(
      maybeAmmoItemOf(gun.kind),
      item => model.wallet.balance >= priceFor(model, item),
    ) &&
    distance(model.player, STALL_FRONT) < AMMO_WINDOW_NEAR_PX
  )
}

const isAtAmmoOffer = (model: Model): boolean =>
  Option.exists(maybeOfferInReach(model), offer => offer.target._tag === 'Ammo')

export const holdingAtWindow = (
  model: Model,
  keys: Set<string>,
): Set<string> =>
  wantsAmmoWindow(model) && isAtAmmoOffer(model)
    ? new Set([...keys, KEYS.interact])
    : keys

export const towardWindow = (model: Model, direction: Vector): Vector =>
  wantsAmmoWindow(model) && !isAtAmmoOffer(model)
    ? steerToward(model.player, STALL_BELOW)
    : direction

// The bot buys the room as a player does: it holds the interact key at the
// boards until the hold fills (src/purchase.ts), mid-wave too when it
// happens to stand there while it wants the room.
export const holdingAtKitchen = (
  model: Model,
  keys: Set<string>,
): Set<string> =>
  wantsKitchen(model) && Option.isSome(maybeOfferInReach(model))
    ? new Set([...keys, KEYS.interact])
    : keys

// THE FRIDGE

// The bot pulls from Mystery Leftovers in a break once the kitchen is open,
// after it has shopped, placed its traps, and kept its reserve: the balance
// after the pull must still cover RESERVE, a heart while it is down to 4
// hearts or fewer, and whatever its shopping list still wants. It never
// pulls while the door is open or slammed. A weapon is offered, not given:
// see wouldTake.
// FRIDGE=0 is the bot that never pulls.
const NO_FRIDGE = process.env['FRIDGE'] === '0'
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
    box => distanceToBox(model.player, box) <= FRIDGE_RULES.reachPx - 2,
  )

// NOTE: take it or leave it: the bot takes a weapon on offer when it beats
// the weaker of its two guns (or a slot is free), and gives that gun up for
// it. With an upgraded Chatterbox and a plain pistol, the pistol goes, and
// Rattles sells it back for $0 once the fridge weapon is spent.
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
// beat its weaker gun. Otherwise the $75 buys a prize it walks away from.
const wouldTakeAnyPrize = (model: Model): boolean =>
  FRIDGE_PRIZES.filter(kind => !isCarrying(model.player, kind)).every(kind =>
    beatsWeaker(model, kind),
  )

export const isOfferedToBot = (model: Model): boolean =>
  model.fridge.door._tag === 'Offering' &&
  model.fridge.door.slot === leadSeatOf(model).slot

const fridgeReserve = (state: BotState, model: Model): number => {
  const heart =
    model.player.hp <= 4 && model.player.hp < PLAYER_MAX_HP
      ? priceFor(model, 'Heart')
      : 0
  const want = wantedPurchase(state, model)
  return RESERVE + heart + (want === undefined ? 0 : priceFor(model, want))
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
      model.wallet.balance - FRIDGE_RULES.price >= fridgeReserve(state, model)))

// At the fridge it holds the interact key while the door is shut, lets go
// once a pull is done so the next hold starts fresh, and waits while the
// door stands open.
export const fridgeKeys = (model: Model): Set<string> =>
  (model.fridge.door._tag === 'Shut' ||
    (isOfferedToBot(model) && wouldTake(model))) &&
  model.purchase._tag !== 'Done'
    ? new Set([KEYS.interact])
    : new Set()

// NOTE: what the shop dialog's close button sends: a Dialog Message in its
// Binding's envelope (src/composition.ts).
const closeShopDialog = () =>
  toParentMessage(ShopDialogBinding, DialogBlock.Message.RequestedClose())

export const shop = (state: BotState, model: Model): Model => {
  const item = wantedPurchase(state, model)
  if (item === undefined) {
    return send(model, closeShopDialog())
  }
  const bought = send(model, Message.ClickedBuyButton({ item }))
  if (item.endsWith('Upgrade')) {
    state.spentOnUpgrades += model.wallet.balance - bought.wallet.balance
  }
  const { phase } = model
  if (
    bought.wallet.balance !== model.wallet.balance &&
    phase._tag === 'Preparation'
  ) {
    state.shopVisits.find(visit => visit.wave === phase.wave)?.bought.push(item)
  }
  return bought.wallet.balance === model.wallet.balance
    ? send(bought, closeShopDialog())
    : bought
}

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
  doorCounts(model.phase.spawns, model.traps, levelOf(model).doorIds).forEach(
    ({ door, count }) => {
      counts.set(door, count)
    },
  )
  const boarded = new Set<string>(
    model.traps.flatMap(trap => (trap._tag === 'Barricade' ? [trap.door] : [])),
  )
  return [...counts.entries()]
    .flatMap(([door, count]) =>
      !boarded.has(door) && isParlourDoor(door) ? [{ door, count }] : [],
    )
    .sort((a, b) => b.count - a.count)[0]?.door
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
      model.traps.filter(trap => trap._tag === 'Turret').length,
    )
  ] ?? model.player

export const prepPlan = (
  state: BotState,
  model: Model,
  shopped: boolean,
): PrepPlan => {
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
  if (model.trapStock.Barricade > 0 && busiestDoor(model) !== undefined) {
    return 'Barricade'
  }
  if (model.trapStock.Turret > 0 && state.gnomeTries < 90) {
    return 'Gnome'
  }
  if (wantsFridge(state, model)) {
    return 'Fridge'
  }
  if (isInKitchen(model.player)) {
    return 'Return'
  }
  return 'Go'
}
