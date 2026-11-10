import { Array, Function, Option, Result } from 'effect'
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
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { joinNewDoors } from '../waves/waves'
import {
  type Box,
  type Level,
  levelOf,
  maybeExit,
  openExitIn,
  tileBox,
} from './arena'

// THE EXIT

// NOTE: a boarded exit is padlocked, and opens for skeleton keys off the
// crew's ring (src/world/keys/keys.ts), 3 to 5 by how deep its room is: the
// kitchen 3, a room one further 4, and deeper ones 5 (docs/ESCAPE_PLAN.md,
// "Key costs and drops"; layer 8's house grid adds the deeper rooms). The
// kitchen opens from the wave 3 break on. Starting points, not yet tuned
// on the balance bot (layer 17).
export const KITCHEN_EXIT: ExitId = 'Kitchen'

type ExitRules = Readonly<{
  kitchenKeys: number
  firstWave: number
  reachPx: number
  tagDropPx: number
}>

// NOTE: `tagDropPx` is how far below the top of the boards the price tag
// hangs: on the boards themselves, so a player standing at them is never
// hidden behind it.
export const EXIT_RULES: ExitRules = {
  kitchenKeys: 3,
  firstWave: KITCHEN_FIRST_WAVE,
  reachPx: 14,
  tagDropPx: 7,
}

export const exitName = (exit: ExitId): string =>
  exit === KITCHEN_EXIT ? 'THE KITCHEN' : exit

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

const closedExitBoxes = (
  level: Level,
): ReadonlyArray<Readonly<{ exit: ExitId; box: Box }>> =>
  Array.filterMap(level.exits, ({ id, isOpen }) =>
    Option.match(isOpen ? Option.none() : exitBoxOf(level, id), {
      onNone: () => Result.failVoid,
      onSome: box => Result.succeed({ exit: id, box }),
    }),
  )

// NOTE: from the kitchen's first break on, an exit is for sale any time the
// round runs, mid-wave too (owner, 2026-10-30).
export const isExitOfferOpenFor = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(phase) &&
  phase.wave >= EXIT_RULES.firstWave

// NOTE: the keys an exit's padlock asks, shown on the lock.
export const exitKeysOf = (exit: ExitId): number =>
  exit === KITCHEN_EXIT ? EXIT_RULES.kitchenKeys : EXIT_RULES.kitchenKeys + 1

// NOTE: the kitchen tour gives the first exit away (src/world/run/tutorialRules.ts).
export const exitPriceFor: {
  (exit: ExitId): (model: World) => number
  (model: World, exit: ExitId): number
} = Function.dual(2, (model: World, exit: ExitId): number =>
  isKitchenTourOn(model) ? 0 : exitKeysOf(exit),
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
// src/world/waves/waves.ts), drawn from the run's generator. The boards smash where
// the doorway meets the parlour floor.
// The keys come off the crew's one ring, whoever holds at the boards.
export const buyExit: {
  (exit: ExitId, price: number): (model: World) => Option.Option<World>
  (model: World, exit: ExitId, price: number): Option.Option<World>
} = Function.dual(
  3,
  (model: World, exit: ExitId, price: number): Option.Option<World> => {
    const level = levelOf(model)
    const maybeBox = Option.flatMap(
      Option.filter(maybeExit(level, exit), ({ isOpen }) => !isOpen),
      () => exitBoxOf(level, exit),
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
    return Option.some(
      joinNewDoors(
        opened,
        Array.difference(levelOf(opened).doorIds, level.doorIds),
      ),
    )
  },
)
