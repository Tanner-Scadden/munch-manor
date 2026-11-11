// The balance bot's escape: the dare's list on the floor, Uncle Chunk's hat,
// and the open front door (src/world/dare/finale.ts). Each room behind
// boards holds one thing on the list (src/world/dare/dare.ts): the bot buys
// a room with a thing in it open with the crew's keys, the rooms on the way
// first, once the ring holds the padlock's price, and walks onto every thing
// it can reach, then the hat, and once the front door is open, out through
// it. In a break it takes what a display case opened for it holds, when it
// beats a gun it carries.

import { Array, Option } from 'effect'

import { maybeLyingAt, maybeThingRoom } from '../../../src/world/dare/dare'
import {
  frontDoorSillOf,
  isFrontDoorOpen,
} from '../../../src/world/dare/finale'
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
import { focusOf, focusSlotOf } from '../../../src/world/party/party'
import {
  type CasePrize,
  type ExitId,
  Purchasable,
} from '../../../src/world/schema/worldSchema'
import type { Offer } from '../../../src/world/shop/purchase'
import { type Model, type Vector, distance } from './basics'
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

// NOTE: where the dare's things lie for the bot to walk onto.
const lyingSpots = (model: Model): ReadonlyArray<Vector> => {
  const level = levelOf(model)
  return Array.flatMap(model.dareThings, thing =>
    Option.toArray(maybeLyingAt(thing, level)),
  )
}

// NOTE: the nearest thing on the list lying where the bot can walk onto it.
const nearestAsked = (model: Model): Vector | undefined =>
  nearestOf(focusOf(model).player, lyingSpots(model))

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

// NOTE: the exits shut on a thing on the list behind their boards.
const exitsOnTheList = (model: Model): ReadonlyArray<ExitId> => {
  const level = levelOf(model)
  return Array.dedupe(
    Array.flatMap(
      Array.flatMap(model.dareThings, (thing): ReadonlyArray<ExitId> =>
        Option.toArray(
          Option.flatMap(
            Option.filter(
              maybeThingRoom(thing, level),
              ({ isOpen }) => !isOpen,
            ),
            ({ id }) => roomExitOf(level, id),
          ),
        ),
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
