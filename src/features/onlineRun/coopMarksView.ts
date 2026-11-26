import { Array, Function, Option, Record, pipe } from 'effect'

import type { Model } from '../../app/model'
import { textShapes } from '../../art/font'
import { TOP_LEFT, placeAt, spriteShapes } from '../../art/sprite'
import { isBotCrew, maybeCrewBotAt } from '../../domain/bots'
import { maybeRoomOf } from '../../domain/coopRoom'
import { seatNamesOf } from '../../domain/onlineRun'
import { type Camera, worldToView } from '../../render/camera'
import * as Draw from '../../render/draw'
import {
  EDGE_BADGE_INK,
  EDGE_BADGE_PX,
  edgeBadgeOf,
} from '../../render/edgeBadge'
import {
  NAME_LIFT_CALLING_PX,
  NAME_LIFT_DOWNED_PX,
  seatColorOf,
  seatHatRiseOf,
} from '../../render/partyView'
import type { Calling } from '../../shared/playerData'
import { isCallFresh } from '../../world/party/medic'
import {
  isBledOut,
  isCoop,
  isDowned,
  isOut,
  leadSeatOf,
  playersOf,
} from '../../world/party/party'
import type { Seat } from '../../world/schema/worldSchema'
import { isBreak } from '../../world/waves/waves'

const isOnline = (model: Model): boolean =>
  isCoop(model) && (Option.isSome(maybeRoomOf(model.coop)) || isBotCrew(model))

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

type TagGlyph = Readonly<{ width: number; sprite: ReadonlyArray<Draw.Shape> }>

const TAG_GLYPHS: ReadonlyMap<string, TagGlyph> = new Map(
  Array.map(Record.toEntries(TAG_PIXELS), ([symbol, pixels]) => [
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

type TagIcon = Readonly<{ width: number; sprite: ReadonlyArray<Draw.Shape> }>

const tagIconOf = (pixels: ReadonlyArray<string>): TagIcon => ({
  width: Array.reduce(pixels, 0, (widest, row) => Math.max(widest, row.length)),
  sprite: spriteShapes(
    pixels,
    {
      s: '#d3d8e2',
      t: '#c99a5b',
      o: '#f08a24',
      w: '#f4f1de',
      y: '#f2c230',
      z: '#b8861c',
      e: '#8d93a3',
    },
    TOP_LEFT,
  ),
})

const TAG_ICONS: Readonly<Record<Calling, Option.Option<TagIcon>>> = {
  You: Option.none(),
  Handyman: Option.some(tagIconOf(['.sss.', '.sss.', '..t..', '..t..'])),
  TrackStar: Option.some(tagIconOf(['.oo..', '.ooo.', 'ooooo', 'wwwww'])),
  PennyPincher: Option.some(tagIconOf(['.yy.', 'yzzy', 'yzzy', '.yy.'])),
  LineCook: Option.some(tagIconOf(['..t..', '..t..', '.eee.', '.eee.'])),
}

const BOT_TAG_ICON: TagIcon = {
  width: 5,
  sprite: spriteShapes(
    ['..y..', 'sssss', 'ststs', 'sssss'],
    { s: '#d3d8e2', t: '#5fd4c8', y: '#f2c230' },
    TOP_LEFT,
  ),
}

const tagWidthOf = (cells: ReadonlyArray<TagCell>): number =>
  Math.max(
    0,
    Array.reduce(cells, 0, (total, cell) => total + cell.width + TAG_GAP) -
      TAG_GAP,
  )

const nameTagShapes = (
  name: string,
  color: string,
  x: number,
  bottom: number,
  calling: Calling,
  isBot: boolean,
): ReadonlyArray<Draw.Shape> => {
  const cells = tagCellsOf(name)
  if (Array.isReadonlyArrayEmpty(cells)) {
    return []
  }
  const icons = [
    ...(isBot ? [BOT_TAG_ICON] : []),
    ...Option.match(TAG_ICONS[calling], {
      onNone: () => [],
      onSome: found => [found],
    }),
  ]
  const iconSpan = Array.reduce(
    icons,
    Array.isReadonlyArrayEmpty(icons) ? 0 : 1,
    (span, icon) => span + icon.width + TAG_GAP,
  )
  const width = tagWidthOf(cells) + iconSpan
  const left = Math.round(x - width / 2)
  const top = Math.round(bottom) - TAG_ROWS - TAG_PAD - 1
  const icon: Array<Draw.Shape> = []
  let iconAt = left
  for (const found of icons) {
    icon.push(placeAt(iconAt, top, found.sprite))
    iconAt += found.width + TAG_GAP
  }
  const glyphs = Array.reduce(
    cells,
    { at: left + iconSpan, shapes: Array.empty<Draw.Shape>() },
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
    Draw.Rect({
      x: left - TAG_PAD,
      y: top - TAG_PAD,
      width: width + TAG_PAD * 2,
      height: TAG_ROWS + TAG_PAD * 2,
      fill: TAG_PLATE,
    }),
    Draw.Rect({
      x: left - TAG_PAD,
      y: top + TAG_ROWS + TAG_PAD,
      width: width + TAG_PAD * 2,
      height: 1,
      fill: color,
    }),
    ...icon,
    ...glyphs.shapes,
  ]
}

const NAME_BOTTOM_LIFT_PX = 8
const READY_LIFT_PX = 21

const nameLiftOf = (model: Model, slot: number, seat: Seat): number => {
  if (isOut(seat)) {
    return NAME_BOTTOM_LIFT_PX
  }
  if (isCallFresh(seat)) {
    return NAME_LIFT_CALLING_PX
  }
  return isDowned(seat)
    ? NAME_LIFT_DOWNED_PX
    : NAME_BOTTOM_LIFT_PX + seatHatRiseOf(model, slot)
}

export const coopNameShapes = (model: Model): ReadonlyArray<Draw.Shape> => {
  if (!isOnline(model)) {
    return []
  }
  const names = seatNamesOf(model)
  const ownSlot = leadSeatOf(model).slot
  return Array.flatMap(playersOf(model), ({ seat: { slot }, seat, player }) =>
    isBledOut(seat)
      ? []
      : [
          ...(slot === ownSlot
            ? []
            : nameTagShapes(
                names.get(slot) ?? `P${slot + 1}`,
                seatColorOf(slot),
                player.x,
                player.y - nameLiftOf(model, slot, seat),
                player.calling,
                Option.isSome(maybeCrewBotAt(model, slot)),
              )),
          ...(isOut(seat) || (isBreak(model) && seat.readiness === 'Ready')
            ? textShapes(
                isOut(seat) ? 'OUT' : 'READY',
                'Title',
                player.x,
                player.y - READY_LIFT_PX - seatHatRiseOf(model, slot),
                'Center',
              )
            : []),
        ],
  )
}

const EDGE_INSET_PX = 3

const BADGES: ReadonlyArray<ReadonlyArray<Draw.Shape>> = Array.map(
  [0, 1, 2, 3],
  slot => edgeBadgeOf(seatColorOf(slot)),
)

const CALL_FLASH_MS = 120
const CALL_GLOW_PX = 2

const CALLING_BADGE: ReadonlyArray<Draw.Shape> = spriteShapes(
  [
    '..ggggggggg..',
    '.ggggggggggg.',
    'gg.ooooooo.gg',
    'ggowwwwwwwogg',
    'ggowwwrwwwogg',
    'ggowwwrwwwogg',
    'ggowrrrrrwogg',
    'ggowwwrwwwogg',
    'ggowwwrwwwogg',
    'ggowwwwwwwogg',
    'gg.ooooooo.gg',
    '.ggggggggggg.',
    '..ggggggggg..',
  ],
  {
    g: 'rgba(255, 244, 214, 0.55)',
    o: EDGE_BADGE_INK,
    w: '#f4f1de',
    r: '#e8343a',
  },
  TOP_LEFT,
)

const badgeShapeOf = (
  x: number,
  y: number,
  slot: number,
  isCalling: boolean,
  elapsedMs: number,
): Draw.Shape =>
  isCalling && Math.floor(elapsedMs / CALL_FLASH_MS) % 2 === 0
    ? placeAt(x - CALL_GLOW_PX, y - CALL_GLOW_PX, CALLING_BADGE)
    : placeAt(x, y, BADGES[slot % BADGES.length] ?? [])

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

export const coopEdgeShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> => {
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
      Array.filter(
        ({ seat: { slot }, seat }) => slot !== ownSlot && !isBledOut(seat),
      ),
      Array.flatMap(({ seat: { slot }, seat, player }) => {
        const at = worldToView(camera, player)
        const isOnScreen =
          at.x >= left && at.x <= right && at.y >= top && at.y <= bottom
        if (isOnScreen) {
          return []
        }
        const x = Math.round(clamp(at.x, left, right - EDGE_BADGE_PX))
        const y = Math.round(clamp(at.y, top, bottom - EDGE_BADGE_PX))
        return [badgeShapeOf(x, y, slot, isCallFresh(seat), model.elapsedMs)]
      }),
    )
  },
)
