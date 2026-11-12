import { Array, Function, Option, Order, Record, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { KITCHEN_FIRST_WAVE } from '../../shared/constants'
import { heldKeys, spendKeys } from '../keys/keys'
import { isKitchenTourOn } from '../run/tutorialRules'
import type { World } from '../schema/world'
import {
  type ExitId,
  GameEvent,
  Phase,
  Purchasable,
  type Vector,
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { distanceBetween } from '../step/geometry'
import { joinNewDoors } from '../waves/waves'
import { type Level, levelOf, maybeExit, openExitIn } from './arena'
import { EAST_EXIT, FAR_EXIT, WEST_EXIT } from './plan'
import { type Box, tileBox } from './tileGrid'
import { wakeRoom } from './wakeUp'

// THE EXIT

// NOTE: a boarded exit is padlocked, and opens for skeleton keys off the
// crew's ring (src/world/keys/keys.ts), by how deep its room is: the
// kitchen 8, the rooms off the dining room (the west and east slots) 40
// for the first one opened and 75 for the second, and the far slot, beyond
// the east room, 90 (docs/ESCAPE_PLAN.md, "Key costs and drops"). Each
// room holds one thing on the dare's list, so the prices pace the hunt.
// They were 8, 55, 55, 90 until the pacing report (docs/PACING_REPORT.md,
// owner's pick 5b, 2026-11-10) moved the rooms closer: on Double Dare
// about waves 3, 4, 6, and 8 instead of 3, 5, 7, and 9. The kitchen opens
// from the wave 3 break on.
export const KITCHEN_EXIT: ExitId = 'Kitchen'

type ExitRules = Readonly<{
  kitchenKeys: number
  roomKeys: Array.NonEmptyReadonlyArray<number>
  farKeys: number
  firstWave: number
  reachPx: number
  tagDropPx: number
}>

// NOTE: `tagDropPx` is how far below the top of the boards the price tag
// hangs: on the boards themselves, so a player standing at them is never
// hidden behind it.
export const EXIT_RULES: ExitRules = {
  kitchenKeys: 8,
  roomKeys: [40, 75],
  farKeys: 90,
  firstWave: KITCHEN_FIRST_WAVE,
  reachPx: 14,
  tagDropPx: 7,
}

// NOTE: the room behind a slot's boards rolls each run, so its boards keep
// it a secret until they come down and the cloche lifts.
const EXIT_NAMES: Readonly<Record<ExitId, string>> = {
  [KITCHEN_EXIT]: 'THE KITCHEN',
  [WEST_EXIT]: 'THE BOARDS',
  [EAST_EXIT]: 'THE BOARDS',
  [FAR_EXIT]: 'THE BOARDS',
}

export const exitName = (exit: ExitId): string =>
  Option.getOrElse(Record.get(EXIT_NAMES, exit), () => exit)

export const boxAround = (boxes: ReadonlyArray<Box>): Option.Option<Box> =>
  Array.match(boxes, {
    onEmpty: () => Option.none(),
    onNonEmpty: nonEmpty =>
      Option.some(
        Array.reduce(nonEmpty, Array.headNonEmpty(nonEmpty), (bounds, box) => ({
          left: Math.min(bounds.left, box.left),
          top: Math.min(bounds.top, box.top),
          right: Math.max(bounds.right, box.right),
          bottom: Math.max(bounds.bottom, box.bottom),
        })),
      ),
  })

export const exitBoxOf: {
  (exit: ExitId): (level: Level) => Option.Option<Box>
  (level: Level, exit: ExitId): Option.Option<Box>
} = Function.dual(2, (level: Level, exit: ExitId): Option.Option<Box> =>
  Option.flatMap(maybeExit(level, exit), ({ tiles }) =>
    boxAround(Array.map(tiles, tileBox)),
  ),
)

// NOTE: the boarded exits still shut, the ones a player can buy: a secret
// shelf is never for sale (src/world/library/secretShelf.ts), and boards
// behind a shut room, such as the far slot's in the east room, wait for it.
const closedExitBoxes = (
  level: Level,
): ReadonlyArray<Readonly<{ exit: ExitId; box: Box }>> =>
  Array.filterMap(level.exits, ({ id, isOpen, opener, requires }) =>
    Option.match(
      isOpen ||
        opener !== 'Boards' ||
        !Array.every(requires, required =>
          Array.contains(level.openExits, required),
        )
        ? Option.none()
        : exitBoxOf(level, id),
      {
        onNone: () => Result.failVoid,
        onSome: box => Result.succeed({ exit: id, box }),
      },
    ),
  )

// NOTE: from the kitchen's first break on, an exit is for sale any time the
// round runs, mid-wave too (owner, 2026-10-30).
export const isExitOfferOpenFor = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(phase) &&
  phase.wave >= EXIT_RULES.firstWave

// NOTE: the keys an exit's padlock asks, shown on the lock, by how deep
// its room is, and for a room off the dining room by how many of those
// are open already.
const ROOM_EXITS: ReadonlyArray<ExitId> = [WEST_EXIT, EAST_EXIT]

const roomKeysAfter = (opened: number): number =>
  Option.getOrElse(Array.get(EXIT_RULES.roomKeys, opened), () =>
    Array.lastNonEmpty(EXIT_RULES.roomKeys),
  )

export const exitKeysOf: {
  (exit: ExitId): (level: Level) => number
  (level: Level, exit: ExitId): number
} = Function.dual(2, (level: Level, exit: ExitId): number => {
  if (exit === KITCHEN_EXIT) {
    return EXIT_RULES.kitchenKeys
  }
  if (exit === FAR_EXIT) {
    return EXIT_RULES.farKeys
  }
  return roomKeysAfter(
    Array.filter(ROOM_EXITS, room => Array.contains(level.openExits, room))
      .length,
  )
})

// NOTE: the kitchen tour gives the kitchen away (src/world/run/tutorialRules.ts);
// every other room's boards keep their padlock.
export const exitPriceFor: {
  (exit: ExitId): (model: World) => number
  (model: World, exit: ExitId): number
} = Function.dual(2, (model: World, exit: ExitId): number =>
  exit === KITCHEN_EXIT && isKitchenTourOn(model)
    ? 0
    : exitKeysOf(levelOf(model), exit),
)

// NOTE: each boarded exit for sale, as a purchasable: walk up and hold the
// interact key beside its boards (src/world/shop/purchase.ts).
export const exitOffers = (model: World): ReadonlyArray<Offer> =>
  isExitOfferOpenFor(model.phase)
    ? Array.map(closedExitBoxes(levelOf(model)), ({ exit, box }) => ({
        target: Purchasable.Exit({ exit }),
        price: exitPriceFor(model, exit),
        box,
        reachPx: EXIT_RULES.reachPx,
        isFull: false,
        spot: {
          x: Math.round((box.left + box.right) / 2),
          y: box.top + EXIT_RULES.tagDropPx,
        },
      }))
    : []

// THE PADLOCKS THE TUTORIAL POINTS AT

export type Padlock = Readonly<{
  exit: ExitId
  price: number
  box: Box
}>

// NOTE: the boarded exits a player could open, sale or not, each with what
// its padlock asks now (exitPriceFor, so a retune of the prices flows
// through).
const padlocksOf = (model: World): ReadonlyArray<Padlock> =>
  Array.map(closedExitBoxes(levelOf(model)), ({ exit, box }) => ({
    exit,
    price: exitPriceFor(model, exit),
    box,
  }))

const boxCenterOf = (box: Box): Vector => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2,
})

// NOTE: the padlock asking the fewest keys, the nearest to `from` among
// those asking as few: the one the tutorial points a new player at.
export const maybeCheapestPadlock: {
  (from: Vector): (model: World) => Option.Option<Padlock>
  (model: World, from: Vector): Option.Option<Padlock>
} = Function.dual(2, (model: World, from: Vector): Option.Option<Padlock> =>
  pipe(
    padlocksOf(model),
    Array.sort(
      Order.combine(
        Order.mapInput(Order.Number, ({ price }: Padlock) => price),
        Order.mapInput(Order.Number, ({ box }: Padlock) =>
          distanceBetween(boxCenterOf(box), from),
        ),
      ),
    ),
    Array.head,
  ),
)

// NOTE: whether any boarded exit has been opened this run, by keys or by
// the kitchen tour's free boards. A secret shelf is not boards.
export const hasOpenedBoards = (model: World): boolean =>
  Array.some(
    levelOf(model).exits,
    ({ isOpen, opener }) => isOpen && opener === 'Boards',
  )

// NOTE: where the tutorial's arrow bobs for a padlock: over the middle of
// its boards' top.
export const padlockMarkOf = ({ box }: Padlock): Vector => ({
  x: Math.round((box.left + box.right) / 2),
  y: box.top,
})

// NOTE: in the breaks before the kitchen's first, a padlock hangs on the
// boards. From then on the price tag is the purchasable's (src/world/shop/purchase.ts),
// and mid-wave before then the boards are bare.
export const maybePadlockedExit = (model: World): Option.Option<Box> =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  !isExitOfferOpenFor(model.phase)
    ? Option.map(Array.head(closedExitBoxes(levelOf(model))), ({ box }) => box)
    : Option.none()

// NOTE: buying the exit opens it for the rest of the run, and its spawn
// doors join the wave shown or under way at once (joinNewDoors in
// src/world/waves/waves.ts), drawn from the run's generator, and the room
// wakes (src/world/level/wakeUp.ts). The boards smash where
// the doorway meets the parlour floor.
// The keys come off the crew's one ring, whoever holds at the boards.
export const buyExit: {
  (exit: ExitId, price: number): (model: World) => Option.Option<World>
  (model: World, exit: ExitId, price: number): Option.Option<World>
} = Function.dual(
  3,
  (model: World, exit: ExitId, price: number): Option.Option<World> => {
    const level = levelOf(model)
    const maybeBox = Option.map(
      Array.findFirst(closedExitBoxes(level), offer => offer.exit === exit),
      ({ box }) => box,
    )
    if (
      Option.isNone(maybeBox) ||
      !isExitOfferOpenFor(model.phase) ||
      heldKeys(model) < price
    ) {
      return Option.none()
    }
    const box = maybeBox.value
    const opened = modifyFields(spendKeys(model, price), {
      level: state => openExitIn(state, exit),
      frameEvents: frameEvents => [
        ...frameEvents,
        GameEvent.ExitOpened({ x: (box.left + box.right) / 2, y: box.bottom }),
      ],
    })
    const newDoors = Array.difference(levelOf(opened).doorIds, level.doorIds)
    return Option.some(wakeRoom(joinNewDoors(opened, newDoors), newDoors))
  },
)
