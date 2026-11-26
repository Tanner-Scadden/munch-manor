import { Array, Function, Option } from 'effect'

import {
  type Sprite,
  TOP_LEFT,
  deepSprite,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { WINCH_HEIGHT_PX, WINCH_SLACK, WINCH_TAUT } from '../../art/winchArt'
import type { Drawable } from '../../render/depth'
import type * as Draw from '../../render/draw'
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
import { BOOK_PALETTE, HEAP_ROWS } from './heapArt'

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

const CRANK_STEP_MS = 140

// NOTE: the winch as it stands now: taut over a hung chandelier, slack under
// a fallen one, its crank turning while it is worked.
const cleatSpriteOf = (world: World, station: StationView): Sprite => {
  const frames = isChandelierDown(world) ? WINCH_SLACK : WINCH_TAUT
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
    '....AA....',
    '...AaaA...',
    '..BBBBBB..',
    '..BbbbbB..',
    '.EEEEE....',
    '.EeeeE.DD.',
    '......DddD',
    '..........',
  ],
  BOOK_PALETTE,
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

// NOTE: each tool's art as it stands now, standing up off the floor
// (carved, in the depth sort), and how tall it is over the foot of its tile.
type StationArt = Readonly<{
  spriteOf: (world: World, station: StationView) => Sprite
  heightPx: number
  // NOTE: how far east of the middle the first time arrow points down.
  arrowDx: number
}>

const stillArt = (sprite: Sprite): Option.Option<StationArt> =>
  Option.some({
    spriteOf: Function.constant(sprite),
    heightPx: TILE_SIZE,
    arrowDx: 0,
  })

const STATION_ART: Readonly<Record<StationId, Option.Option<StationArt>>> = {
  Cleat: Option.some({
    spriteOf: cleatSpriteOf,
    heightPx: WINCH_HEIGHT_PX,
    // NOTE: east of the rope that runs straight up out of the winch's
    // pulley (src/render/room/chandelierRope.ts), which stands nearer the
    // lens than the arrow and would cut through it.
    arrowDx: 7,
  }),
  Gramophone: stillArt(GRAMOPHONE_SPRITE),
  NorthStack: stillArt(BOOKS_SPRITE),
  SouthStack: stillArt(BOOKS_SPRITE),
  // NOTE: the shelf is the secret shelf's own art, its glinting red book.
  Shelf: Option.none(),
  Bulb: stillArt(CHAIN_SPRITE),
  Barrels: stillArt(BARREL_SPRITE),
  SoupPot: stillArt(POT_SPRITE),
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
): ReadonlyArray<Draw.Shape> => {
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

const arrowDxOf = (station: StationView): number =>
  Option.match(STATION_ART[station.id], {
    onNone: () => 0,
    onSome: ({ arrowDx }) => arrowDx,
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
): ReadonlyArray<Draw.Shape> => {
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
            x: Math.round(station.center.x) + arrowDxOf(station),
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
): ReadonlyArray<Draw.Shape> =>
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
): ReadonlyArray<Draw.Shape> =>
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
): ReadonlyArray<Draw.Shape> =>
  station.id === 'Gramophone'
    ? notesShapes(world, station)
    : station.id === 'Shelf'
      ? dustShapes(world, station)
      : []

// NOTE: the toppled books stand as the heap they are, a mound a row of its
// tiles, each at the foot of its row so a body beside it sorts round it.
const heapDrawables = (world: World): ReadonlyArray<Drawable> =>
  Array.flatMap(STACK_IDS, id =>
    isHeapDown(world, id)
      ? Option.match(heapBoxOf(levelOf(world), id), {
          onNone: () => [],
          onSome: box =>
            Array.map(HEAP_ROWS[id], ({ sprite, height }, row): Drawable => {
              const footY = box.top + (row + 1) * TILE_SIZE
              return {
                footY,
                rank: 'Prop',
                shapes: [placeAt(box.left, footY - height, sprite)],
              }
            }),
        })
      : [],
  )

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
): ReadonlyArray<Draw.Shape> => [
  placeAt(
    Math.round(station.center.x) - HALF_TILE,
    footOf(station) - heightPx,
    spriteOf(world, station),
  ),
]

// NOTE: on the ground layer, over the room's walls: each station's set-up
// or cooldown ring, or its first time pulse, flat on the floor round its
// foot, so what stands there stands in front of the ring's far half and
// never under it (owner, 2026-11-15: the ring floating over the winch hid
// its drum and crank).
export const stationGroundShapes: {
  (isShown: Shown): (world: World) => ReadonlyArray<Draw.Shape>
  (world: World, isShown: Shown): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (world: World, isShown: Shown): ReadonlyArray<Draw.Shape> =>
    Array.flatMap(shownStations(world, isShown), station =>
      ringShapes(station, world.elapsedMs),
    ),
)

// NOTE: what stands up off the floor, in the depth sort with the bodies
// and carved like them: the winch, the gramophone, the books at a stack's
// foot, the bulb's chain, the barrels, the soup pot, each at the foot of
// its tile, the toppled books, and the rolling barrel.
export const stationDrawables: {
  (isShown: Shown): (world: World) => ReadonlyArray<Drawable>
  (world: World, isShown: Shown): ReadonlyArray<Drawable>
} = Function.dual(
  2,
  (world: World, isShown: Shown): ReadonlyArray<Drawable> => [
    ...Array.flatMap(shownStations(world, isShown), station =>
      Option.match(STATION_ART[station.id], {
        onNone: () => [],
        onSome: (art): ReadonlyArray<Drawable> => [
          {
            footY: footOf(station),
            rank: 'Prop',
            shapes: stationArtShapes(world, station, art),
          },
        ],
      }),
    ),
    ...heapDrawables(world),
    ...rollingBarrelDrawables(world),
  ],
)

// NOTE: over everything: a tool's notes or dust while it is on, and the
// first time hint's arrow.
export const stationOverheadShapes: {
  (isShown: Shown): (world: World) => ReadonlyArray<Draw.Shape>
  (world: World, isShown: Shown): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (world: World, isShown: Shown): ReadonlyArray<Draw.Shape> => {
    const stations = shownStations(world, isShown)
    return [
      ...Array.flatMap(stations, station => toolOverheadShapes(world, station)),
      ...arrowShapes(world, stations),
    ]
  },
)
