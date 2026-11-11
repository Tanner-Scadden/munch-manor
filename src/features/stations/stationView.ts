import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { rect } from '../../render/drawing'
import { doorArrowShapes } from '../../render/powerupView'
import {
  COOLDOWN_RINGS,
  SET_UP_RINGS,
  WORK_RING_RADIUS,
  ringStepOf,
} from '../../render/workRing'
import { TILE_SIZE } from '../../shared/constants'
import type { SoundEffect } from '../../shared/soundEffect'
import { barrelOf } from '../../world/cellar/barrels'
import { puddleOf } from '../../world/kitchen/soupPot'
import { levelOf } from '../../world/level/arena'
import { STACK_IDS, heapBoxOf, isHeapDown } from '../../world/library/stacks'
import { focusOf } from '../../world/party/party'
import type { World } from '../../world/schema/world'
import type { StationId, Vector } from '../../world/schema/worldSchema'
import { type StationView, stationViewsOf } from '../../world/stations/stations'
import {
  TOOL_RULES,
  isToolActive,
  toolActiveMs,
} from '../../world/stations/toolRules'

// The room tools' work stations (src/world/stations/stations.ts) drawn,
// and what each does while it is on. Show, don't explain: each tool is its
// own thing on the floor (the cleat's brass and rope, the gramophone, a
// loose pile at a leaning stack, the bulb's chain, a barrel on its side,
// the soup pot); while a player works one a gold ring fills round it, a
// step away drains it, and once it fires a grey ring refills over its
// cooldown. The first time one waits to be worked in a run, a bobbing arrow
// points at it and its ring pulses, so a player learns to stand at it by
// seeing it. Then the tool shows what it does: notes float off the
// gramophone, books lie heaped across the aisle, a barrel rolls and bursts
// in a splash of wine, soup spreads over the kitchen floor, and dust
// swirls round the shelf.

const HINT_PULSE_MS = 400

// NOTE: the cleat: a brass horn bolted to the wall's inner face, the rope
// running up from it to the ceiling and a coil of it hanging below.
const CLEAT_SPRITE: Sprite = bakeShapes([
  rect(6, -14, 1, 15, '#c9a66b'),
  rect(7, -14, 1, 15, '#8a6a3a'),
  rect(5, -1, 4, 1, '#6a4a1c'),
  rect(4, 0, 6, 2, '#d8b04a'),
  rect(4, 2, 6, 1, '#8a6420'),
  rect(6, 3, 2, 3, '#a8822e'),
  rect(4, 6, 6, 1, '#d8b04a'),
  rect(4, 7, 6, 1, '#8a6420'),
  rect(5, 8, 1, 4, '#c9a66b'),
  rect(8, 8, 1, 5, '#c9a66b'),
  rect(5, 12, 4, 1, '#8a6a3a'),
])

const tile = (
  pixels: ReadonlyArray<string>,
  palette: Readonly<Record<string, string>>,
): Sprite => spriteShapes(pixels, palette, TOP_LEFT)

// NOTE: the gramophone: a wooden box, its turntable, and a brass horn.
const GRAMOPHONE_SPRITE: Sprite = tile(
  [
    '......hhh.',
    '.....hHHHh',
    '....hHddHh',
    '....hHHHh.',
    '...n.hhh..',
    '..n.......',
    '.wwwwwww..',
    '.wbbbbbw..',
    '.wwwwwww..',
    '.ww...ww..',
  ],
  {
    h: '#a8822e',
    H: '#ffd23f',
    d: '#3a2c10',
    n: '#8a6a3a',
    w: '#6a3e1c',
    b: '#2a1a10',
  },
)

// NOTE: a leaning stack's foot: a few fallen books, the push spot.
const BOOKS_SPRITE: Sprite = tile(
  [
    '..........',
    '..........',
    '....rr....',
    '...rRRr...',
    '..gggggg..',
    '..gGGGGg..',
    '.bbbbb....',
    '.bBBBb.yy.',
    '......yYYy',
    '..........',
  ],
  {
    r: '#7a1c1c',
    R: '#b83a2c',
    g: '#1c4a2c',
    G: '#3a7a4a',
    b: '#2a2a5a',
    B: '#4a4a8a',
    y: '#8a6420',
    Y: '#d8b04a',
  },
)

// NOTE: the bulb's pull chain, hanging to a brass bead.
const CHAIN_SPRITE: Sprite = tile(
  [
    '....c.....',
    '....C.....',
    '....c.....',
    '....C.....',
    '....c.....',
    '....C.....',
    '...yYy....',
    '...yYy....',
    '....y.....',
    '..........',
  ],
  { c: '#6a6a72', C: '#a8a8b0', y: '#8a6420', Y: '#ffd23f' },
)

// NOTE: a barrel on its side, ready to roll west; two turns of it roll.
const BARREL_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    '..........',
    '...hhhh...',
    '..hwWwWh..',
    '.hwwWwwWh.',
    '.hWwwWwwh.',
    '.hwWwwWwh.',
    '.hwwWwwWh.',
    '..hWwwWh..',
    '...hhhh...',
    '..........',
  ],
  [
    '..........',
    '...hhhh...',
    '..hWwwWh..',
    '.hwWwwWwh.',
    '.hwwWwwWh.',
    '.hWwwWwwh.',
    '.hwWwwWwh.',
    '..hwWwWh..',
    '...hhhh...',
    '..........',
  ],
]
const BARREL_PALETTE = { h: '#3a3a40', w: '#7a4a24', W: '#a86a34' }
const BARREL_FRAMES = Array.map(BARREL_ROWS, rows => tile(rows, BARREL_PALETTE))
const BARREL_SPRITE: Sprite = Option.getOrElse(
  Array.head(BARREL_FRAMES),
  () => [],
)

// NOTE: the soup pot: an iron pot full of green soup, a ladle in it.
const POT_SPRITE: Sprite = tile(
  [
    '......l...',
    '.....l....',
    '.kkkklkkk.',
    'kgGgglgGgk',
    'kGggGggGgk',
    '.kKKKKKKk.',
    '.kKKKKKKk.',
    '.kKKKKKKk.',
    '..kkkkkk..',
    '..k....k..',
  ],
  { k: '#25252c', K: '#4a4a52', g: '#5a8a2c', G: '#8ac84a', l: '#a8a8b0' },
)

const STATION_SPRITES: Readonly<Record<StationId, Option.Option<Sprite>>> = {
  Cleat: Option.some(CLEAT_SPRITE),
  Gramophone: Option.some(GRAMOPHONE_SPRITE),
  NorthStack: Option.some(BOOKS_SPRITE),
  SouthStack: Option.some(BOOKS_SPRITE),
  // NOTE: the shelf is the secret shelf's own art, its glinting red book.
  Shelf: Option.none(),
  Bulb: Option.some(CHAIN_SPRITE),
  Barrels: Option.some(BARREL_SPRITE),
  SoupPot: Option.some(POT_SPRITE),
}

// NOTE: what a station sounds as it fires (src/app/update/sound.ts).
export const STATION_SOUNDS: Readonly<Record<StationId, SoundEffect>> = {
  Cleat: 'Yank',
  Gramophone: 'Waltz',
  NorthStack: 'Crash',
  SouthStack: 'Crash',
  Shelf: 'Whoosh',
  Bulb: 'Yank',
  Barrels: 'Rumble',
  SoupPot: 'Splosh',
}

// NOTE: a music note, floating up off the playing gramophone.
const NOTE_SPRITE: Sprite = tile(['..nn', '..nN', '..n.', 'nnn.', 'nnn.'], {
  n: '#ffd23f',
  N: '#fff1a8',
})
const NOTE_COUNT = 3
const NOTE_RISE_MS = 1800
const NOTE_RISE_PX = 18

// NOTE: one tile of the toppled books, laid over each tile of a heap.
const HEAP_SPRITE: Sprite = tile(
  [
    'rrRRr.gggG',
    'rRRRrggGGg',
    'bbbbBBgGGg',
    'bBBBBbyyyY',
    '.yyYYyyYYy',
    'gGGgrrrRRr',
    'gGGgrRRRRr',
    'bbbBBBbyyy',
    'bBBBBBbyYY',
    '.rrrRRRr..',
  ],
  {
    r: '#7a1c1c',
    R: '#b83a2c',
    g: '#1c4a2c',
    G: '#3a7a4a',
    b: '#2a2a5a',
    B: '#4a4a8a',
    y: '#8a6420',
    Y: '#d8b04a',
  },
)

// NOTE: the barrel burst on the far wall: staves and a splash of old wine.
const BURST_SPRITE: Sprite = tile(
  [
    '...ww.....',
    '.v...w..v.',
    '..vvVvv...',
    '.vVVvvVvv.',
    'vvVvwvvVv.',
    '.vvVVvwvv.',
    '..vvvVv.w.',
    '.w..vv....',
  ],
  { w: '#7a4a24', v: '#4a1030', V: '#7a2050' },
)

// NOTE: the soup pot's spill: a round green puddle, baked once.
const PUDDLE_RADIUS = TOOL_RULES.SoupPot.radiusPx
const PUDDLE_SPRITE: Sprite = bakeShapes(
  Array.flatMap(
    Array.makeBy(PUDDLE_RADIUS * 2, row => row - PUDDLE_RADIUS + 0.5),
    dy => {
      const half = Math.floor(Math.sqrt(PUDDLE_RADIUS ** 2 - dy ** 2))
      const y = Math.floor(dy)
      return [
        rect(-half, y, half * 2, 1, '#4a7a24'),
        ...(Math.abs(dy) < PUDDLE_RADIUS - 3
          ? [rect(-half + 2, y, Math.max(0, half * 2 - 4), 1, '#6aa834')]
          : []),
      ]
    },
  ),
)
const PUDDLE_SHINE: Sprite = bakeShapes([
  rect(-8, -6, 4, 1, '#b8e87a'),
  rect(3, 2, 3, 1, '#b8e87a'),
  rect(-2, 8, 2, 1, '#b8e87a'),
])
const SHINE_MS = 500

// NOTE: the shelf's spin: dust swirling round it while it turns.
const DUST_COUNT = 8
const DUST_SWIRL_PX = 14

const HALF_TILE = 5

// NOTE: a station waiting for its first work in a run.
const isNew = (station: StationView): boolean =>
  station.isWorkable &&
  station.timesWorked === 0 &&
  station.setUp === 0 &&
  station.cooldown === 0

const ringShapes = (
  station: StationView,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(station.center.x)
  const y = Math.round(station.center.y)
  if (station.setUp > 0) {
    return [placeAt(x, y, ringStepOf(SET_UP_RINGS, station.setUp))]
  }
  if (station.cooldown > 0) {
    return [placeAt(x, y, ringStepOf(COOLDOWN_RINGS, 1 - station.cooldown))]
  }
  if (!station.isWorkable || station.timesWorked > 0) {
    return []
  }
  const isLit = Math.floor(elapsedMs / HINT_PULSE_MS) % 2 === 0
  return [
    placeAt(
      x,
      y,
      isLit
        ? Array.lastNonEmpty(SET_UP_RINGS)
        : Array.headNonEmpty(SET_UP_RINGS),
    ),
  ]
}

// NOTE: the bobbing arrow, over only the new station nearest the viewing
// player, so two new tools in one room point one way at a time.
const arrowShapes = (
  world: World,
  stations: ReadonlyArray<StationView>,
): ReadonlyArray<Canvas.Shape> => {
  const { x, y } = focusOf(world).player
  return Option.match(
    Array.reduce(
      Array.filter(stations, isNew),
      Option.none<StationView>(),
      (nearest, station) =>
        Option.isSome(nearest) &&
        Math.hypot(nearest.value.center.x - x, nearest.value.center.y - y) <=
          Math.hypot(station.center.x - x, station.center.y - y)
          ? nearest
          : Option.some(station),
    ),
    {
      onNone: () => [],
      onSome: ({ center }) =>
        doorArrowShapes(
          {
            x: Math.round(center.x),
            y: Math.round(center.y) - WORK_RING_RADIUS,
          },
          world.elapsedMs,
        ),
    },
  )
}

type Shown = (point: Vector) => boolean

// NOTE: only the stations on the camera are drawn.
const shownStations = (
  world: World,
  isShown: Shown,
): ReadonlyArray<StationView> =>
  Array.filter(stationViewsOf(world), ({ center }) => isShown(center))

const notesShapes = (
  world: World,
  station: StationView,
): ReadonlyArray<Canvas.Shape> =>
  isToolActive(world, station.id)
    ? Array.makeBy(NOTE_COUNT, index => {
        const rise =
          ((toolActiveMs(world, station.id) +
            (index * NOTE_RISE_MS) / NOTE_COUNT) %
            NOTE_RISE_MS) /
          NOTE_RISE_MS
        return placeAt(
          Math.round(station.center.x + Math.sin(rise * 6 + index) * 4),
          Math.round(station.center.y - 8 - rise * NOTE_RISE_PX),
          NOTE_SPRITE,
        )
      })
    : []

const dustShapes = (
  world: World,
  station: StationView,
): ReadonlyArray<Canvas.Shape> =>
  isToolActive(world, station.id)
    ? Array.makeBy(DUST_COUNT, index => {
        const share =
          toolActiveMs(world, station.id) / TOOL_RULES.Shelf.activeMs
        const angle = share * Math.PI * 4 + (index * Math.PI * 2) / DUST_COUNT
        const radius = DUST_SWIRL_PX * (0.5 + share)
        return rect(
          Math.round(station.center.x + Math.cos(angle) * radius),
          Math.round(station.center.y + Math.sin(angle) * radius * 0.6),
          2,
          2,
          index % 2 === 0 ? '#c8b89a' : '#8a7a62',
        )
      })
    : []

// NOTE: what a tool shows over everything while it is on.
const toolOverheadShapes = (
  world: World,
  station: StationView,
): ReadonlyArray<Canvas.Shape> =>
  station.id === 'Gramophone'
    ? notesShapes(world, station)
    : station.id === 'Shelf'
      ? dustShapes(world, station)
      : []

const heapShapes = (world: World): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(STACK_IDS, id =>
    isHeapDown(world, id)
      ? Option.match(heapBoxOf(levelOf(world), id), {
          onNone: () => [],
          onSome: box =>
            Array.flatMap(
              Array.makeBy((box.bottom - box.top) / TILE_SIZE, row => row),
              row =>
                Array.makeBy((box.right - box.left) / TILE_SIZE, column =>
                  placeAt(
                    box.left + column * TILE_SIZE,
                    box.top + row * TILE_SIZE,
                    HEAP_SPRITE,
                  ),
                ),
            ),
        })
      : [],
  )

const puddleShapes = (world: World): ReadonlyArray<Canvas.Shape> =>
  Option.match(puddleOf(world), {
    onNone: () => [],
    onSome: ({ x, y }) => [
      placeAt(Math.round(x), Math.round(y), PUDDLE_SPRITE),
      ...(Math.floor(world.elapsedMs / SHINE_MS) % 2 === 0
        ? [placeAt(Math.round(x), Math.round(y), PUDDLE_SHINE)]
        : []),
    ],
  })

// NOTE: the barrel stands on its lane, its foot on the line, so the wine
// racks' tops south of the corridor never hide it as it rolls past.
const rollingBarrelShapes = (world: World): ReadonlyArray<Canvas.Shape> =>
  Option.match(barrelOf(world), {
    onNone: () => [],
    onSome: ({ x, y, isBroken }) => [
      placeAt(
        Math.round(x) - HALF_TILE,
        Math.round(y) - TILE_SIZE,
        isBroken
          ? BURST_SPRITE
          : Option.getOrElse(
              Array.get(
                BARREL_FRAMES,
                Math.floor(x / 4) % BARREL_FRAMES.length,
              ),
              () => BARREL_SPRITE,
            ),
      ),
    ],
  })

// NOTE: on the ground layer, over the room's walls: each station's art,
// the spilled soup and the toppled books under it, the rolling barrel.
export const stationGroundShapes: {
  (isShown: Shown): (world: World) => ReadonlyArray<Canvas.Shape>
  (world: World, isShown: Shown): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (world: World, isShown: Shown): ReadonlyArray<Canvas.Shape> => [
    ...puddleShapes(world),
    ...heapShapes(world),
    ...Array.flatMap(shownStations(world, isShown), ({ id, center }) =>
      Option.match(STATION_SPRITES[id], {
        onNone: () => [],
        onSome: sprite => [
          placeAt(
            Math.round(center.x) - HALF_TILE,
            Math.round(center.y) - HALF_TILE,
            sprite,
          ),
        ],
      }),
    ),
    ...rollingBarrelShapes(world),
  ],
)

// NOTE: over everything: a tool's notes or dust while it is on, and a
// station's set-up or cooldown ring, or its first time hint.
export const stationOverheadShapes: {
  (isShown: Shown): (world: World) => ReadonlyArray<Canvas.Shape>
  (world: World, isShown: Shown): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (world: World, isShown: Shown): ReadonlyArray<Canvas.Shape> => {
    const stations = shownStations(world, isShown)
    return [
      ...Array.flatMap(stations, station => [
        ...toolOverheadShapes(world, station),
        ...ringShapes(station, world.elapsedMs),
      ]),
      ...arrowShapes(world, stations),
    ]
  },
)
