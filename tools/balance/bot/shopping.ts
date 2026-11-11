// What the balance bot does in a break: spending the crew's keys on the
// rooms and the fridge, taking planks and gnomes from the trap crates,
// placing and mending them, and the plan that picks between them.

import { Array, Function, Option, Schema } from 'effect'

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
import { freshGun, isCarrying } from '../../../src/world/gear/weapons'
import { maxHpOf } from '../../../src/world/heroes/calling'
import { heldKeys } from '../../../src/world/keys/keys'
import { distanceToBox, levelOf } from '../../../src/world/level/arena'
import { KITCHEN_EXIT, exitOffers } from '../../../src/world/level/exits'
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
import { type Gun, gunValue, weakerGun } from './guns'
import { isKnobSet, knobNumber, knobText } from './knobs'
import { type BotState } from './state'

// KEYS

// The bot has no shop to visit (docs/ESCAPE_PLAN.md, layer 7): zombies drop
// skeleton keys onto the crew's ring (src/world/keys/keys.ts), and the bot
// spends them as a stub until the real bot (layer 17): it opens the kitchen
// once it holds the keys, then each room on sale it can pay for, and pulls
// the fridge with what it has left. Guns
// sit in display cases (src/world/feats/cases.ts), which the bot leaves
// alone, and traps come from the trap crates (THE CRATES below).
// NO_GNOME=1 is the bot that never takes a gnome, and NO_PLANKS=1 one that
// never takes a Plank Pile, to check planks help without carrying.
const NO_GNOME = isKnobSet('NO_GNOME')
const NO_PLANKS = isKnobSet('NO_PLANKS')
// NOTE: keys the bot keeps back from the fridge, 0 by default.
const RESERVE = knobNumber('RESERVE', 0)

// THE ROOMS

// The bot opens the kitchen once the ring holds its padlock's keys, from
// the break its boards go on sale, and once the kitchen is open, each other
// room on sale (the parlour, the library, then the cellar beyond it) as soon
// as the ring holds its padlock's keys. It walks to the boards and holds the
// interact key. KITCHEN=0 is the bot that never opens the kitchen, to see
// what the kitchen does to a run, and ROOMS=0 the bot that opens no room
// past it.
const NO_KITCHEN = knobText('KITCHEN') === '0'
const NO_ROOMS = knobText('ROOMS') === '0'

export const isKitchenOpen = (model: Model) =>
  levelOf(model).openExits.includes(KITCHEN_EXIT)

const isKitchenOffer = ({ target }: Offer): boolean =>
  target._tag === 'Exit' && target.exit === KITCHEN_EXIT

// NOTE: the boards the bot wants open next: a room's with a thing on the
// dare's list behind them first (wantedBoards in ./escape.ts), then the
// kitchen's, then the rest in the house's order, the first the ring can
// pay for.
const maybeWantedRoom = (model: Model): Option.Option<Offer> =>
  Option.orElse(Option.fromUndefinedOr(wantedBoards(model)), () =>
    Array.findFirst(
      exitOffers(model),
      offer =>
        (isKitchenOffer(offer)
          ? !NO_KITCHEN
          : !NO_ROOMS && (NO_KITCHEN || isKitchenOpen(model))) &&
        heldKeys(model) >= offer.price,
    ),
  )

const wantsRoom = (model: Model): boolean =>
  Option.isSome(maybeWantedRoom(model))

// NOTE: where the bot walks to buy the room: just inside the middle of the
// boards' face on its side, which it pushes against.
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

// The bot buys the room as a player does: it holds the interact key at the
// boards until the hold fills (src/world/shop/purchase.ts), mid-wave too when it
// happens to stand there while it wants the room.
export const holdingAtBoards: {
  (keys: Set<string>): (model: Model) => Set<string>
  (model: Model, keys: Set<string>): Set<string>
} = Function.dual(2, (model: Model, keys: Set<string>): Set<string> =>
  wantsRoom(model) &&
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

// NOTE: two hearts down, the bot pulls for the Sandwich too, as a player
// with keys to spare would, and leaves a weapon it would not carry.
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

// At the fridge it holds the interact key while the door is shut, lets go
// once a pull is done so the next hold starts fresh, and waits while the
// door stands open.
export const fridgeKeys = (model: Model): Set<string> =>
  (model.fridge.door._tag === 'Shut' ||
    (isOfferedToBot(model) && wouldTake(model))) &&
  focusOf(model).purchase._tag !== 'Done'
    ? new Set([KEYS.interact])
    : new Set()

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
  | 'Room'
  | 'Case'
  | 'Crate'
  | 'Barricade'
  | 'Gnome'
  | 'Mend'
  | 'Fridge'
  | 'Return'
  | 'Go'

// Gnomes go a little off the middle of the room, where the bot fights.
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

// NOTE: the open break before wave 2 waits for READY, and the bot steers
// straight at what it wants, so cover in the way (the trunk, the couch, a
// tea table) could hold it there for good. After a minute it walks back to
// where it holds, and after a minute and a half it goes wherever it stands,
// by READY's button where the key is taken (at a purchasable), as a player
// would. Every later break's clock (20 to 30 s) ends it sooner.
const BREAK_FRAMES = 90_000 / FRAME_MS
const LATE_FRAMES = 60_000 / FRAME_MS

// NOTE: how near the dining room's aisle the bot starts a wave, so a case
// or a thing in a far room never leaves it starting the wave there.
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
  if (isAwayFromHold(model) && escapeTarget(model) === undefined) {
    return 'Return'
  }
  return 'Go'
})
