import { Array, Option } from 'effect'

import {
  besideBox,
  isSafeToSearch,
  isWorkingSearch,
  maybeNextPadlock,
  searchSpot,
} from '../../../src/features/bots/dareSearch'
import {
  frontDoorSillOf,
  isFrontDoorOpen,
} from '../../../src/world/dare/finale'
import { caseOffers } from '../../../src/world/feats/cases'
import { freshGun, isCarrying } from '../../../src/world/gear/weapons'
import { heldKeys } from '../../../src/world/keys/keys'
import { levelOf } from '../../../src/world/level/arena'
import { exitOffers } from '../../../src/world/level/exits'
import { distanceToBox } from '../../../src/world/level/tileGrid'
import { focusOf, focusSlotOf } from '../../../src/world/party/party'
import {
  type CasePrize,
  Purchasable,
} from '../../../src/world/schema/worldSchema'
import type { Offer } from '../../../src/world/shop/purchase'
import { type Model, type Vector } from './basics'
import { gunValue, weakerGun } from './guns'

const frontDoorSill = (model: Model): Vector => frontDoorSillOf(levelOf(model))

export const escapeTarget = (model: Model): Vector | undefined =>
  isFrontDoorOpen(model)
    ? frontDoorSill(model)
    : searchSpot(model, focusOf(model).player)

export const escapeTargetInWave = (model: Model): Vector | undefined => {
  if (isFrontDoorOpen(model)) {
    return frontDoorSill(model)
  }
  const { player } = focusOf(model)
  return isSafeToSearch(model, player) ? searchSpot(model, player) : undefined
}

export const isWorkingForEscape = (model: Model): boolean =>
  isWorkingSearch(model, focusOf(model).player)

export const wantedBoards = (model: Model): Offer | undefined => {
  const maybeNext = maybeNextPadlock(model)
  return model.phase._tag === 'Preparation'
    ? Array.findFirst(
        exitOffers(model),
        offer =>
          Purchasable.isAnyOf(['Exit'])(offer.target) &&
          Option.exists(
            maybeNext,
            ({ exit }) =>
              Purchasable.isAnyOf(['Exit'])(offer.target) &&
              offer.target.exit === exit,
          ) &&
          heldKeys(model) >= offer.price,
      ).pipe(Option.getOrUndefined)
    : undefined
}

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
