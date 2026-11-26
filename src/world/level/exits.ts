import { Array, Function, Option, Order, Record, Result, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { KITCHEN_FIRST_WAVE } from '../../shared/constants'
import { countWork } from '../../shared/workCount'
import { heldKeys, spendKeys } from '../keys/keys'
import { markedPadlockKeys } from '../run/dareLadder'
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

export const KITCHEN_EXIT: ExitId = 'Kitchen'

type ExitRules = Readonly<{
  kitchenKeys: number
  roomKeys: Array.NonEmptyReadonlyArray<number>
  farKeys: number
  firstWave: number
  reachPx: number
  tagDropPx: number
}>

export const EXIT_RULES: ExitRules = {
  kitchenKeys: 8,
  roomKeys: [40, 75],
  farKeys: 90,
  firstWave: KITCHEN_FIRST_WAVE,
  reachPx: 14,
  tagDropPx: 7,
}

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

const closedExitsKept = new WeakMap<
  Level,
  ReadonlyArray<Readonly<{ exit: ExitId; box: Box }>>
>()

const closedExitBoxes = (
  level: Level,
): ReadonlyArray<Readonly<{ exit: ExitId; box: Box }>> => {
  const kept = closedExitsKept.get(level)
  if (kept !== undefined) {
    return kept
  }
  countWork('LevelTable')
  const closed = closedExitBoxesOn(level)
  closedExitsKept.set(level, closed)
  return closed
}

const closedExitBoxesOn = (
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

export const isExitOfferOpenFor = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(phase) &&
  phase.wave >= EXIT_RULES.firstWave

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

export const exitPriceFor: {
  (exit: ExitId): (model: World) => number
  (model: World, exit: ExitId): number
} = Function.dual(2, (model: World, exit: ExitId): number =>
  exit === KITCHEN_EXIT && isKitchenTourOn(model)
    ? 0
    : markedPadlockKeys(model.dareMark, exitKeysOf(levelOf(model), exit)),
)

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

export type Padlock = Readonly<{
  exit: ExitId
  price: number
  box: Box
}>

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

export const hasOpenedBoards = (model: World): boolean =>
  Array.some(
    levelOf(model).exits,
    ({ isOpen, opener }) => isOpen && opener === 'Boards',
  )

export const padlockMarkOf = ({ box }: Padlock): Vector => ({
  x: Math.round((box.left + box.right) / 2),
  y: box.top,
})

export const maybePadlockedExit = (model: World): Option.Option<Box> =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  !isExitOfferOpenFor(model.phase)
    ? Option.map(Array.head(closedExitBoxes(levelOf(model))), ({ box }) => box)
    : Option.none()

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
    const opened = UiStruct.evolve(spendKeys(model, price), {
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
