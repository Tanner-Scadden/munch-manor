import { Array, Function, Option, String } from 'effect'
import type { Canvas } from 'foldkit'

import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  deepSprite,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import type { Drawable } from '../../render/depth'
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
import { isChandelierDown } from '../../world/dining/chandelier'
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
// own thing on the floor (the chandelier's winch and rope, the gramophone, a
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

const tile = (
  pixels: ReadonlyArray<string>,
  palette: Readonly<Record<string, string>>,
): Sprite => spriteShapes(pixels, palette, TOP_LEFT)

// NOTE: the chandelier's winch, the cleat (owner, 2026-11-15: its old
// brass horn stood inside the west wall, where the 3D wall hid it): an oak
// post against the wall's face, an iron arm out to a brass pulley, the rope
// running up through it to the ceiling, and a drum with a crank on an iron
// foot. Hung, the drum is wound full and the rope stands straight and taut;
// dropped, the drum is bare and the rope hangs in loose loops to a coil on
// the floor. The crank turns while the winch is worked.
const CLEAT_PALETTE = {
  p: '#24140a',
  P: '#6a4422',
  i: '#16161c',
  I: '#5a5a66',
  g: '#8a6420',
  G: '#d8a838',
  Y: '#fff0a0',
  r: '#6a4a24',
  R: '#f4dca8',
  w: '#3a2412',
  W: '#6a4426',
}

const CLEAT_TAUT_ROWS: ReadonlyArray<string> = [
  '......Rr..',
  '......rR..',
  '......Rr..',
  '......rR..',
  '......Rr..',
  '......rR..',
  'pp...iYGi.',
  'pPiiiYRrGi',
  'pP..iGrRgi',
  'pP...igg..',
  'pP....Rr..',
  'pP....rR..',
  'pP....Rr..',
  'pP....rR..',
  'pP....Rr..',
  'pP.iYGrRYi',
  'pPiYRRRRRG',
  'pPiGrrrrrg',
  'pPiYRRRRRG',
  'pPiGrrrrrg',
  'pPiYRRRRRG',
  'pPiGrrrrrg',
  'pP.igg.ggi',
  'pP..i...i.',
  'pP..i...i.',
  'pPiiiiiiii',
  'IIIIIIIIII',
  'iiiiiiiiii',
]

const CLEAT_SLACK_ROWS: ReadonlyArray<string> = [
  '.....Rr...',
  '......R...',
  '......rR..',
  '.......R..',
  '......Rr..',
  '......R...',
  'pp...iYGi.',
  'pPiiiYRrGi',
  'pP..iGrRgi',
  'pP...iggR.',
  'pP......R.',
  'pP.......R',
  'pP.......R',
  'pP......R.',
  'pP.....R..',
  'pP.iYGR.Yi',
  'pPiYwWwWwG',
  'pPiGwWwWwg',
  'pPiYwWwWwG',
  'pPiGwWRWwg',
  'pPiYwWwWwG',
  'pPiGwWwWwg',
  'pP.igg.ggi',
  'pP..i.rRr.',
  'pP..irR.Rr',
  'pPiiiRrrRi',
  'IIIIIIIIII',
  'iiiiiiiiii',
]

const CLEAT_HEIGHT_PX = CLEAT_TAUT_ROWS.length

// NOTE: the crank's arm from the drum's middle, a quarter turn a frame:
// up, east, down, west, its knob the bright brass.
type Pixel = Readonly<{ column: number; row: number; mark: string }>

const CRANK_TURNS: Array.NonEmptyReadonlyArray<ReadonlyArray<Pixel>> = [
  [
    { column: 6, row: 18, mark: 'i' },
    { column: 6, row: 17, mark: 'G' },
    { column: 6, row: 16, mark: 'G' },
    { column: 6, row: 15, mark: 'Y' },
  ],
  [
    { column: 6, row: 18, mark: 'i' },
    { column: 7, row: 18, mark: 'G' },
    { column: 8, row: 18, mark: 'G' },
    { column: 9, row: 18, mark: 'Y' },
  ],
  [
    { column: 6, row: 18, mark: 'i' },
    { column: 6, row: 19, mark: 'G' },
    { column: 6, row: 20, mark: 'G' },
    { column: 6, row: 21, mark: 'Y' },
  ],
  [
    { column: 6, row: 18, mark: 'i' },
    { column: 5, row: 18, mark: 'G' },
    { column: 4, row: 18, mark: 'G' },
    { column: 3, row: 18, mark: 'Y' },
  ],
]

const withPixels = (
  rows: ReadonlyArray<string>,
  pixels: ReadonlyArray<Pixel>,
): ReadonlyArray<string> =>
  Array.map(rows, (line, row) =>
    Array.join(
      Array.map(String.split(line, ''), (mark, column) =>
        Option.getOrElse(
          Option.map(
            Array.findFirst(
              pixels,
              pixel => pixel.row === row && pixel.column === column,
            ),
            pixel => pixel.mark,
          ),
          () => mark,
        ),
      ),
      '',
    ),
  )

const cleatFrames = (
  rows: ReadonlyArray<string>,
): Array.NonEmptyReadonlyArray<Sprite> =>
  Array.map(CRANK_TURNS, turn => tile(withPixels(rows, turn), CLEAT_PALETTE))

const CLEAT_TAUT = cleatFrames(CLEAT_TAUT_ROWS)
const CLEAT_SLACK = cleatFrames(CLEAT_SLACK_ROWS)
const CRANK_STEP_MS = 140

// NOTE: the winch as it stands now: taut over a hung chandelier, slack under
// a fallen one, its crank turning while it is worked.
const cleatSpriteOf = (world: World, station: StationView): Sprite => {
  const frames = isChandelierDown(world) ? CLEAT_SLACK : CLEAT_TAUT
  const turn =
    station.setUp > 0
      ? Math.floor(world.elapsedMs / CRANK_STEP_MS) % frames.length
      : 0
  return Option.getOrElse(Array.get(frames, turn), () =>
    Array.headNonEmpty(frames),
  )
}

// NOTE: the gramophone: a wooden box, its turntable, and a brass horn.
// Carved by hand: its box and legs flush and deep, the horn's bell a few
// blocks, its neck one.
const GRAMOPHONE_SPRITE: Sprite = deepSprite(
  tile(
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
  ),
  {
    rows: [
      '......333.',
      '.....33333',
      '....333333',
      '....33333.',
      '...1.333..',
      '..1.......',
      '.6666666..',
      '.6666666..',
      '.6666666..',
      '.66...66..',
    ],
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

// NOTE: each tool's art as it stands now, how tall it is over the foot of
// its tile, and whether it stands up off the floor (carved, in the depth
// sort) or lies flat on it, as the fallen books at a stack do.
type StationArt = Readonly<{
  spriteOf: (world: World, station: StationView) => Sprite
  heightPx: number
  isStanding: boolean
}>

const stillArt = (
  sprite: Sprite,
  isStanding: boolean,
): Option.Option<StationArt> =>
  Option.some({
    spriteOf: Function.constant(sprite),
    heightPx: TILE_SIZE,
    isStanding,
  })

const STATION_ART: Readonly<Record<StationId, Option.Option<StationArt>>> = {
  Cleat: Option.some({
    spriteOf: cleatSpriteOf,
    heightPx: CLEAT_HEIGHT_PX,
    isStanding: true,
  }),
  Gramophone: stillArt(GRAMOPHONE_SPRITE, true),
  NorthStack: stillArt(BOOKS_SPRITE, false),
  SouthStack: stillArt(BOOKS_SPRITE, false),
  // NOTE: the shelf is the secret shelf's own art, its glinting red book.
  Shelf: Option.none(),
  Bulb: stillArt(CHAIN_SPRITE, true),
  Barrels: stillArt(BARREL_SPRITE, true),
  SoupPot: stillArt(POT_SPRITE, true),
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

// NOTE: the foot of a station's tile, where what stands there stands.
const footOf = (station: StationView): number =>
  Math.round(station.center.y) + HALF_TILE

// NOTE: the top of a station's art, so the arrow floats clear over a tall
// one (the winch), its bounce and all.
const artTopOf = (station: StationView): number =>
  footOf(station) -
  Option.match(STATION_ART[station.id], {
    onNone: () => TILE_SIZE,
    onSome: ({ heightPx }) => heightPx,
  })

// NOTE: where the arrow's point sits under the art's top: the arrow is
// drawn from 15 px over its point, 5 px tall, bobbing 2 px down
// (src/render/powerupView.ts), and what floats overhead stands 6 px over its
// own bottom edge in 3D (OVERHEAD_HOVER in src/render/iso/scene.ts), so its
// lowest pixel shows 2 px over the art's top.
const ARROW_CLEAR_PX = 12

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
      onSome: station =>
        doorArrowShapes(
          {
            x: Math.round(station.center.x),
            y: Math.min(
              Math.round(station.center.y) - WORK_RING_RADIUS,
              artTopOf(station) + ARROW_CLEAR_PX,
            ),
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
const rollingBarrelDrawables = (world: World): ReadonlyArray<Drawable> =>
  Option.match(barrelOf(world), {
    onNone: () => [],
    onSome: ({ x, y, isBroken }) => [
      {
        footY: Math.round(y),
        rank: 'Prop',
        shapes: [
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
      },
    ],
  })

const stationArtShapes = (
  world: World,
  station: StationView,
  { spriteOf, heightPx }: StationArt,
): ReadonlyArray<Canvas.Shape> => [
  placeAt(
    Math.round(station.center.x) - HALF_TILE,
    footOf(station) - heightPx,
    spriteOf(world, station),
  ),
]

// NOTE: on the ground layer, over the room's walls: what lies flat (the
// spilled soup, the toppled books, the fallen books at a stack's foot).
export const stationGroundShapes: {
  (isShown: Shown): (world: World) => ReadonlyArray<Canvas.Shape>
  (world: World, isShown: Shown): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (world: World, isShown: Shown): ReadonlyArray<Canvas.Shape> => [
    ...puddleShapes(world),
    ...heapShapes(world),
    ...Array.flatMap(shownStations(world, isShown), station =>
      Option.match(STATION_ART[station.id], {
        onNone: () => [],
        onSome: art =>
          art.isStanding ? [] : stationArtShapes(world, station, art),
      }),
    ),
  ],
)

// NOTE: what stands up off the floor, in the depth sort with the bodies
// and carved like them: the winch, the gramophone, the bulb's chain, the
// barrels, the soup pot, each at the foot of its tile, and the rolling
// barrel.
export const stationDrawables: {
  (isShown: Shown): (world: World) => ReadonlyArray<Drawable>
  (world: World, isShown: Shown): ReadonlyArray<Drawable>
} = Function.dual(
  2,
  (world: World, isShown: Shown): ReadonlyArray<Drawable> => [
    ...Array.flatMap(shownStations(world, isShown), station =>
      Option.match(STATION_ART[station.id], {
        onNone: () => [],
        onSome: (art): ReadonlyArray<Drawable> =>
          art.isStanding
            ? [
                {
                  footY: footOf(station),
                  rank: 'Prop',
                  shapes: stationArtShapes(world, station, art),
                },
              ]
            : [],
      }),
    ),
    ...rollingBarrelDrawables(world),
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
