import { Array, Option, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Camera, worldToView } from './camera'
import { maybeRoomOf } from './coop/roomState'
import { textShapes } from './font'
import type { Model } from './model'
import { seatNamesOf } from './onlineRun'
import { isBledOut, isCoop, isDowned, leadSeatOf, playersOf } from './party'
import { NAME_LIFT_DOWNED_PX, seatColorOf, seatHatRiseOf } from './partyView'
import { TOP_LEFT, bakeShapes, placeAt, spriteShapes } from './sprite'
import { isBreak } from './waves'

// What an online co-op run adds over the players (MULTIPLAYER.md, Phase
// 2): each teammate's name over their head, READY over everyone who is
// ready in a break, and a teammate off screen as a small badge of their
// seat's color at the screen's edge, toward them (decided 4, the one
// exception to "No off-screen hints"). Zombies and doors get nothing.

const isOnline = (model: Model): boolean =>
  isCoop(model) && Option.isSome(maybeRoomOf(model.coop))

// NAME TAGS

// NOTE: a teammate's name is a small tag tight over their head: a 3 by 4
// pixel font, smaller than the game's own, light on a dark plate so it
// reads on any floor, with a line of their seat's color under it. The
// glyphs are sprites built once; only the plate and the line are drawn
// each frame. A symbol the font lacks is left out.
const TAG_PIXELS: Readonly<Record<string, ReadonlyArray<string>>> = {
  A: ['.#.', '#.#', '###', '#.#'],
  B: ['##.', '###', '#.#', '##.'],
  C: ['.##', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '##.'],
  E: ['###', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..'],
  G: ['.##', '#..', '#.#', '.##'],
  H: ['#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '###'],
  J: ['..#', '..#', '#.#', '.#.'],
  K: ['#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#'],
  O: ['.#.', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..'],
  Q: ['.#.', '#.#', '#.#', '.##'],
  R: ['##.', '#.#', '##.', '#.#'],
  S: ['.##', '#..', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '.#.', '.#.', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.'],
  Z: ['###', '..#', '#..', '###'],
  '0': ['###', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '###'],
  '3': ['###', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#'],
  '5': ['###', '##.', '..#', '##.'],
  '6': ['#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.'],
  '8': ['###', '.#.', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#'],
}

const TAG_ROWS = 4
const TAG_GAP = 1
const TAG_SPACE = 2
const TAG_PAD = 1
const TAG_INK = '#f4f1de'
const TAG_PLATE = 'rgba(16, 10, 18, 0.72)'

type TagGlyph = Readonly<{ width: number; sprite: ReadonlyArray<Canvas.Shape> }>

const TAG_GLYPHS: ReadonlyMap<string, TagGlyph> = new Map(
  Array.map(Object.entries(TAG_PIXELS), ([symbol, pixels]) => [
    symbol,
    {
      width: Array.reduce(pixels, 0, (widest, row) =>
        Math.max(widest, row.length),
      ),
      sprite: spriteShapes(pixels, { '#': TAG_INK }, TOP_LEFT),
    },
  ]),
)

type TagCell = Readonly<{ width: number; maybeGlyph: Option.Option<TagGlyph> }>

const tagCellsOf = (name: string): ReadonlyArray<TagCell> =>
  Array.flatMap(
    globalThis.Array.from(name),
    (symbol): ReadonlyArray<TagCell> =>
      symbol === ' '
        ? [{ width: TAG_SPACE, maybeGlyph: Option.none() }]
        : Option.match(Option.fromNullishOr(TAG_GLYPHS.get(symbol)), {
            onNone: () => [],
            onSome: glyph => [
              { width: glyph.width, maybeGlyph: Option.some(glyph) },
            ],
          }),
  )

const tagWidthOf = (cells: ReadonlyArray<TagCell>): number =>
  Math.max(
    0,
    Array.reduce(cells, 0, (total, cell) => total + cell.width + TAG_GAP) -
      TAG_GAP,
  )

// NOTE: `bottom` is the row just over the head; the tag sits on it.
const nameTagShapes = (
  name: string,
  color: string,
  x: number,
  bottom: number,
): ReadonlyArray<Canvas.Shape> => {
  const cells = tagCellsOf(name)
  if (Array.isReadonlyArrayEmpty(cells)) {
    return []
  }
  const width = tagWidthOf(cells)
  const left = Math.round(x - width / 2)
  const top = Math.round(bottom) - TAG_ROWS - TAG_PAD - 1
  const glyphs = Array.reduce(
    cells,
    { at: left, shapes: Array.empty<Canvas.Shape>() },
    (placed, cell) => ({
      at: placed.at + cell.width + TAG_GAP,
      shapes: Option.match(cell.maybeGlyph, {
        onNone: () => placed.shapes,
        onSome: glyph =>
          Array.append(placed.shapes, placeAt(placed.at, top, glyph.sprite)),
      }),
    }),
  )
  return [
    Canvas.Rect({
      x: left - TAG_PAD,
      y: top - TAG_PAD,
      width: width + TAG_PAD * 2,
      height: TAG_ROWS + TAG_PAD * 2,
      fill: TAG_PLATE,
    }),
    Canvas.Rect({
      x: left - TAG_PAD,
      y: top + TAG_ROWS + TAG_PAD,
      width: width + TAG_PAD * 2,
      height: 1,
      fill: color,
    }),
    ...glyphs.shapes,
  ]
}

// NOTE: the tag's bottom sits a pixel or two over the head, or over the
// revive icon while they are down, and READY stands over the tag.
const NAME_BOTTOM_LIFT_PX = 8
const READY_LIFT_PX = 21

// NOTE: in the world's own pixels, drawn with the players' overheads.
export const coopNameShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (!isOnline(model)) {
    return []
  }
  const names = seatNamesOf(model)
  const ownSlot = leadSeatOf(model).slot
  return Array.flatMap(playersOf(model), ({ slot, seat, player }) =>
    isBledOut(seat)
      ? []
      : [
          ...(slot === ownSlot
            ? []
            : nameTagShapes(
                names.get(slot) ?? `P${slot + 1}`,
                seatColorOf(slot),
                player.x,
                player.y -
                  (isDowned(seat)
                    ? NAME_LIFT_DOWNED_PX
                    : NAME_BOTTOM_LIFT_PX + seatHatRiseOf(model, slot)),
              )),
          ...(isBreak(model) && seat.readiness === 'Ready'
            ? textShapes(
                'READY',
                'Title',
                player.x,
                player.y - READY_LIFT_PX - seatHatRiseOf(model, slot),
                'Center',
              )
            : []),
        ],
  )
}

// EDGE BADGES

const BADGE_PX = 9
const BADGE_EDGE = '#1a0f14'
const EDGE_INSET_PX = 3

const badgeOf = (color: string): ReadonlyArray<Canvas.Shape> =>
  bakeShapes([
    Canvas.Rect({
      x: 1,
      y: 0,
      width: BADGE_PX - 2,
      height: BADGE_PX,
      fill: BADGE_EDGE,
    }),
    Canvas.Rect({
      x: 0,
      y: 1,
      width: BADGE_PX,
      height: BADGE_PX - 2,
      fill: BADGE_EDGE,
    }),
    Canvas.Rect({
      x: 1,
      y: 1,
      width: BADGE_PX - 2,
      height: BADGE_PX - 2,
      fill: color,
    }),
    Canvas.Rect({
      x: 3,
      y: 3,
      width: BADGE_PX - 6,
      height: BADGE_PX - 6,
      fill: BADGE_EDGE,
    }),
  ])

const BADGES: ReadonlyArray<ReadonlyArray<Canvas.Shape>> = Array.map(
  [0, 1, 2, 3],
  slot => badgeOf(seatColorOf(slot)),
)

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

// NOTE: in the overlay canvas's pixels, from the screen camera.
export const coopEdgeShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => {
  if (!isOnline(model)) {
    return []
  }
  const ownSlot = leadSeatOf(model).slot
  const left = camera.left + EDGE_INSET_PX
  const top = camera.top + EDGE_INSET_PX
  const right = camera.left + camera.width * camera.scale - EDGE_INSET_PX
  const bottom = camera.top + camera.height * camera.scale - EDGE_INSET_PX
  return pipe(
    playersOf(model),
    Array.filter(({ slot, seat }) => slot !== ownSlot && !isBledOut(seat)),
    Array.flatMap(({ slot, player }) => {
      const at = worldToView(camera, player)
      const isOnScreen =
        at.x >= left && at.x <= right && at.y >= top && at.y <= bottom
      if (isOnScreen) {
        return []
      }
      const x = Math.round(clamp(at.x, left, right - BADGE_PX))
      const y = Math.round(clamp(at.y, top, bottom - BADGE_PX))
      return [placeAt(x, y, BADGES[slot % BADGES.length] ?? [])]
    }),
  )
}
