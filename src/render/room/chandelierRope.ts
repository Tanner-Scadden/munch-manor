// The chandelier's rope in 3D, along the dining room's wall tops, where the
// eye already reads the house as high: from where the winch's rope leaves
// the top of its art (src/art/winchArt.ts) west to a brass pulley standing
// on the west wall's top, north along that wall to a pulley on the corner,
// east along the north wall to a pulley over the table's gap, and from it
// down to a brass ring on the hung chandelier's chain. It lies on the wall
// tops through the middle of each pulley's wheel, and drops straight down
// where a tall wall meets a low one. Hung, it spans each doorway straight;
// dropped, it droops into them, and its cut end hangs down the north wall's
// face. A
// solid rope with a darker underside, whole blocks a game pixel each, laid
// by hand (`blocksModelOf`), built once per level for each state.

import { Array, Option, String } from 'effect'

import { blocksModelOf } from '../../art/carve'
import {
  BRASS_COLOR,
  BRASS_DARK_COLOR,
  BRASS_SHINE_COLOR,
  ROPE_DARK_COLOR,
  ROPE_LIGHT_COLOR,
  WINCH_HEIGHT_PX,
  WINCH_ROPE_COLUMN,
} from '../../art/winchArt'
import { TILE_SIZE } from '../../shared/constants'
import { gapBoxOf } from '../../world/dining/chandelier'
import type { Level } from '../../world/level/arena'
import { stationCenterOf } from '../../world/stations/stationSpots'
import { PITCH, wallTopRiseAt } from '../iso/space'
import type { CarvedShowpiece } from './chandelierCarve'
import type { ChandelierState } from './diningArt'

// NOTE: a block of the rope or a pulley: `x` east and `floor` the floor row
// whose pixel it stands on, in game pixels, and `h` how many pixels over
// the floor its bottom is, along the lens's up, as every standing sprite's
// pixels are (src/render/iso/space.ts, `standingPointOf`).
type Block = Readonly<{ x: number; floor: number; h: number; color: string }>

// NOTE: a block `h` up the lens's up is `cos PITCH` of a pixel high in the
// world, and stands `sin² PITCH` of a row north of the floor row it stands
// on for each pixel up.
const LEAN = Math.sin(PITCH) ** 2

// NOTE: the floor row a block `h` up stands on so its middle is over the
// world's floor row `row`.
const floorOf = (row: number, h: number): number =>
  Math.round(row + 0.5 + LEAN * (h + 0.5))

// NOTE: a pulley's wheel standing on a wall's top up the lens's up, as the
// house's sprites stand, over its two rope columns, two deep: its lowest
// row a pixel into the wall, so the rope lying on the top runs through its
// middle.
const PULLEY_ROWS: ReadonlyArray<string> = ['.YG.', 'GbbG', 'GbbG', '.GG.']
const PULLEY_SINK = 1
const PULLEY_COLORS: Readonly<Record<string, string>> = {
  G: BRASS_COLOR,
  b: BRASS_DARK_COLOR,
  Y: BRASS_SHINE_COLOR,
}
// NOTE: the ring the rope is tied to at the chain's top, two blocks round.
const RING_ROWS: ReadonlyArray<string> = ['GY', 'bG']

// NOTE: dropped: the most a span off the wall tops droops at its middle, a
// quarter of its length up to this.
const DROOP_PX = 6
// NOTE: dropped, the cut end hangs over the north wall's edge, this many
// rows south of the pulley so it clears the wall's top, down to this far
// over the floor.
const OVER_EDGE_ROWS = 4
const LOOSE_END_H = 2

// NOTE: art rows as blocks, its last row at `h` and its first column at
// `left`, up the lens's up at floor row `floor` and the one behind it.
const artAt = (
  rows: ReadonlyArray<string>,
  at: Readonly<{ left: number; floor: number; h: number }>,
): ReadonlyArray<Block> =>
  Array.flatMap(rows, (line, row) =>
    Array.flatMap(Array.range(0, line.length - 1), column =>
      Option.match(
        Option.flatMap(String.charAt(line, column), mark =>
          Option.fromNullishOr(PULLEY_COLORS[mark]),
        ),
        {
          onNone: () => [],
          onSome: color =>
            Array.map([at.floor, at.floor - 1], deep => ({
              x: at.left + column,
              floor: deep,
              h: at.h + rows.length - 1 - row,
              color,
            })),
        },
      ),
    ),
  )

// NOTE: the rope's section at one spot, two blocks across and two thick up
// the lens's up, so it shows on screen as a solid rope with a darker pixel
// under it: `across` lays its second column east (a run north and south)
// or a row behind (a run east and west).
const sectionAt = (
  at: Readonly<{ x: number; floor: number; h: number }>,
  across: 'East' | 'Behind',
): ReadonlyArray<Block> => {
  const second =
    across === 'East'
      ? { x: at.x + 1, floor: at.floor }
      : { x: at.x, floor: at.floor - 1 }
  return Array.flatMap([{ x: at.x, floor: at.floor }, second], spot => [
    { ...spot, h: at.h, color: ROPE_DARK_COLOR },
    { ...spot, h: at.h + 1, color: ROPE_LIGHT_COLOR },
  ])
}

// NOTE: the height a rope lying on the wall at a game pixel rests at, in
// blocks up the lens's up, or none over the floor or a doorway.
const restOf = (
  level: Level,
  x: number,
  row: number,
): Option.Option<number> => {
  const rise = wallTopRiseAt({
    tiles: level.tiles,
    row: Math.floor((row - level.top) / TILE_SIZE),
    column: Math.floor((x - level.left) / TILE_SIZE),
  })
  return rise > 0 ? Option.some(rise) : Option.none()
}

// NOTE: for each spot, the nearest spot with a support at or before it
// going one way, in one pass.
const nearestSupports = (
  supports: ReadonlyArray<Option.Option<number>>,
  step: 1 | -1,
): ReadonlyArray<number> => {
  const nearest: Array<number> = []
  const first = step === 1 ? supports.length - 1 : 0
  let seen = first
  for (let count = 0; count < supports.length; count += 1) {
    const at = step === 1 ? supports.length - 1 - count : count
    if (Option.isSome(supports[at] ?? Option.none())) {
      seen = at
    }
    nearest[at] = seen
  }
  return nearest
}

// NOTE: the rope's height at each of a run's spots, from one end's height
// to the other's: lying on whatever wall is under it, and between, a
// straight span while hung and a droop once dropped.
const heightsOf = (
  input: Readonly<{
    from: number
    to: number
    rests: ReadonlyArray<Option.Option<number>>
    state: ChandelierState
  }>,
): ReadonlyArray<number> => {
  const { from, to, rests, state } = input
  const last = rests.length - 1
  const supports: ReadonlyArray<Option.Option<number>> = Array.map(
    rests,
    (rest, at) =>
      at === 0 ? Option.some(from) : at === last ? Option.some(to) : rest,
  )
  const heightAt = (at: number): number =>
    Option.getOrElse(supports[at] ?? Option.none(), () => from)
  const wests = nearestSupports(supports, -1)
  const easts = nearestSupports(supports, 1)
  return Array.map(supports, (support, at) =>
    Option.getOrElse(support, () => {
      const west = wests[at] ?? 0
      const east = easts[at] ?? last
      const share = (at - west) / Math.max(1, east - west)
      const line = heightAt(west) + (heightAt(east) - heightAt(west)) * share
      const droop = state === 'Hung' ? 0 : Math.min(DROOP_PX, (east - west) / 4)
      return Math.max(1, Math.round(line - droop * 4 * share * (1 - share)))
    }),
  )
}

// NOTE: a run's sections at its spots, and where the height jumps between
// two spots (a tall wall's top down to a low one's), the rope straight down
// at the lower spot, a block of height at a time on the world's own up.
const sectionsAlong = (
  spots: ReadonlyArray<Readonly<{ x: number; row: number; h: number }>>,
  across: 'East' | 'Behind',
): ReadonlyArray<Block> =>
  Array.flatMap(spots, (spot, at) => {
    const before = at === 0 ? spot.h : (spots[at - 1]?.h ?? spot.h)
    const low = Math.min(before, spot.h)
    const high = Math.max(before, spot.h)
    const x = before > spot.h ? spot.x : (spots[at - 1]?.x ?? spot.x)
    const row = before > spot.h ? spot.row : (spots[at - 1]?.row ?? spot.row)
    return [
      ...sectionAt(
        { x: spot.x, floor: floorOf(spot.row, spot.h), h: spot.h },
        across,
      ),
      ...Array.flatMap(
        high - low > 1 ? Array.range(low + 1, high - 1) : [],
        h => sectionAt({ x, floor: floorOf(row, h), h }, across),
      ),
    ]
  })

// NOTE: a rope point: a game pixel's column and floor row in the world, and
// its height in blocks up the lens's up.
type Point = Readonly<{ x: number; row: number; h: number }>

// NOTE: a run east or west along a floor row, from `from` to `to` (their
// rows the same), its height by `heightsOf`.
const runAlongRow = (
  input: Readonly<{
    level: Level
    from: Point
    to: Point
    state: ChandelierState
  }>,
): ReadonlyArray<Block> => {
  const { level, from, to, state } = input
  const step = to.x >= from.x ? 1 : -1
  const xs = Array.map(
    Array.range(0, Math.abs(to.x - from.x)),
    at => from.x + at * step,
  )
  const heights = heightsOf({
    from: from.h,
    to: to.h,
    rests: Array.map(xs, x => restOf(level, x, from.row)),
    state,
  })
  return sectionsAlong(
    Array.map(xs, (x, at) => ({ x, row: from.row, h: heights[at] ?? from.h })),
    'Behind',
  )
}

// NOTE: a run north or south down a column, from `from` to `to` (their
// columns the same).
const runAlongColumn = (
  input: Readonly<{
    level: Level
    from: Point
    to: Point
    state: ChandelierState
  }>,
): ReadonlyArray<Block> => {
  const { level, from, to, state } = input
  const step = to.row >= from.row ? 1 : -1
  const rows = Array.map(
    Array.range(0, Math.abs(to.row - from.row)),
    at => from.row + at * step,
  )
  const heights = heightsOf({
    from: from.h,
    to: to.h,
    rests: Array.map(rows, row => restOf(level, from.x, row)),
    state,
  })
  return sectionsAlong(
    Array.map(rows, (row, at) => ({
      x: from.x,
      row,
      h: heights[at] ?? from.h,
    })),
    'East',
  )
}

// NOTE: a pulley at a rope point, standing on the wall's top there, the
// rope through its wheel.
const pulleyAt = (at: Point): ReadonlyArray<Block> =>
  artAt(PULLEY_ROWS, {
    left: at.x - 1,
    floor: floorOf(at.row, at.h),
    h: at.h - PULLEY_SINK,
  })

// NOTE: the top of a pulley's wheel over its rope point, where the rope
// leaves it for the chain.
const wheelTopOf = (at: Point): number =>
  at.h - PULLEY_SINK + PULLEY_ROWS.length - 1

// NOTE: where the rope turns: the winch's rope column over the top of its
// art; the west wall's pulley level with it; the corner's pulley where the
// west wall meets the north wall; the north wall's pulley over the gap; and
// the chain's top. A pulley's rope point is where the rope lies on the
// wall's top under it.
type Route = Readonly<{
  winch: Point
  west: Point
  corner: Point
  north: Point
  // NOTE: the chain's top block's floor row and height (chandelierCarve.ts:
  // the hung piece's foot two under the gap's top, its chain three deep, its
  // top 58 over the floor).
  chain: Readonly<{ x: number; floor: number; h: number }>
}>

const CHAIN_TOP_H = 58

// NOTE: the rope lying on the wall's top at a game pixel.
const lyingAt = (
  level: Level,
  spot: Readonly<{ x: number; row: number }>,
): Option.Option<Point> =>
  Option.map(restOf(level, spot.x, spot.row), h => ({ ...spot, h }))

// NOTE: the first wall tile's edge from a tile going one way, in game
// pixels: its east edge going west, its south edge going north.
const wallEdgeFrom = (
  input: Readonly<{
    level: Level
    x: number
    row: number
    way: 'West' | 'North'
  }>,
): Option.Option<number> => {
  const { level, way } = input
  const along = way === 'West' ? input.x : input.row
  const firstWall = Array.findFirst(
    Array.range(1, Math.floor(level.width / TILE_SIZE)),
    tiles => {
      const at = along - tiles * TILE_SIZE
      return Option.isSome(
        way === 'West'
          ? restOf(level, at, input.row)
          : restOf(level, input.x, at),
      )
    },
  )
  return Option.map(firstWall, tiles => {
    const at = along - tiles * TILE_SIZE
    const origin = way === 'West' ? level.left : level.top
    return (
      Math.floor((at - origin) / TILE_SIZE) * TILE_SIZE + origin + TILE_SIZE
    )
  })
}

// NOTE: how far in from a wall's edge the rope runs on its top, and its
// rows: the pulleys' feet stand on the wall, clear of the edge.
const INSET_PX = 4
const NORTH_INSET_PX = 6

const routeOf = (level: Level): Option.Option<Route> =>
  Option.flatMap(
    Option.zipWith(
      stationCenterOf(level, 'Cleat'),
      gapBoxOf(level),
      (winch, gap) => ({ winch, gap }),
    ),
    ({ winch, gap }) => {
      const foot = Math.round(winch.y) + TILE_SIZE / 2
      const winchTop: Point = {
        x: Math.round(winch.x) - TILE_SIZE / 2 + WINCH_ROPE_COLUMN + 1,
        row: Math.round(foot - 0.5 - LEAN * (WINCH_HEIGHT_PX - 0.5)),
        h: WINCH_HEIGHT_PX - 1,
      }
      const chainX = Math.round((gap.left + gap.right) / 2)
      return Option.gen(function* () {
        const westEdge = yield* wallEdgeFrom({
          level,
          x: winchTop.x,
          row: Math.round(winch.y),
          way: 'West',
        })
        const northEdge = yield* wallEdgeFrom({
          level,
          x: chainX,
          row: Math.round(gap.top),
          way: 'North',
        })
        const wallX = westEdge - INSET_PX
        const northRow = northEdge - NORTH_INSET_PX
        const west = yield* lyingAt(level, { x: wallX, row: winchTop.row })
        const corner = yield* lyingAt(level, { x: wallX, row: northRow })
        const north = yield* lyingAt(level, { x: chainX, row: northRow })
        return {
          winch: winchTop,
          west,
          corner,
          north,
          chain: {
            x: chainX,
            floor: Math.round(gap.top) - 1,
            h: CHAIN_TOP_H,
          },
        }
      })
    },
  )

// NOTE: hung, from the north wall's pulley down to the ring on the chain's
// top: a straight line in the world, a step of floor row or height at a
// time, so no two blocks part on screen; one block across, as the chain it
// holds is, since two across read as a beam of light.
const dropOf = (route: Route): ReadonlyArray<Block> => {
  const start = {
    floor: floorOf(route.north.row, route.north.h),
    h: wheelTopOf(route.north),
  }
  const end = { floor: route.chain.floor, h: route.chain.h + RING_ROWS.length }
  const steps = Math.max(
    1,
    Math.abs(end.floor - start.floor),
    Math.abs(end.h - start.h),
  )
  return [
    ...Array.flatMap(Array.range(0, steps), at => {
      const floor = Math.round(
        start.floor + ((end.floor - start.floor) * at) / steps,
      )
      const h = Math.round(start.h + ((end.h - start.h) * at) / steps)
      return [
        { x: route.north.x, floor, h, color: ROPE_DARK_COLOR },
        { x: route.north.x, floor, h: h + 1, color: ROPE_LIGHT_COLOR },
      ]
    }),
    ...artAt(RING_ROWS, {
      left: route.chain.x,
      floor: route.chain.floor,
      h: route.chain.h + 1,
    }),
  ]
}

// NOTE: dropped, the cut end over the north wall's edge, hanging down its
// face, its last two blocks frayed apart.
const looseEndOf = (route: Route): ReadonlyArray<Block> => {
  const { x } = route.north
  const h = wheelTopOf(route.north)
  const top = floorOf(route.north.row, route.north.h)
  const hangs = top + OVER_EDGE_ROWS
  return [
    ...Array.flatMap(Array.range(top, hangs), floor =>
      sectionAt({ x, floor, h }, 'East'),
    ),
    ...Array.flatMap(Array.range(LOOSE_END_H + 1, h - 1), at =>
      sectionAt({ x, floor: hangs, h: at }, 'East'),
    ),
    { x: x - 1, floor: hangs, h: LOOSE_END_H, color: ROPE_DARK_COLOR },
    { x: x + 2, floor: hangs, h: LOOSE_END_H + 1, color: ROPE_DARK_COLOR },
  ]
}

// NOTE: the rope's blocks in three pieces, each with its own small grid: up
// the west wall, along the north wall, and its end at the gap. A block a
// later piece lays over an earlier one wins, so a pulley sits over the rope.
const piecesOf = (
  level: Level,
  route: Route,
  state: ChandelierState,
): ReadonlyArray<ReadonlyArray<Block>> => [
  [
    ...runAlongRow({ level, from: route.winch, to: route.west, state }),
    ...runAlongColumn({ level, from: route.west, to: route.corner, state }),
    ...pulleyAt(route.west),
    ...pulleyAt(route.corner),
  ],
  [
    ...runAlongRow({ level, from: route.corner, to: route.north, state }),
    ...pulleyAt(route.north),
  ],
  state === 'Hung' ? dropOf(route) : looseEndOf(route),
]

// NOTE: the blocks as a carved piece standing where they are: its grid's
// first column the westmost block, its front the southmost floor row, and
// its first row the highest block's top. A block a floor row north is a
// step of the grid's depth (src/render/iso/carvedMesh.ts).
const pieceOf = (blocks: ReadonlyArray<Block>): CarvedShowpiece => {
  const left = Array.reduce(blocks, Infinity, (most, { x }) =>
    Math.min(most, x),
  )
  const foot = Array.reduce(blocks, -Infinity, (most, { floor }) =>
    Math.max(most, floor),
  )
  const top = Array.reduce(blocks, -Infinity, (most, { h }) =>
    Math.max(most, h),
  )
  return {
    model: blocksModelOf(
      Array.map(blocks, ({ x, floor, h, color }) => ({
        x: x - left,
        y: top - h,
        z: foot - floor,
        color,
      })),
    ),
    left,
    foot,
    rise: top + 1,
  }
}

// NOTE: the rope's pieces for each state, or none in a level with no dining
// room.
export const chandelierRopeOf = (
  level: Level,
): Option.Option<
  Readonly<Record<ChandelierState, ReadonlyArray<CarvedShowpiece>>>
> =>
  Option.map(routeOf(level), route => ({
    Hung: Array.map(piecesOf(level, route, 'Hung'), pieceOf),
    Fallen: Array.map(piecesOf(level, route, 'Fallen'), pieceOf),
  }))
