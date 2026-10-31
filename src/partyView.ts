import { Array, Option, Result } from 'effect'
import { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { seatLookOf } from './coop/looks'
import { maybeRoomOf } from './coop/roomState'
import type { Drawable } from './depth'
import type { Model } from './model'
import {
  COOP_RULES,
  focusSeat,
  isBledOut,
  isCoop,
  leadSeatOf,
  playersOf,
} from './party'
import {
  playerFlashShapes,
  playerFootY,
  playerShadow,
  playerShapes,
  reloadBarShapes,
} from './playerView'
import { auraShapes } from './powerupView'
import { withWorld } from './world'
import { Life, type PlayerSlot, type Seat } from './worldSchema'

// Teammates in the world view (MULTIPLAYER.md, Phase 1): each other player
// drawn as the player is, a marker of their seat's color over their head,
// and a downed player's bleed and revive bars.

// NOTE: the client Model as each teammate's seat would show it, so the
// player's own views draw them. Only co-op pays for it. Online, each
// teammate wears their own look from the lobby (src/coop/looks.ts).
const mateModelsOf = (model: Model): ReadonlyArray<Model> => {
  const lead = leadSeatOf(model).slot
  const maybeRoom = maybeRoomOf(model.coop)
  const isOnline = Option.isSome(maybeRoom)
  const maybeLobby = Option.flatMap(maybeRoom, room => room.maybeLobby)
  return Array.filterMap(playersOf(model), ({ slot, seat }) =>
    slot === lead || isBledOut(seat)
      ? Result.failVoid
      : Result.succeed(
          modifyFields(
            withWorld(model, world => focusSeat(world, slot)),
            {
              appearance: appearance =>
                isOnline
                  ? seatLookOf(appearance, lead, slot, maybeLobby)
                  : appearance,
            },
          ),
        ),
  )
}

export const isLeadShown = (model: Model): boolean =>
  !isCoop(model) || !isBledOut(leadSeatOf(model))

export const mateShadowShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  isCoop(model)
    ? Array.map(mateModelsOf(model), mate => playerShadow(mate.player))
    : []

export const mateDrawables = (model: Model): ReadonlyArray<Drawable> =>
  isCoop(model)
    ? Array.map(mateModelsOf(model), (mate): Drawable => ({
        footY: playerFootY(mate.player),
        rank: 'Player',
        shapes: [
          ...auraShapes(mate.player, mate.boosts, mate.elapsedMs),
          ...playerShapes(mate),
        ],
      }))
    : []

// SEAT MARKS

const SEAT_COLORS: ReadonlyArray<string> = [
  '#ffd23f',
  '#3fd2ff',
  '#ff6fb5',
  '#8cff5a',
]

export const seatColorOf = (slot: PlayerSlot): string =>
  Option.getOrElse(
    Array.get(SEAT_COLORS, slot % SEAT_COLORS.length),
    () => '#ffffff',
  )

const MARK_LIFT_PX = 15
const BAR_WIDTH = 12
const BAR_LIFT_PX = 19

const markShapes = (slot: PlayerSlot, x: number, y: number) => {
  const left = Math.round(x) - 1
  const top = Math.round(y) - MARK_LIFT_PX
  return [
    Canvas.Rect({
      x: left,
      y: top,
      width: 3,
      height: 1,
      fill: seatColorOf(slot),
    }),
    Canvas.Rect({
      x: left + 1,
      y: top + 1,
      width: 1,
      height: 1,
      fill: seatColorOf(slot),
    }),
  ]
}

const barShapes = (x: number, y: number, share: number, fill: string) => {
  const left = Math.round(x - BAR_WIDTH / 2)
  const top = Math.round(y) - BAR_LIFT_PX
  return [
    Canvas.Rect({
      x: left - 1,
      y: top - 1,
      width: BAR_WIDTH + 2,
      height: 3,
      fill: '#1a0f14',
    }),
    Canvas.Rect({
      x: left,
      y: top,
      width: Math.max(
        1,
        Math.round(BAR_WIDTH * Math.min(1, Math.max(0, share))),
      ),
      height: 1,
      fill,
    }),
  ]
}

const lifeShapes = (seat: Seat, x: number, y: number) =>
  Life.match(seat.life, {
    Standing: () => [],
    Downed: ({ bleedMs, reviveMs }) =>
      reviveMs > 0
        ? barShapes(x, y, reviveMs / COOP_RULES.reviveMs, '#8cff5a')
        : barShapes(x, y, bleedMs / COOP_RULES.bleedOutMs, '#ff3b3b'),
    BledOut: () => [],
  })

// NOTE: over every player's head in co-op: their seat's mark, and while
// they are down, the bleed bar or the revive bar filling.
const seatMarkShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  isCoop(model)
    ? Array.flatMap(playersOf(model), ({ slot, seat, player }) =>
        isBledOut(seat)
          ? []
          : [
              ...markShapes(slot, player.x, player.y),
              ...lifeShapes(seat, player.x, player.y),
            ],
      )
    : []

export const mateOverheadShapes = (
  model: Model,
): ReadonlyArray<Canvas.Shape> =>
  isCoop(model)
    ? [
        ...Array.flatMap(mateModelsOf(model), mate => [
          ...playerFlashShapes(mate.player),
          ...reloadBarShapes(mate.player),
        ]),
        ...seatMarkShapes(model),
      ]
    : []

// NOTE: every player, the lead too, as their own seat's Model, for the end
// card's crew: each wears their own look, as in the world.
export const seatModelsOf = (
  model: Model,
): ReadonlyArray<Readonly<{ slot: PlayerSlot; model: Model }>> => {
  const lead = leadSeatOf(model).slot
  const maybeRoom = maybeRoomOf(model.coop)
  const maybeLobby = Option.flatMap(maybeRoom, room => room.maybeLobby)
  return Array.map(playersOf(model), ({ slot }) => ({
    slot,
    model: modifyFields(
      withWorld(model, world => focusSeat(world, slot)),
      {
        appearance: appearance =>
          Option.isSome(maybeRoom)
            ? seatLookOf(appearance, lead, slot, maybeLobby)
            : appearance,
      },
    ),
  }))
}
