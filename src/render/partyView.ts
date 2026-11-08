import { Array, Function, Option, Result } from 'effect'
import { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Appearance, Model } from '../app/model'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  placeAt,
  spriteShapes,
} from '../art/sprite'
import { maybeCrewBotAt } from '../features/bots/bots'
import { seatLookOf } from '../features/coop/looks'
import { maybeRoomOf } from '../features/coop/roomState'
import { hatRiseOf } from '../features/look/hatArt'
import { PLAYER_RADIUS } from '../shared/constants'
import { isCallFresh } from '../world/party/medic'
import {
  COOP_RULES,
  focusOf,
  focusSeat,
  isBledOut,
  isCoop,
  isDowned,
  isStanding,
  leadSeatOf,
  playersOf,
} from '../world/party/party'
import { withWorld } from '../world/schema/world'
import {
  type DownedLife,
  Life,
  type PlayerSlot,
  type Seat,
} from '../world/schema/worldSchema'
import type { Drawable } from './depth'
import { rect, ringPixels } from './drawing'
import { barWidthOf, healthBarShapes } from './healthBarView'
import {
  type Lying,
  lyingShapes,
  playerFlashShapes,
  playerFootY,
  playerShadow,
  playerShapes,
  reloadBarShapes,
} from './playerView'
import { auraShapes } from './powerupView'

// Teammates in the world view (MULTIPLAYER.md, Phase 1): each other player
// drawn as the player is, a marker of their seat's color over their head,
// and a player who is out of the fight lying on the floor: downed, with
// their bleed bar, a revive icon, and the ring a teammate stands in to
// pick them up; bled out, a still body until the break.

// LYING DOWN

// NOTE: how a seat is drawn: standing in single player and while standing
// in co-op, lying once downed or bled out.
const maybeLyingOf = (seat: Seat): Option.Option<Lying> => {
  if (isDowned(seat)) {
    return Option.some('Downed')
  }
  return isBledOut(seat) ? Option.some('BledOut') : Option.none()
}

const maybeLeadLyingOf = (model: Model): Option.Option<Lying> =>
  isCoop(model) ? maybeLyingOf(leadSeatOf(model)) : Option.none()

// NOTE: whether the lead holds a gun up: always in single player, and in
// co-op while standing. Their muzzle flash, reload bar, and laser sight
// show only then.
export const isLeadArmed = (model: Model): boolean =>
  Option.isNone(maybeLeadLyingOf(model))

// NOTE: the lead's body: on its feet as `standing` draws it, or lying.
export const leadBodyShapes: {
  (
    standing: () => ReadonlyArray<Canvas.Shape>,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (
    model: Model,
    standing: () => ReadonlyArray<Canvas.Shape>,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (
    model: Model,
    standing: () => ReadonlyArray<Canvas.Shape>,
  ): ReadonlyArray<Canvas.Shape> =>
    Option.match(maybeLeadLyingOf(model), {
      onNone: standing,
      onSome: lying => lyingShapes(model, lying),
    }),
)

// TEAMMATES

export type MateModel = Readonly<{ model: Model; seat: Seat }>

// NOTE: the client Model as each teammate's seat would show it, so the
// player's own views draw them. Only co-op pays for it, and a frame builds
// them once for the views that need them. Online, each teammate wears their
// own look from the lobby (src/features/coop/looks.ts).
export const mateModelsOf = (model: Model): ReadonlyArray<MateModel> => {
  if (!isCoop(model)) {
    return []
  }
  const lead = leadSeatOf(model).slot
  return Array.filterMap(playersOf(model), ({ seat: { slot }, seat }) =>
    slot === lead
      ? Result.failVoid
      : Result.succeed({
          seat,
          model: modifyFields(
            withWorld(model, world => focusSeat(world, slot)),
            { appearance: () => lookOfSeat(model, slot) },
          ),
        }),
  )
}

// NOTE: the look a seat wears: online, the one it brought to the lobby; a
// bot, its own; otherwise the player's.
const lookOfSeat = (model: Model, slot: PlayerSlot): Appearance => {
  const maybeRoom = maybeRoomOf(model.coop)
  return Option.isSome(maybeRoom)
    ? seatLookOf(
        model.appearance,
        leadSeatOf(model).slot,
        slot,
        Option.flatMap(maybeRoom, room => room.maybeLobby),
      )
    : Option.match(maybeCrewBotAt(model, slot), {
        onNone: () => model.appearance,
        onSome: bot => bot.look,
      })
}

export const mateShadowShapes = (
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(mates, mate => playerShadow(focusOf(mate.model).player))

// NOTE: the pixels a seat's hat stands over its head, from the look it
// wears (a teammate's from the lobby), for the marks drawn over it.
export const seatHatRiseOf: {
  (slot: PlayerSlot): (model: Model) => number
  (model: Model, slot: PlayerSlot): number
} = Function.dual(2, (model: Model, slot: PlayerSlot): number =>
  hatRiseOf(lookOfSeat(model, slot)),
)

const mateBodyShapes = ({
  model,
  seat,
}: MateModel): ReadonlyArray<Canvas.Shape> =>
  Option.match(maybeLyingOf(seat), {
    onNone: () => [
      ...auraShapes(
        focusOf(model).player,
        focusOf(model).boosts,
        model.elapsedMs,
      ),
      ...playerShapes(model),
    ],
    onSome: lying => lyingShapes(model, lying),
  })

export const mateDrawables = (
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Drawable> =>
  Array.map(mates, (mate): Drawable => ({
    footY: playerFootY(focusOf(mate.model).player),
    rank: 'Player',
    shapes: mateBodyShapes(mate),
  }))

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
const BAR_BACK = '#1a0f14'
const REVIVE_COLOR = '#8cff5a'

const markShapes = (slot: PlayerSlot, x: number, y: number, rise: number) => {
  const left = Math.round(x) - 1
  const top = Math.round(y) - MARK_LIFT_PX - rise
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

// NOTE: a downed player's bleed bar sits just over the lying body,
// draining red as they bleed out.
const BLEED_BAR_LIFT_PX = 7

const bleedBarShapes = (x: number, y: number, share: number) =>
  healthBarShapes(
    'Small',
    'Ally',
    Math.round(x - barWidthOf('Small') / 2),
    Math.round(y) - BLEED_BAR_LIFT_PX,
    share,
  )

// THE REVIVE ICON

// NOTE: over a downed player, a plus on a plate edged in their seat's
// color: help me up. It bobs, and its plus turns green while a teammate
// is picking them up. Built once per seat, as the module loads.
const ICON_PX = 7
const ICON_LIFT_PX = 17
const ICON_BOB_MS = 300
const PLUS_IDLE = '#ffffff'

const reviveIconOf = (color: string, plus: string): Sprite =>
  bakeShapes([
    rect(1, 0, ICON_PX - 2, ICON_PX, BAR_BACK),
    rect(0, 1, ICON_PX, ICON_PX - 2, BAR_BACK),
    rect(1, 1, ICON_PX - 2, ICON_PX - 2, color),
    rect(2, 2, ICON_PX - 4, ICON_PX - 4, BAR_BACK),
    rect(3, 2, 1, 3, plus),
    rect(2, 3, 3, 1, plus),
  ])

type ReviveIcons = Readonly<{ waiting: Sprite; reviving: Sprite }>

const REVIVE_ICONS: ReadonlyArray<ReviveIcons> = Array.map(
  SEAT_COLORS,
  color => ({
    waiting: reviveIconOf(color, PLUS_IDLE),
    reviving: reviveIconOf(color, REVIVE_COLOR),
  }),
)

const reviveIconShapes = (
  slot: PlayerSlot,
  x: number,
  y: number,
  isReviving: boolean,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(Array.get(REVIVE_ICONS, slot % REVIVE_ICONS.length), {
    onNone: () => [],
    onSome: icons => [
      placeAt(
        Math.round(x) - Math.floor(ICON_PX / 2),
        Math.round(y) -
          ICON_LIFT_PX -
          (isReviving ? 0 : Math.floor(elapsedMs / ICON_BOB_MS) % 2),
        isReviving ? icons.reviving : icons.waiting,
      ),
    ],
  })

// NOTE: how far over a player a name tag's bottom sits: over the head, or
// over the revive icon while they are down.
export const NAME_LIFT_DOWNED_PX = ICON_LIFT_PX + 2

const isDownedLife = Life.isAnyOf(['Downed'])

const maybeDownedOf = (seat: Seat): Option.Option<DownedLife> =>
  isDownedLife(seat.life) ? Option.some(seat.life) : Option.none()

// THE REVIVE RING

// NOTE: on the floor around a downed player, the ring a teammate stands in
// to pick them up (COOP_RULES.reviveReachPx past the players' own radius):
// faint while nobody is in it, filling green round from the top as the
// revive fills. Every step is built once, as the module loads.
const RING_RADIUS = PLAYER_RADIUS + COOP_RULES.reviveReachPx
const RING_STEPS = 16
const RING_EMPTY = '#e8dcc8'
const RING_IDLE_OPACITY = 0.35
const RING_PIXELS = ringPixels(RING_RADIUS)

const ringSprite = (filled: number): Sprite =>
  bakeShapes(
    Array.map(RING_PIXELS, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? REVIVE_COLOR : RING_EMPTY),
    ),
  )

const REVIVE_RINGS: Array.NonEmptyReadonlyArray<Sprite> = [
  ringSprite(0),
  ...Array.makeBy(RING_STEPS, step => ringSprite((step + 1) / RING_STEPS)),
]

const reviveRingShapes = (
  x: number,
  y: number,
  reviveMs: number,
): Canvas.Shape => {
  const step = Math.min(
    RING_STEPS,
    Math.floor((reviveMs / COOP_RULES.reviveMs) * RING_STEPS),
  )
  return group({
    opacity: reviveMs > 0 ? 1 : RING_IDLE_OPACITY,
    shapes: [
      placeAt(
        Math.round(x),
        Math.round(y),
        Option.getOrElse(Array.get(REVIVE_RINGS, step), () =>
          Array.headNonEmpty(REVIVE_RINGS),
        ),
      ),
    ],
  })
}

// NOTE: on the floor, under everyone: each downed player's revive ring.
export const reviveRingGroundShapes = (
  model: Model,
): ReadonlyArray<Canvas.Shape> =>
  isCoop(model)
    ? Array.flatMap(playersOf(model), ({ seat, player }) =>
        Option.match(maybeDownedOf(seat), {
          onNone: () => [],
          onSome: ({ reviveMs }) => [
            reviveRingShapes(player.x, player.y, reviveMs),
          ],
        }),
      )
    : []

// THE MEDIC BUBBLE

// NOTE: while a downed player's MEDIC! shout is fresh (src/world/party/medic.ts), a
// speech bubble with a red cross pops over the body in place of the revive
// icon: it jumps up as it pops, then shakes a pixel side to side. Its tail
// points down at the body. Built once, as the module loads.
const MEDIC_BUBBLE: Sprite = spriteShapes(
  [
    '.ooooooooooo.',
    'owwwwwwwwwwwo',
    'owwwwrrrwwwwo',
    'owwwwrrrwwwwo',
    'owrrrrrrrrrwo',
    'owrrrrrrrrrwo',
    'owrrrrrrrrrwo',
    'owwwwrrrwwwwo',
    'owwwwrrrwwwwo',
    'owwwwwwwwwwwo',
    '.oooooowoooo.',
    '......owo....',
    '.......o.....',
  ],
  { o: BAR_BACK, w: '#f4f1de', r: '#e8343a' },
  TOP_LEFT,
)

const MEDIC_BUBBLE_WIDTH = 13
const MEDIC_BUBBLE_HEIGHT = 13
const MEDIC_BUBBLE_TIP_LIFT_PX = 9
const MEDIC_POP_MS = 150
const MEDIC_POP_PX = 3
const MEDIC_SHAKE_MS = 90

// NOTE: how far over a calling player a name tag's bottom sits: over the
// bubble.
export const NAME_LIFT_CALLING_PX =
  MEDIC_BUBBLE_TIP_LIFT_PX + MEDIC_BUBBLE_HEIGHT + MEDIC_POP_PX

export const medicBubbleShape: {
  (y: number, callMs: number): (x: number) => Canvas.Shape
  (x: number, y: number, callMs: number): Canvas.Shape
} = Function.dual(3, (x: number, y: number, callMs: number): Canvas.Shape => {
  const isPopping = callMs < MEDIC_POP_MS
  const shake = isPopping
    ? 0
    : (Math.floor(callMs / MEDIC_SHAKE_MS) % 2) * 2 - 1
  return placeAt(
    Math.round(x) - Math.floor(MEDIC_BUBBLE_WIDTH / 2) + 1 + shake,
    Math.round(y) -
      MEDIC_BUBBLE_TIP_LIFT_PX -
      MEDIC_BUBBLE_HEIGHT -
      (isPopping ? MEDIC_POP_PX : 0),
    MEDIC_BUBBLE,
  )
})

// NOTE: over every player's head in co-op: their seat's mark while they
// stand; while they are down, the bleed bar and the revive icon. A
// bled-out body gets nothing.
const seatMarkShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  isCoop(model)
    ? Array.flatMap(playersOf(model), ({ seat: { slot }, seat, player }) => {
        if (isStanding(seat)) {
          return markShapes(
            slot,
            player.x,
            player.y,
            seatHatRiseOf(model, slot),
          )
        }
        return Option.match(maybeDownedOf(seat), {
          onNone: () => [],
          onSome: ({ bleedMs, reviveMs, callMs }) => [
            ...bleedBarShapes(
              player.x,
              player.y,
              bleedMs / COOP_RULES.bleedOutMs,
            ),
            ...(isCallFresh(seat)
              ? [medicBubbleShape(player.x, player.y, callMs)]
              : reviveIconShapes(
                  slot,
                  player.x,
                  player.y,
                  reviveMs > 0,
                  model.elapsedMs,
                )),
          ],
        })
      })
    : []

export const mateOverheadShapes: {
  (
    mates: ReadonlyArray<MateModel>,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, mates: ReadonlyArray<MateModel>): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (
    model: Model,
    mates: ReadonlyArray<MateModel>,
  ): ReadonlyArray<Canvas.Shape> =>
    isCoop(model)
      ? [
          ...Array.flatMap(mates, ({ model: mate, seat }) =>
            isStanding(seat)
              ? [
                  ...playerFlashShapes(focusOf(mate).player),
                  ...reloadBarShapes(
                    focusOf(mate).player,
                    hatRiseOf(mate.appearance),
                  ),
                ]
              : [],
          ),
          ...seatMarkShapes(model),
        ]
      : [],
)

// NOTE: every player, the lead too, as their own seat's Model, for the end
// card's crew: each wears their own look, as in the world.
export const seatModelsOf = (
  model: Model,
): ReadonlyArray<Readonly<{ slot: PlayerSlot; model: Model }>> =>
  Array.map(playersOf(model), ({ seat: { slot } }) => ({
    slot,
    model: modifyFields(
      withWorld(model, world => focusSeat(world, slot)),
      { appearance: () => lookOfSeat(model, slot) },
    ),
  }))
