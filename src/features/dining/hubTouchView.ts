import { Array, Function, Option, Record, Result } from 'effect'

import type { Model } from '#app/model.ts'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  deepSprite,
  glowingSprite,
  placeAt,
  spriteShapes,
} from '#art/sprite.ts'
import { type Drawable, ON_FRONT_PX } from '#render/depth.ts'
import { rect } from '#render/drawing.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import { type Level, type Room, levelOf } from '#world/level/arena.ts'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  type LevelSpec,
  PARLOUR_ROOM_ID,
} from '#world/level/plan.ts'
import type { Vector } from '#world/schema/worldSchema.ts'
import { stationCenterOf } from '#world/stations/stationSpots.ts'
import { distanceBetween } from '#world/step/geometry.ts'

const SIDEBOARD_FOOT_Y = 3 * TILE_SIZE
const HATCH_SPOT = { x: 155, y: 19, footY: SIDEBOARD_FOOT_Y + ON_FRONT_PX }
const BOOKS_HEIGHT = 11
const BOOKS_SPOT = {
  x: 233,
  y: SIDEBOARD_FOOT_Y - BOOKS_HEIGHT,
  footY: SIDEBOARD_FOOT_Y,
}
const COBWEB_SPOT = { x: 35 * TILE_SIZE, y: 11, footY: 33 }
const WEST_BOARDS = { column: 1, row: 13 }
const EAST_BOARDS = { column: 35, row: 9 }

const NOTE_EVERY_MS = 1800
const NOTE_PX_PER_MS = 0.024
const NOTE_LIFT_PX = 13
const NOTE_BOB_PX = 3
const NOTE_SWAY_PX = 2.5
const NOTE_FADE_IN_PX = 14
const NOTE_FADE_OUT_PX = 26
const NOTE_HEIGHT = 8
const NOTE_HALF_WIDTH = 3
const MOTE_CYCLE_MS = 5200
const MOTE_DRIFT_PX = 46
const MOTE_LIFT_PX = 8

const pointOf = (
  dining: Vector,
  tile: Readonly<{ column: number; row: number }>,
): Vector => ({
  x: dining.x + tile.column * TILE_SIZE,
  y: dining.y + tile.row * TILE_SIZE,
})

const HATCH: Sprite = deepSprite(
  bakeShapes([
    rect(0, 1, 8, 8, '#3e2210'),
    rect(1, 2, 6, 6, '#120a05'),
    rect(1, 2, 6, 1, '#b8b8c0'),
    rect(1, 3, 6, 1, '#6a6a74'),
    rect(3, 0, 2, 1, '#d8b04a'),
    rect(8, 1, 1, 8, '#c9a66b'),
  ]),
  { most: 1, isUpright: true },
)

const PAGES_COLOR = '#efe2c0'

const BOOKS: Sprite = deepSprite(
  bakeShapes([
    rect(0, 9, 8, 2, '#3f6b3a'),
    rect(0, 9, 1, 2, PAGES_COLOR),
    rect(1, 7, 7, 2, '#a8322c'),
    rect(7, 7, 1, 2, PAGES_COLOR),
    rect(0, 5, 7, 2, '#34507a'),
    rect(6, 5, 1, 2, PAGES_COLOR),
    rect(1, 3, 6, 2, '#7a5226'),
    rect(1, 3, 1, 2, PAGES_COLOR),
  ]),
  { most: 5, isBox: true },
)

const WEB_COLOR = '#c8c8d4'
const WEB_DIM_COLOR = '#8e8e9c'

const COBWEB: Sprite = deepSprite(
  bakeShapes([
    rect(-1, 0, 1, 7, WEB_COLOR),
    rect(-7, 0, 7, 1, WEB_COLOR),
    rect(-2, 1, 1, 1, WEB_COLOR),
    rect(-3, 2, 1, 1, WEB_DIM_COLOR),
    rect(-4, 3, 1, 1, WEB_DIM_COLOR),
    rect(-5, 1, 1, 1, WEB_DIM_COLOR),
    rect(-1, 4, 1, 1, WEB_DIM_COLOR),
    rect(-4, 1, 3, 1, WEB_DIM_COLOR),
    rect(-1, 1, 1, 3, WEB_DIM_COLOR),
  ]),
  { most: 1 },
)

const EIGHTH_NOTE = [
  '...G..',
  '...GGG',
  '...G.G',
  '...G.G',
  '...G..',
  '.LGG..',
  'GGGG..',
  'GGG...',
]
const QUARTER_NOTE = [
  '...G',
  '...G',
  '...G',
  '...G',
  '...G',
  '.LGG',
  'GGGG',
  'GGG.',
]

const notesIn = (
  palette: Readonly<Record<'G' | 'L', string>>,
): Array.NonEmptyReadonlyArray<Sprite> =>
  Array.map(Array.make(EIGHTH_NOTE, QUARTER_NOTE), pixels =>
    glowingSprite(
      deepSprite(spriteShapes(pixels, palette, TOP_LEFT), { most: 1 }),
    ),
  )

const NOTES = notesIn({ G: '#ffe680', L: '#fff8d6' })
const NOTES_DIM = notesIn({ G: '#b39c50', L: '#c9bc8a' })
const NOTES_FAINT = notesIn({ G: '#6e6034', L: '#7c7254' })

const MOTE_COLOR = '#c4ccd8'

const MOTES: Sprite = deepSprite(
  bakeShapes([
    rect(0, 0, 1, 1, MOTE_COLOR),
    rect(-6, 3, 1, 1, MOTE_COLOR),
    rect(-12, 7, 1, 1, MOTE_COLOR),
    rect(-17, 2, 1, 1, MOTE_COLOR),
  ]),
  { most: 1 },
)

const MOTES_WEST: Sprite = deepSprite(
  bakeShapes([
    rect(0, 0, 1, 1, MOTE_COLOR),
    rect(6, 3, 1, 1, MOTE_COLOR),
    rect(12, 7, 1, 1, MOTE_COLOR),
    rect(17, 2, 1, 1, MOTE_COLOR),
  ]),
  { most: 1 },
)

const maybeRoom = (level: Level, id: string) =>
  Array.findFirst(level.rooms, room => room.id === id)

const isOpen = (level: Level, id: string): boolean =>
  Option.exists(maybeRoom(level, id), room => room.isOpen)

const sideOf = (level: Level, id: string, dining: Vector): Vector =>
  pointOf(
    dining,
    Option.exists(maybeRoom(level, id), room => room.box.left < dining.x)
      ? WEST_BOARDS
      : EAST_BOARDS,
  )

const inwardOf = (side: Vector, dining: Vector): number =>
  side.x < dining.x + 18 * TILE_SIZE ? 1 : -1

const fixedAt = (
  dining: Vector,
  spot: Readonly<{ x: number; y: number; footY: number }>,
  sprite: Sprite,
): Drawable => ({
  footY: dining.y + spot.footY,
  rank: 'Prop',
  shapes: [placeAt(dining.x + spot.x, dining.y + spot.y, sprite)],
})

type Leg = ReadonlyArray<Vector>

const PARLOUR_TO_EAST: Leg = [
  { x: 15, y: 8.4 },
  { x: 25.5, y: 9 },
  { x: 32, y: 9 },
]
const PARLOUR_TO_WEST: Leg = [
  { x: 8.5, y: 8.6 },
  { x: 6, y: 9 },
  { x: 0, y: 9 },
]
const CROSSINGS: Readonly<Record<string, Leg>> = {
  [LIBRARY_ROOM_ID]: [{ x: 0, y: 9 }],
  [CELLAR_ROOM_ID]: [
    { x: 23.5, y: 8.8 },
    { x: 22.5, y: 7.1 },
    { x: 17.2, y: 7.1 },
    { x: 15.5, y: 8.8 },
    { x: 0, y: 9 },
  ],
}
const INTO_DINING_FROM_WEST: Leg = [{ x: 5.5, y: 12.6 }]
const INTO_DINING_FROM_EAST: Leg = [{ x: 30.5, y: 9 }]

type Segment = Readonly<{
  from: Vector
  to: Vector
  start: number
  length: number
}>

export type NoteRoute = Readonly<{
  segments: ReadonlyArray<Segment>
  length: number
}>

const inRoom = (room: Room, leg: Leg): ReadonlyArray<Vector> =>
  Array.map(leg, ({ x, y }) => ({
    x: room.box.left + x * TILE_SIZE,
    y: room.box.top + y * TILE_SIZE,
  }))

const pointsAfterGramophone = (
  level: Level,
  parlour: Room,
  dining: Room,
): Option.Option<ReadonlyArray<Vector>> =>
  parlour.box.right <= dining.box.left
    ? Option.some([
        ...inRoom(parlour, PARLOUR_TO_EAST),
        ...inRoom(dining, INTO_DINING_FROM_WEST),
      ])
    : parlour.box.left === dining.box.right
      ? Option.some([
          ...inRoom(parlour, PARLOUR_TO_WEST),
          ...inRoom(dining, INTO_DINING_FROM_EAST),
        ])
      : Option.flatMap(
          Array.findFirst(
            level.rooms,
            room => room.box.left === dining.box.right,
          ),
          between =>
            Option.map(Record.get(CROSSINGS, between.id), crossing => [
              ...inRoom(parlour, PARLOUR_TO_WEST),
              ...inRoom(between, crossing),
              ...inRoom(dining, INTO_DINING_FROM_EAST),
            ]),
        )

const routeThrough = (
  first: Vector,
  rest: ReadonlyArray<Vector>,
): NoteRoute => {
  const pairs = Array.zip([first, ...rest], rest)
  const starts = Array.scan(
    pairs,
    0,
    (total, [from, to]) => total + distanceBetween(from, to),
  )
  const segments = Array.filterMap(
    Array.zip(pairs, starts),
    ([[from, to], start]) => {
      const length = distanceBetween(from, to)
      return length > 0
        ? Result.succeed({ from, to, start, length })
        : Result.failVoid
    },
  )
  return { segments, length: Array.lastNonEmpty(starts) }
}

const routes = new WeakMap<LevelSpec, Option.Option<NoteRoute>>()

export const noteRouteOf = (level: Level): Option.Option<NoteRoute> => {
  const cached = routes.get(level.spec)
  if (cached !== undefined) {
    return cached
  }
  const route = Option.flatMap(
    Option.all({
      gramophone: stationCenterOf(level, 'Gramophone'),
      parlour: maybeRoom(level, PARLOUR_ROOM_ID),
      dining: maybeRoom(level, DINING_ROOM_ID),
    }),
    ({ gramophone, parlour, dining }) =>
      Option.map(pointsAfterGramophone(level, parlour, dining), rest =>
        routeThrough(gramophone, rest),
      ),
  )
  routes.set(level.spec, route)
  return route
}

const noteAlong = (
  route: NoteRoute,
  along: number,
  beat: number,
): Option.Option<Readonly<{ x: number; y: number; lift: number }>> =>
  Option.map(
    Array.findFirst(
      route.segments,
      ({ start, length }) => along >= 0 && along < start + length,
    ),
    ({ from, to, start, length }) => {
      const share = (along - start) / length
      const acrossX = (from.y - to.y) / length
      const acrossY = (to.x - from.x) / length
      const sway = Math.sin(along / 19 + beat * 2.1) * NOTE_SWAY_PX
      return {
        x: from.x + (to.x - from.x) * share + acrossX * sway,
        y: from.y + (to.y - from.y) * share + acrossY * sway,
        lift: NOTE_LIFT_PX + Math.sin(along / 13 + beat) * NOTE_BOB_PX,
      }
    },
  )

const notesFor = (
  route: NoteRoute,
  along: number,
): Array.NonEmptyReadonlyArray<Sprite> => {
  const toGo = route.length - along
  return along < NOTE_FADE_IN_PX / 2 || toGo < NOTE_FADE_OUT_PX / 2
    ? NOTES_FAINT
    : along < NOTE_FADE_IN_PX || toGo < NOTE_FADE_OUT_PX
      ? NOTES_DIM
      : NOTES
}

const noteDrawables = (
  route: NoteRoute,
  elapsedMs: number,
  isShown: Shown,
): ReadonlyArray<Drawable> => {
  const latest = Math.floor(elapsedMs / NOTE_EVERY_MS)
  const onTheWay =
    Math.ceil(route.length / (NOTE_EVERY_MS * NOTE_PX_PER_MS)) + 1
  return Array.filterMap(
    Array.makeBy(onTheWay, back => latest - back),
    beat => {
      const along = (elapsedMs - beat * NOTE_EVERY_MS) * NOTE_PX_PER_MS
      return Option.match(
        Option.flatMap(
          Option.filter(noteAlong(route, along, beat), isShown),
          at =>
            Option.map(
              Array.get(notesFor(route, along), Math.abs(beat) % 2),
              (note): Drawable => {
                const footY = Math.round(at.y)
                return {
                  footY,
                  rank: 'Prop',
                  shapes: [
                    placeAt(
                      Math.round(at.x) - NOTE_HALF_WIDTH,
                      footY - Math.round(at.lift) - NOTE_HEIGHT,
                      note,
                    ),
                  ],
                }
              },
            ),
        ),
        { onNone: () => Result.failVoid, onSome: Result.succeed },
      )
    },
  )
}

const moteDrawables = (
  side: Vector,
  inward: number,
  elapsedMs: number,
): ReadonlyArray<Drawable> => {
  const phase = (elapsedMs % MOTE_CYCLE_MS) / MOTE_CYCLE_MS
  return [
    {
      footY: side.y + 6,
      rank: 'Prop',
      shapes: [
        placeAt(
          Math.round(side.x + inward * phase * MOTE_DRIFT_PX),
          Math.round(side.y + 6 - MOTE_LIFT_PX + Math.sin(phase * 7) * 2),
          inward > 0 ? MOTES : MOTES_WEST,
        ),
      ],
    },
  ]
}

type Shown = (point: Vector) => boolean

export const hubTouchDrawables: {
  (isShown: Shown): (model: Model) => ReadonlyArray<Drawable>
  (model: Model, isShown: Shown): ReadonlyArray<Drawable>
} = Function.dual(
  2,
  (model: Model, isShown: Shown): ReadonlyArray<Drawable> => {
    const level = levelOf(model)
    return Option.match(maybeRoom(level, DINING_ROOM_ID), {
      onNone: () => [],
      onSome: ({ box }) => {
        const dining = { x: box.left, y: box.top }
        const cellarSide = sideOf(level, CELLAR_ROOM_ID, dining)
        return [
          ...(isOpen(level, KITCHEN_ROOM_ID)
            ? [fixedAt(dining, HATCH_SPOT, HATCH)]
            : []),
          ...(isOpen(level, LIBRARY_ROOM_ID)
            ? [fixedAt(dining, BOOKS_SPOT, BOOKS)]
            : []),
          ...(isOpen(level, PARLOUR_ROOM_ID)
            ? Option.match(noteRouteOf(level), {
                onNone: () => [],
                onSome: route => noteDrawables(route, model.elapsedMs, isShown),
              })
            : []),
          ...(isOpen(level, CELLAR_ROOM_ID)
            ? [
                fixedAt(dining, COBWEB_SPOT, COBWEB),
                ...moteDrawables(
                  cellarSide,
                  inwardOf(cellarSide, dining),
                  model.elapsedMs,
                ),
              ]
            : []),
        ]
      },
    })
  },
)
