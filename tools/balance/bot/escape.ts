// The balance bot's escape: the dare's list on the floor, Uncle Chunk at
// the front door, and the door his big key opens (src/world/dare/finale.ts). Each room behind
// boards holds one thing on the list (src/world/dare/dare.ts): the bot buys
// a room with a thing in it open with the crew's keys, the rooms on the way
// first, once the ring holds the padlock's price, and fetches every thing
// it can reach the way its room finds it (src/world/dare/finds.ts): it
// walks onto one, keeps still in reach of a worked one (the trunk, the
// hollow book, the dumbwaiter) with no zombie close, and for the dark
// cellar's waits for a wave to yank the bulb's chain first. It fights Uncle
// Chunk, and once his key opens the front door, goes out through it. In a break it takes what a display case opened for it holds, when it
// beats a gun it carries. It spends keys on the rooms that hold a thing on
// the list (and the kitchen), never on a room with nothing on the list.

import { Array, Option } from 'effect'

import {
  besideBox,
  isSafeToSearch,
  isWorkingSearch,
  searchSpot,
} from '../../../src/features/bots/dareSearch'
import { maybeThingRoom } from '../../../src/world/dare/dare'
import {
  frontDoorSillOf,
  isFrontDoorOpen,
} from '../../../src/world/dare/finale'
import { caseOffers } from '../../../src/world/feats/cases'
import { freshGun, isCarrying } from '../../../src/world/gear/weapons'
import { heldKeys } from '../../../src/world/keys/keys'
import {
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
import { type Model, type Vector } from './basics'
import { gunValue, weakerGun } from './guns'

const frontDoorSill = (model: Model): Vector => frontDoorSillOf(levelOf(model))

// NOTE: where the escape wants the bot: the open front door first, then
// the nearest thing on the list (src/features/bots/dareSearch.ts, the
// search the teammate bots share). Read in a break, where the cellar's
// dark thing waits for the wave.
export const escapeTarget = (model: Model): Vector | undefined =>
  isFrontDoorOpen(model)
    ? frontDoorSill(model)
    : searchSpot(model, focusOf(model).player)

// NOTE: in a wave the bot goes for the door whenever it is open, and for a
// thing (or the bulb's chain) only with no zombie close.
export const escapeTargetInWave = (model: Model): Vector | undefined => {
  if (isFrontDoorOpen(model)) {
    return frontDoorSill(model)
  }
  const { player } = focusOf(model)
  return isSafeToSearch(model, player) ? searchSpot(model, player) : undefined
}

// NOTE: whether the bot should keep still where it stands to work a find
// or the bulb's chain.
export const isWorkingForEscape = (model: Model): boolean =>
  isWorkingSearch(model, focusOf(model).player)

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
