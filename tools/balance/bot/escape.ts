// The balance bot's escape: the dare's list on the floor, Uncle Chunk's hat,
// and the open front door (src/world/dare/finale.ts). The bot walks to a
// thing on the list it can reach (a hidden one in an open room, one a
// zombie dropped, the hat), and once the front door is open, out through
// it. A thing on the list hidden behind boards gets its room bought open
// with the crew's keys, once the ring holds the padlock's price.

import { Array, Option } from 'effect'

import { isInOpenRoom, maybeLyingAt } from '../../../src/world/dare/dare'
import { DareThingState } from '../../../src/world/dare/dareSchema'
import {
  frontDoorSillOf,
  isFrontDoorOpen,
} from '../../../src/world/dare/finale'
import { heldKeys } from '../../../src/world/keys/keys'
import {
  type Level,
  distanceToBox,
  levelOf,
} from '../../../src/world/level/arena'
import { exitOffers } from '../../../src/world/level/exits'
import { focusOf } from '../../../src/world/party/party'
import { type ExitId, Purchasable } from '../../../src/world/schema/worldSchema'
import type { Offer } from '../../../src/world/shop/purchase'
import { type Model, type Vector, distance } from './basics'

// NOTE: how close a zombie may be before the bot leaves a thing on the
// floor for the fight, in a wave.
const SAFE_PX = 45

const frontDoorSill = (model: Model): Vector => frontDoorSillOf(levelOf(model))

// NOTE: the nearest thing on the list lying where the bot can walk onto it.
const nearestAsked = (model: Model): Vector | undefined => {
  const { player } = focusOf(model)
  const level = levelOf(model)
  return Array.reduce(
    model.dareThings,
    undefined,
    (nearest: Vector | undefined, thing): Vector | undefined =>
      thing.isAsked
        ? Option.match(maybeLyingAt(thing, level), {
            onNone: () => nearest,
            onSome: spot =>
              nearest === undefined ||
              distance(player, spot) < distance(player, nearest)
                ? spot
                : nearest,
          })
        : nearest,
  )
}

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

// NOTE: the boarded exit whose room holds a point, while it is shut.
const maybeBoardedExitAt = (
  level: Level,
  point: Vector,
): Option.Option<ExitId> =>
  isInOpenRoom(level, point)
    ? Option.none()
    : Array.findFirst(level.spec.rooms, room =>
        Array.some(
          level.rooms,
          ({ id, box }) => id === room.id && distanceToBox(point, box) === 0,
        )
          ? room.maybeExit
          : Option.none(),
      )

// NOTE: the exits shut on a thing on the list hidden behind their boards.
const exitsOnTheList = (model: Model): ReadonlyArray<ExitId> => {
  const level = levelOf(model)
  return Array.dedupe(
    Array.flatMap(model.dareThings, (thing): ReadonlyArray<ExitId> =>
      thing.isAsked
        ? DareThingState.matchOrElse(
            thing.state,
            {
              Hidden: (spot): ReadonlyArray<ExitId> =>
                Option.toArray(maybeBoardedExitAt(level, spot)),
            },
            (): ReadonlyArray<ExitId> => [],
          )
        : [],
    ),
  )
}

// NOTE: the boards to buy open, in a break, for a thing on the list behind
// them, with the price in hand. The hunt comes before the shop's list.
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
