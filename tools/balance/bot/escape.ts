// The balance bot's escape: the dare's list on the floor, Uncle Chunk's hat,
// and the open front door (src/world/dare/finale.ts). The bot walks to a
// thing on the list it can reach (a hidden one in an open room, one a
// zombie dropped, the hat), and once the front door is open, out through
// it. A thing on the list behind boards (hidden in a room, or locked in a
// case there) gets its room bought open with the crew's keys, the rooms on
// the way first, once the ring holds the padlock's price. In a break it
// takes what a display case opened for it holds, when it beats a gun it
// carries, and carries a thing off the list to a locked case, the one with
// a thing on the list inside first. With Grandma's recipe in the stove it
// fights the wave in the kitchen, for the stove's feat.

import { Array, Option } from 'effect'

import { TILE_SIZE } from '../../../src/shared/constants'
import {
  heldBy,
  isInOpenRoom,
  maybeLyingAt,
} from '../../../src/world/dare/dare'
import { DareThingState } from '../../../src/world/dare/dareSchema'
import {
  frontDoorSillOf,
  isFrontDoorOpen,
} from '../../../src/world/dare/finale'
import {
  caseFootOf,
  caseRoomOf,
  isCaseShown,
} from '../../../src/world/feats/caseSpots'
import { caseOffers } from '../../../src/world/feats/cases'
import { freshGun, isCarrying } from '../../../src/world/gear/weapons'
import { heldKeys } from '../../../src/world/keys/keys'
import {
  type Box,
  type Level,
  distanceToBox,
  levelOf,
} from '../../../src/world/level/arena'
import { exitOffers } from '../../../src/world/level/exits'
import { KITCHEN_ROOM_ID } from '../../../src/world/level/plan'
import { focusOf, focusSlotOf } from '../../../src/world/party/party'
import {
  type CasePrize,
  CaseState,
  type DisplayCase,
  type ExitId,
  Purchasable,
} from '../../../src/world/schema/worldSchema'
import type { Offer } from '../../../src/world/shop/purchase'
import { type Model, ROOM_CENTER, type Vector, distance } from './basics'
import { gunValue, weakerGun } from './guns'
import { isStandableAt } from './route'

// NOTE: how close a zombie may be before the bot leaves a thing on the
// floor for the fight, in a wave.
const SAFE_PX = 45

const frontDoorSill = (model: Model): Vector => frontDoorSillOf(levelOf(model))

const nearestOf = (
  from: Vector,
  points: ReadonlyArray<Vector>,
): Vector | undefined =>
  Array.reduce(points, undefined, (nearest: Vector | undefined, point) =>
    nearest === undefined || distance(from, point) < distance(from, nearest)
      ? point
      : nearest,
  )

// NOTE: where the dare's things lie for the bot to walk onto, on the list
// or off it.
const lyingSpots = (model: Model, isAsked: boolean): ReadonlyArray<Vector> => {
  const level = levelOf(model)
  return Array.flatMap(model.dareThings, thing =>
    thing.isAsked === isAsked ? Option.toArray(maybeLyingAt(thing, level)) : [],
  )
}

// NOTE: the nearest thing on the list lying where the bot can walk onto it.
const nearestAsked = (model: Model): Vector | undefined =>
  nearestOf(focusOf(model).player, lyingSpots(model, true))

// NOTE: where the escape wants the bot: the open front door first, then
// the nearest thing on the list.
export const escapeTarget = (model: Model): Vector | undefined =>
  isFrontDoorOpen(model) ? frontDoorSill(model) : nearestAsked(model)

// NOTE: in a wave the bot goes for the door whenever it is open, and for a
// thing only with no zombie close.
export const escapeTargetInWave = (model: Model): Vector | undefined => {
  if (isFrontDoorOpen(model)) {
    return frontDoorSill(model)
  }
  const { player } = focusOf(model)
  return Array.some(
    model.zombies,
    zombie => zombie.hp > 0 && distance(player, zombie) < SAFE_PX,
  )
    ? undefined
    : nearestAsked(model)
}

// THE BOARDS

const roomExitOf = (level: Level, roomId: string): Option.Option<ExitId> =>
  Option.flatMap(
    Array.findFirst(level.spec.rooms, room => room.id === roomId),
    room => room.maybeExit,
  )

// NOTE: the boarded exit whose room holds a point, while it is shut.
const maybeBoardedExitAt = (
  level: Level,
  point: Vector,
): Option.Option<ExitId> =>
  isInOpenRoom(level, point)
    ? Option.none()
    : Option.flatMap(
        Array.findFirst(
          level.rooms,
          ({ box }) => distanceToBox(point, box) === 0,
        ),
        ({ id }) => roomExitOf(level, id),
      )

// NOTE: the boarded exit of the room a case stands in, while it is shut.
const maybeBoardedExitOfCase = (
  level: Level,
  displayCase: DisplayCase,
): Option.Option<ExitId> =>
  isCaseShown(level, displayCase)
    ? Option.none()
    : roomExitOf(level, caseRoomOf(level, displayCase))

// NOTE: an exit and every shut exit its boards wait on, the nearest first.
const withRequired = (level: Level, exit: ExitId): ReadonlyArray<ExitId> =>
  Option.match(
    Array.findFirst(level.exits, ({ id }) => id === exit),
    {
      onNone: () => [exit],
      onSome: ({ requires }) => [
        ...Array.flatMap(
          Array.filter(
            requires,
            (required: ExitId) => !Array.contains(level.openExits, required),
          ),
          (required: ExitId) => withRequired(level, required),
        ),
        exit,
      ],
    },
  )

// NOTE: the exits shut on a thing on the list behind their boards: hidden
// in the room, or locked in the room's case.
const exitsOnTheList = (model: Model): ReadonlyArray<ExitId> => {
  const level = levelOf(model)
  return Array.dedupe(
    Array.flatMap(
      Array.flatMap(model.dareThings, (thing): ReadonlyArray<ExitId> =>
        thing.isAsked
          ? DareThingState.matchOrElse(
              thing.state,
              {
                Hidden: (spot): ReadonlyArray<ExitId> =>
                  Option.toArray(maybeBoardedExitAt(level, spot)),
                InCase: ({ caseId }): ReadonlyArray<ExitId> =>
                  Option.toArray(
                    Option.flatMap(
                      Array.findFirst(model.cases, ({ id }) => id === caseId),
                      displayCase => maybeBoardedExitOfCase(level, displayCase),
                    ),
                  ),
              },
              (): ReadonlyArray<ExitId> => [],
            )
          : [],
      ),
      (exit: ExitId) => withRequired(level, exit),
    ),
  )
}

// NOTE: the boards to buy open, in a break, for a thing on the list behind
// them, with the price in hand. The hunt comes before the other rooms.
export const wantedBoards = (model: Model): Offer | undefined => {
  const wanted = exitsOnTheList(model)
  return model.phase._tag === 'Preparation' && wanted.length > 0
    ? Array.findFirst(
        exitOffers(model),
        offer =>
          Purchasable.isAnyOf(['Exit'])(offer.target) &&
          Array.contains(wanted, offer.target.exit) &&
          heldKeys(model) >= offer.price,
      ).pipe(Option.getOrUndefined)
    : undefined
}

// NEXT TO A BOX

// NOTE: how far outside a box the bot stands to reach it.
const BESIDE_PX = 5

// NOTE: a floor point beside a box, below it first, then its sides, then
// above, so the bot never pushes into the wall a case hangs on.
const besideBox = (level: Level, box: Box): Vector => {
  const middle = {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  }
  const candidates: ReadonlyArray<Vector> = [
    { x: middle.x, y: box.bottom + BESIDE_PX },
    { x: box.right + BESIDE_PX, y: middle.y },
    { x: box.left - BESIDE_PX, y: middle.y },
    { x: middle.x, y: box.top - BESIDE_PX },
  ]
  return Option.getOrElse(
    Array.findFirst(candidates, point => isStandableAt(level, point)),
    () => middle,
  )
}

// THE CASES

// NOTE: whether the bot wants what a case holds: the Laser Sight while it
// has none, or a gun it does not carry that beats the weaker of its two
// (or fills a free slot).
const wantsPrize = (model: Model, prize: CasePrize): boolean => {
  const seat = focusOf(model)
  if (prize === 'LaserSight') {
    return seat.laserSight === 'None'
  }
  const weaker = weakerGun(model)
  return (
    !isCarrying(seat.player, prize) &&
    (weaker === undefined || gunValue(freshGun(prize)) > gunValue(weaker))
  )
}

const prizeOfOffer = (model: Model, offer: Offer): CasePrize | undefined =>
  Purchasable.isAnyOf(['Case'])(offer.target)
    ? Option.getOrUndefined(
        Option.map(
          Array.findFirst(
            model.cases,
            ({ id }) =>
              Purchasable.isAnyOf(['Case'])(offer.target) &&
              id === offer.target.id,
          ),
          ({ prize }) => prize,
        ),
      )
    : undefined

// NOTE: the case opened for the bot whose prize it wants, the nearest.
export const caseToTake = (model: Model): Offer | undefined => {
  const { player } = focusOf(model)
  return Array.reduce(
    caseOffers(model, focusSlotOf(model)),
    undefined,
    (best: Offer | undefined, offer) => {
      const prize = prizeOfOffer(model, offer)
      return prize !== undefined &&
        wantsPrize(model, prize) &&
        (best === undefined ||
          distanceToBox(player, offer.box) < distanceToBox(player, best.box))
        ? offer
        : best
    },
  )
}

// NOTE: the prize a case it takes holds, to hold the gun it gives up.
export const caseTakePrize = (model: Model): CasePrize | undefined => {
  const offer = caseToTake(model)
  return offer === undefined ? undefined : prizeOfOffer(model, offer)
}

export const caseTarget = (model: Model): Vector | undefined => {
  const offer = caseToTake(model)
  return offer === undefined ? undefined : besideBox(levelOf(model), offer.box)
}

export const isAtCase = (model: Model): boolean => {
  const offer = caseToTake(model)
  return (
    offer !== undefined &&
    distanceToBox(focusOf(model).player, offer.box) <= offer.reachPx - 2
  )
}

// DELIVERING

const isLockedShown = (level: Level, displayCase: DisplayCase): boolean =>
  CaseState.isAnyOf(['Locked'])(displayCase.state) &&
  isCaseShown(level, displayCase)

const holdsAsked = (model: Model, displayCase: DisplayCase): boolean =>
  Array.some(
    model.dareThings,
    ({ isAsked, state }) =>
      isAsked &&
      DareThingState.isAnyOf(['InCase'])(state) &&
      state.caseId === displayCase.id,
  )

// NOTE: how much the bot wants a locked case opened: a thing on the list
// inside most, then a prize it wants, then any.
const caseWorth = (model: Model, displayCase: DisplayCase): number =>
  (holdsAsked(model, displayCase) ? 4 : 0) +
  (wantsPrize(model, displayCase.prize) ? 2 : 0) +
  1

// NOTE: the locked case in an open room a thing off the list goes to.
const deliveryCase = (model: Model): DisplayCase | undefined => {
  const level = levelOf(model)
  const { player } = focusOf(model)
  return Array.reduce(
    Array.filter(model.cases, displayCase => isLockedShown(level, displayCase)),
    undefined,
    (best: DisplayCase | undefined, displayCase) =>
      best === undefined ||
      caseWorth(model, displayCase) > caseWorth(model, best) ||
      (caseWorth(model, displayCase) === caseWorth(model, best) &&
        distance(player, caseFootOf(level, displayCase)) <
          distance(player, caseFootOf(level, best)))
        ? displayCase
        : best,
  )
}

// NOTE: in a break, with a locked case to open: the case's foot while the
// bot holds a thing off the list, else the nearest such thing lying about.
export const deliveryTarget = (model: Model): Vector | undefined => {
  const displayCase = deliveryCase(model)
  if (displayCase === undefined) {
    return undefined
  }
  const level = levelOf(model)
  if (Array.isReadonlyArrayNonEmpty(heldBy(model, focusSlotOf(model)))) {
    const foot = caseFootOf(level, displayCase)
    const below = { x: foot.x, y: foot.y + BESIDE_PX }
    return isStandableAt(level, below) ? below : foot
  }
  return nearestOf(focusOf(model).player, lyingSpots(model, false))
}

// THE STOVE

// NOTE: Grandma's recipe on the list, still in the stove, with the kitchen
// open: the bot fights the wave in the kitchen for the stove's feat, while
// it has hearts to spare.
const STOVE_MIN_HP = 3

export const wantsStoveFeat = (model: Model): boolean =>
  focusOf(model).player.hp >= STOVE_MIN_HP &&
  Array.some(
    model.dareThings,
    ({ isAsked, state }) =>
      isAsked && DareThingState.isAnyOf(['InStove'])(state),
  ) &&
  Array.some(
    levelOf(model).rooms,
    ({ id, isOpen }) => id === KITCHEN_ROOM_ID && isOpen,
  )

// NOTE: the kitchen's open floor below the prep table, ten and a half
// tiles in from its top left on the kitchen's map.
const KITCHEN_STAND_TILES = 10.5

const kitchenStand = (level: Level): Vector =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(level.rooms, ({ id }) => id === KITCHEN_ROOM_ID),
      ({ box }) => ({
        x: box.left + KITCHEN_STAND_TILES * TILE_SIZE,
        y: box.top + KITCHEN_STAND_TILES * TILE_SIZE,
      }),
    ),
    () => ROOM_CENTER,
  )

// NOTE: where the bot holds in a wave: the kitchen for the stove's feat,
// else the dining room's aisle.
export const holdPoint = (model: Model): Vector =>
  wantsStoveFeat(model) ? kitchenStand(levelOf(model)) : ROOM_CENTER
