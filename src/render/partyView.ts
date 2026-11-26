import { Array, Function, Option, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { seatLookOf } from '#art/seatLooks.ts'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  placeAt,
  spriteShapes,
} from '#art/sprite.ts'
import { hatRiseOf } from '#art/sprites/hatArt.ts'
import { maybeCrewBotAt } from '#domain/bots.ts'
import { maybeRoomOf } from '#domain/coopRoom.ts'
import { PLAYER_RADIUS } from '#shared/constants.ts'
import { noMastery } from '#shared/masteryData.ts'
import type { Appearance } from '#shared/playerData.ts'
import { isCallFresh } from '#world/party/medic.ts'
import {
  COOP_RULES,
  focusOf,
  focusSeat,
  isBledOut,
  isCoop,
  isDowned,
  isOut,
  isStanding,
  leadSeatOf,
  playersOf,
} from '#world/party/party.ts'
import { withWorld } from '#world/schema/world.ts'
import {
  type DownedLife,
  Life,
  type PlayerSlot,
  type Seat,
} from '#world/schema/worldSchema.ts'

import type { Drawable } from './depth.ts'
import * as Draw from './draw.ts'
import { rect, ringPixels } from './drawing.ts'
import { barWidthOf, healthBarShapes } from './healthBarView.ts'
import {
  type Lying,
  lyingShapes,
  playerFlashDrawable,
  playerFootY,
  playerShadow,
  playerShapes,
  reloadBarShapes,
} from './playerView.ts'
import { auraShapes } from './powerupView.ts'

const maybeLyingOf = (seat: Seat): Option.Option<Lying> => {
  if (isDowned(seat)) {
    return Option.some('Downed')
  }
  return isBledOut(seat) ? Option.some('BledOut') : Option.none()
}

const maybeLeadLyingOf = (model: Model): Option.Option<Lying> =>
  isCoop(model) ? maybeLyingOf(leadSeatOf(model)) : Option.none()

export const isLeadInHouse = (model: Model): boolean =>
  !isOut(leadSeatOf(model))

export const isLeadArmed = (model: Model): boolean =>
  isLeadInHouse(model) && Option.isNone(maybeLeadLyingOf(model))

export const leadBodyShapes: {
  (
    standing: () => ReadonlyArray<Draw.Shape>,
  ): (model: Model) => ReadonlyArray<Draw.Shape>
  (
    model: Model,
    standing: () => ReadonlyArray<Draw.Shape>,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (
    model: Model,
    standing: () => ReadonlyArray<Draw.Shape>,
  ): ReadonlyArray<Draw.Shape> =>
    isLeadInHouse(model)
      ? Option.match(maybeLeadLyingOf(model), {
          onNone: standing,
          onSome: lying => lyingShapes(model, lying),
        })
      : [],
)

export type MateModel = Readonly<{ model: Model; seat: Seat }>

export const mateModelsOf = (model: Model): ReadonlyArray<MateModel> => {
  if (!isCoop(model)) {
    return []
  }
  const lead = leadSeatOf(model).slot
  return Array.filterMap(playersOf(model), ({ seat: { slot }, seat }) =>
    slot === lead || isOut(seat)
      ? Result.failVoid
      : Result.succeed({
          seat,
          model: UiStruct.evolve(
            withWorld(model, world => focusSeat(world, slot)),
            {
              appearance: () => lookOfSeat(model, slot),
              mastery: () => noMastery,
            },
          ),
        }),
  )
}

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
): ReadonlyArray<Draw.Shape> =>
  Array.map(mates, mate => playerShadow(focusOf(mate.model).player))

export const seatHatRiseOf: {
  (slot: PlayerSlot): (model: Model) => number
  (model: Model, slot: PlayerSlot): number
} = Function.dual(2, (model: Model, slot: PlayerSlot): number =>
  hatRiseOf(lookOfSeat(model, slot)),
)

const mateBodyShapes = ({
  model,
  seat,
}: MateModel): ReadonlyArray<Draw.Shape> =>
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
  Array.flatMap(mates, (mate): ReadonlyArray<Drawable> => [
    {
      footY: playerFootY(focusOf(mate.model).player),
      rank: 'Player',
      shapes: mateBodyShapes(mate),
    },
    ...(isStanding(mate.seat)
      ? [playerFlashDrawable(focusOf(mate.model).player)]
      : []),
  ])

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
    Draw.Rect({
      x: left,
      y: top,
      width: 3,
      height: 1,
      fill: seatColorOf(slot),
    }),
    Draw.Rect({
      x: left + 1,
      y: top + 1,
      width: 1,
      height: 1,
      fill: seatColorOf(slot),
    }),
  ]
}

const BLEED_BAR_LIFT_PX = 7

const bleedBarShapes = (x: number, y: number, share: number) =>
  healthBarShapes(
    'Small',
    'Ally',
    Math.round(x - barWidthOf('Small') / 2),
    Math.round(y) - BLEED_BAR_LIFT_PX,
    share,
  )

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
): ReadonlyArray<Draw.Shape> =>
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

export const NAME_LIFT_DOWNED_PX = ICON_LIFT_PX + 2

const isDownedLife = Life.isAnyOf(['Downed'])

const maybeDownedOf = (seat: Seat): Option.Option<DownedLife> =>
  isDownedLife(seat.life) ? Option.some(seat.life) : Option.none()

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
): Draw.Shape => {
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

export const reviveRingGroundShapes = (
  model: Model,
): ReadonlyArray<Draw.Shape> =>
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

export const NAME_LIFT_CALLING_PX =
  MEDIC_BUBBLE_TIP_LIFT_PX + MEDIC_BUBBLE_HEIGHT + MEDIC_POP_PX

export const medicBubbleShape: {
  (y: number, callMs: number): (x: number) => Draw.Shape
  (x: number, y: number, callMs: number): Draw.Shape
} = Function.dual(3, (x: number, y: number, callMs: number): Draw.Shape => {
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

const seatMarkShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
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
  (mates: ReadonlyArray<MateModel>): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, mates: ReadonlyArray<MateModel>): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, mates: ReadonlyArray<MateModel>): ReadonlyArray<Draw.Shape> =>
    isCoop(model)
      ? [
          ...Array.flatMap(mates, ({ model: mate, seat }) =>
            isStanding(seat)
              ? reloadBarShapes(
                  focusOf(mate).player,
                  hatRiseOf(mate.appearance),
                )
              : [],
          ),
          ...seatMarkShapes(model),
        ]
      : [],
)

export const seatModelsOf = (
  model: Model,
): ReadonlyArray<Readonly<{ slot: PlayerSlot; model: Model }>> =>
  Array.map(playersOf(model), ({ seat: { slot } }) => ({
    slot,
    model: UiStruct.evolve(
      withWorld(model, world => focusSeat(world, slot)),
      {
        appearance: () => lookOfSeat(model, slot),
        mastery: mastery =>
          slot === leadSeatOf(model).slot ? mastery : noMastery,
      },
    ),
  }))
