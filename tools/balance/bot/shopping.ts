import { Array, Function, Option, Schema } from 'effect'

import { besideBox, pantryErrand } from '../../../src/features/bots/dareSearch'
import {
  FRIDGE_RULES,
  fridgeBoxOf,
  fridgePriceFor,
} from '../../../src/world/fridge/leftovers'
import {
  type CrateFind,
  canTakeFind,
  crateSpotOf,
  maybeFindIn,
} from '../../../src/world/gear/crates'
import { MEND_RULES, isDamaged, trapBox } from '../../../src/world/gear/traps'
import {
  freshGun,
  isCarrying,
  isCookable,
} from '../../../src/world/gear/weapons'
import { maxHpOf } from '../../../src/world/heroes/calling'
import { heldKeys } from '../../../src/world/keys/keys'
import { STOVE_RULES, stoveOffers } from '../../../src/world/kitchen/stove'
import { levelOf } from '../../../src/world/level/arena'
import { KITCHEN_EXIT, exitOffers } from '../../../src/world/level/exits'
import { distanceToBox } from '../../../src/world/level/tileGrid'
import {
  focusOf,
  focusSlotOf,
  leadSeatOf,
} from '../../../src/world/party/party'
import { type Offer, maybeOfferInReach } from '../../../src/world/shop/purchase'
import { doorCounts } from '../../../src/world/waves/endlessWaves'
import {
  FRAME_MS,
  KEYS,
  type Model,
  ROOM_CENTER,
  type Vector,
  distance,
} from './basics'
import { caseTarget, escapeTarget, wantedBoards } from './escape'
import { type Gun, gunValue, gunsOfBot, weakerGun } from './guns'
import { isKnobSet, knobNumber, knobText } from './knobs'
import { type BotState } from './state'

const NO_GNOME = isKnobSet('NO_GNOME')
const NO_PLANKS = isKnobSet('NO_PLANKS')
const RESERVE = knobNumber('RESERVE', 0)

const NO_KITCHEN = knobText('KITCHEN') === '0'
const NO_ROOMS = knobText('ROOMS') === '0'

export const isKitchenOpen = (model: Model) =>
  levelOf(model).openExits.includes(KITCHEN_EXIT)

const isKitchenOffer = ({ target }: Offer): boolean =>
  target._tag === 'Exit' && target.exit === KITCHEN_EXIT

const maybeWantedRoom = (model: Model): Option.Option<Offer> =>
  model.phase._tag !== 'Preparation'
    ? Option.none()
    : Option.orElse(
        NO_ROOMS ? Option.none() : Option.fromUndefinedOr(wantedBoards(model)),
        () =>
          Array.findFirst(
            exitOffers(model),
            offer =>
              isKitchenOffer(offer) &&
              !NO_KITCHEN &&
              heldKeys(model) >= offer.price,
          ),
      )

const wantsRoom = (model: Model): boolean =>
  Option.isSome(maybeWantedRoom(model))

const BOARDS_PUSH_PX = 4

export const roomTarget = (model: Model): Vector | undefined =>
  Option.getOrUndefined(
    Option.map(maybeWantedRoom(model), ({ box }) => {
      const { x, y } = focusOf(model).player
      const middle = {
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2,
      }
      if (y >= box.bottom) {
        return { x: middle.x, y: box.bottom - BOARDS_PUSH_PX }
      }
      if (y < box.top) {
        return { x: middle.x, y: box.top + BOARDS_PUSH_PX }
      }
      return x >= box.right
        ? { x: box.right - BOARDS_PUSH_PX, y: middle.y }
        : { x: box.left + BOARDS_PUSH_PX, y: middle.y }
    }),
  )

export const holdingAtBoards: {
  (keys: Set<string>): (model: Model) => Set<string>
  (model: Model, keys: Set<string>): Set<string>
} = Function.dual(2, (model: Model, keys: Set<string>): Set<string> =>
  wantsRoom(model) &&
  Option.isSome(maybeOfferInReach(model, focusSlotOf(model)))
    ? new Set([...keys, KEYS.interact])
    : keys,
)

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

const FRIDGE_PRIZES = ['Cooker', 'Pan', 'Freeze'] as const

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

const isHurtForSandwich = (model: Model): boolean => {
  const { player } = focusOf(model)
  return player.hp <= maxHpOf(player) - 2
}

const wantsFridge = (model: Model): boolean =>
  !NO_FRIDGE &&
  model.phase._tag === 'Preparation' &&
  isKitchenOpen(model) &&
  fridgeStand(model) !== undefined &&
  (model.fridge.door._tag === 'Open' ||
    (isOfferedToBot(model) && wouldTake(model)) ||
    (model.fridge.door._tag === 'Shut' &&
      (wouldTakeAnyPrize(model) || isHurtForSandwich(model)) &&
      heldKeys(model) - fridgePriceFor(model) >= RESERVE))

export const fridgeKeys = (model: Model): Set<string> =>
  (model.fridge.door._tag === 'Shut' ||
    (isOfferedToBot(model) && wouldTake(model))) &&
  focusOf(model).purchase._tag !== 'Done'
    ? new Set([KEYS.interact])
    : new Set()

const isParlourDoor = Schema.is(
  Schema.Literals(['North', 'West', 'East', 'South']),
)

export const busiestDoor = (model: Model) => {
  if (model.phase._tag !== 'Preparation') {
    return undefined
  }
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

const wantsFind = (find: CrateFind): boolean =>
  find === 'Heart' || (find === 'Barricade' ? !NO_PLANKS : !NO_GNOME)

export const crateTarget = (model: Model): Vector | undefined =>
  Option.getOrUndefined(
    Array.findFirst(model.crates.crates, crate =>
      Option.exists(
        maybeFindIn(model, crate),
        find => wantsFind(find) && canTakeFind(model, focusSlotOf(model), find),
      ),
    ).pipe(Option.map(crate => crateSpotOf(levelOf(model), crate.room))),
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

export const isAtMend = (model: Model): boolean => {
  const trap = wornTrap(model)
  return (
    trap !== undefined &&
    distanceToBox(focusOf(model).player, trapBox(levelOf(model), trap)) <=
      MEND_RULES.reachPx - 1
  )
}

export const pantryTarget = (model: Model): Vector | undefined =>
  pantryErrand(model)

const maybeStoveOffer = (model: Model): Option.Option<Offer> =>
  Array.head(stoveOffers(model, focusSlotOf(model)))

export const gunToCook = (model: Model): Gun | undefined =>
  Array.reduce(gunsOfBot(model), undefined, (best: Gun | undefined, gun) =>
    isCookable(gun.kind) &&
    (best === undefined || gunValue(gun) > gunValue(best))
      ? gun
      : best,
  )

export const stoveTarget = (model: Model): Vector | undefined =>
  gunToCook(model) === undefined
    ? undefined
    : Option.getOrUndefined(
        Option.map(maybeStoveOffer(model), ({ box }) =>
          besideBox(levelOf(model), box),
        ),
      )

export const isAtStove = (model: Model): boolean =>
  Option.exists(
    maybeStoveOffer(model),
    ({ box }) =>
      distanceToBox(focusOf(model).player, box) <= STOVE_RULES.reachPx - 2,
  )

export type PrepPlan =
  | 'Room'
  | 'Fetch'
  | 'Pantry'
  | 'Stove'
  | 'Case'
  | 'Crate'
  | 'Barricade'
  | 'Gnome'
  | 'Mend'
  | 'Fridge'
  | 'Return'
  | 'Go'

const GNOME_SPOTS: Array<Vector> = [
  { x: 156, y: 132 },
  { x: 206, y: 132 },
]

export const gnomeSpot = (model: Model): Vector =>
  GNOME_SPOTS[
    Math.min(
      GNOME_SPOTS.length - 1,
      Array.filter(model.traps, trap => trap._tag === 'Turret').length,
    )
  ] ?? focusOf(model).player

const BREAK_FRAMES = 90_000 / FRAME_MS
const LATE_FRAMES = 60_000 / FRAME_MS

const RETURN_PX = 60

export const isBreakOverdue = (state: BotState): boolean =>
  state.breakFrames > BREAK_FRAMES

const isAwayFromHold = (model: Model): boolean =>
  distance(focusOf(model).player, ROOM_CENTER) > RETURN_PX

export const prepPlan: {
  (model: Model): (state: BotState) => PrepPlan
  (state: BotState, model: Model): PrepPlan
} = Function.dual(2, (state: BotState, model: Model): PrepPlan => {
  if (isBreakOverdue(state)) {
    return 'Go'
  }
  if (state.breakFrames > LATE_FRAMES) {
    return isAwayFromHold(model) ? 'Return' : 'Go'
  }
  if (wantsRoom(model)) {
    return 'Room'
  }
  if (escapeTarget(model) !== undefined) {
    return 'Fetch'
  }
  if (stoveTarget(model) !== undefined) {
    return 'Stove'
  }
  if (caseTarget(model) !== undefined) {
    return 'Case'
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
  if (wantsFridge(model)) {
    return 'Fridge'
  }
  if (pantryTarget(model) !== undefined) {
    return 'Pantry'
  }
  if (isAwayFromHold(model)) {
    return 'Return'
  }
  return 'Go'
})
