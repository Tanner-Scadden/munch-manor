// The balance bot's escape: the dare's list on the floor, Uncle Chunk's hat,
// and the open front door (src/world/dare/finale.ts). The bot walks to a
// thing on the list it can reach (a hidden one in an open room, one a
// zombie dropped, the hat), and once the front door is open, out through
// it. A full hunt (opening rooms for the things behind boards) is a later
// layer's.

import { Array, Option } from 'effect'

import { maybeLyingAt } from '../../../src/world/dare/dare'
import {
  frontDoorSillOf,
  isFrontDoorOpen,
} from '../../../src/world/dare/finale'
import { levelOf } from '../../../src/world/level/arena'
import { focusOf } from '../../../src/world/party/party'
import { type Model, type Vector, distance } from './basics'

// NOTE: how close a zombie may be before the bot leaves a thing on the
// floor for the fight, in a wave.
const SAFE_PX = 45

const frontDoorSill = (model: Model): Vector =>
  frontDoorSillOf(levelOf(model))

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
