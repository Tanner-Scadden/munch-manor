// The chandelier's rope in 3D: from where the winch's rope leaves the top of
// its art (src/art/winchArt.ts), straight up to a brass pulley under the
// ceiling, then across the dining room to a second pulley over the table's
// gap, where the hung chandelier's chain hangs from it. Dropped, the rope
// bows off the winch, sags between the pulleys, and its cut end hangs empty
// over the gap. Whole blocks, a game pixel each, laid by hand
// (`blocksModelOf`), built once per level for each state.

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
import type { CarvedShowpiece } from './chandelierCarve'
import type { ChandelierState } from './diningArt'

// NOTE: a block of the rope or a pulley: `x` east and `floor` the floor row
// it stands over, in game pixels, and `h` how many pixels over the floor its
// bottom is, along the lens's up.
type Block = Readonly<{ x: number; floor: number; h: number; color: string }>

// NOTE: the pulleys' lowest row, so the hung chandelier's chain, whose top
// block is 58 over the floor (chandelierCarve.ts: the box's top 62 over the
// floor, the chain three rows down), hangs straight from the gap's pulley.
const PULLEY_LOW = 59
const PULLEY_ROWS: ReadonlyArray<string> = ['.YG.', 'GbbG', 'GbbG', '.GG.']
const PULLEY_COLORS: Readonly<Record<string, string>> = {
  G: BRASS_COLOR,
  b: BRASS_DARK_COLOR,
  Y: BRASS_SHINE_COLOR,
}
// NOTE: the rope rides over the pulleys' tops, two blocks thick.
const RUN_LOW = PULLEY_LOW + PULLEY_ROWS.length - 2
// NOTE: dropped: how far the run sags at its middle, how far the rope off
// the winch bows east, and how far down the cut end hangs.
const SAG_PX = 9
const BOW_PX = 2
const LOOSE_END_PX = 20

// NOTE: the rope's twist, light and dark blocks in a checker, as the
// winch's art draws its rope.
const ropeColorOf = (x: number, h: number): string =>
  (x + h) % 2 === 0 ? ROPE_LIGHT_COLOR : ROPE_DARK_COLOR

const ropeAt = (x: number, floor: number, h: number): Block => ({
  x,
  floor,
  h,
  color: ropeColorOf(x, h),
})

// NOTE: a pulley's 4 by 4 wheel over its two rope columns, two deep.
const pulleyAt = (left: number, floor: number): ReadonlyArray<Block> =>
  Array.flatMap(PULLEY_ROWS, (line, row) =>
    Array.flatMap(Array.range(0, line.length - 1), column =>
      Option.match(
        Option.flatMap(String.charAt(line, column), mark =>
          Option.fromNullishOr(PULLEY_COLORS[mark]),
        ),
        {
          onNone: () => [],
          onSome: color =>
            Array.map([floor, floor - 1], deep => ({
              x: left + column,
              floor: deep,
              h: PULLEY_LOW + PULLEY_ROWS.length - 1 - row,
              color,
            })),
        },
      ),
    ),
  )

type Ends = Readonly<{
  // NOTE: the winch's rope column, the floor row it stands over, and the
  // height of the first block over its art.
  winch: Readonly<{ x: number; floor: number; h: number }>
  // NOTE: the gap pulley's rope column, over the chain, and its floor row.
  gap: Readonly<{ x: number; floor: number }>
}>

// NOTE: up from the winch to the corner pulley, two blocks wide; dropped,
// bowed east at its middle.
const riseOf = (ends: Ends, state: ChandelierState): ReadonlyArray<Block> => {
  const { x, floor, h } = ends.winch
  const span = PULLEY_LOW - h
  return Array.flatMap(Array.range(h, PULLEY_LOW - 1), at => {
    const bow =
      state === 'Hung'
        ? 0
        : Math.round(BOW_PX * Math.sin((Math.PI * (at - h)) / span))
    return [ropeAt(x + bow, floor, at), ropeAt(x + 1 + bow, floor, at)]
  })
}

// NOTE: across from the corner pulley's east edge to the gap pulley's west
// edge, over their tops, a floor row north at a time as it nears the gap;
// dropped, sagging in a whole pixel curve.
const runOf = (ends: Ends, state: ChandelierState): ReadonlyArray<Block> => {
  const from = ends.winch.x + 3
  const to = ends.gap.x - 2
  const length = Math.max(1, to - from)
  return Array.flatMap(Array.range(from, to), x => {
    const share = (x - from) / length
    const floor = Math.round(
      ends.winch.floor + (ends.gap.floor - ends.winch.floor) * share,
    )
    const sag =
      state === 'Hung' ? 0 : Math.round(SAG_PX * 4 * share * (1 - share))
    return [
      ropeAt(x, floor, RUN_LOW - sag),
      ropeAt(x, floor, RUN_LOW + 1 - sag),
    ]
  })
}

// NOTE: dropped, the cut end hanging from the gap's pulley, its last two
// blocks frayed apart.
const looseEndOf = (ends: Ends): ReadonlyArray<Block> => {
  const { x, floor } = ends.gap
  const end = PULLEY_LOW - LOOSE_END_PX
  return [
    ...Array.flatMap(Array.range(end + 1, PULLEY_LOW - 1), at => [
      ropeAt(x, floor, at),
      ropeAt(x + 1, floor, at),
    ]),
    ropeAt(x - 1, floor, end),
    ropeAt(x + 2, floor, end - 1),
  ]
}

const blocksOf = (ends: Ends, state: ChandelierState): ReadonlyArray<Block> => [
  ...riseOf(ends, state),
  ...runOf(ends, state),
  ...(state === 'Hung' ? [] : looseEndOf(ends)),
  ...pulleyAt(ends.winch.x - 1, ends.winch.floor),
  ...pulleyAt(ends.gap.x - 1, ends.gap.floor),
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

// NOTE: where the rope's ends are in a level with the dining room: the
// winch's rope column at the foot of its tile (its art 12 wide from the
// tile's west edge, src/art/winchArt.ts), a floor row back, the first
// block over the art's top; and the chain's column over the gap's middle, a
// floor row north of the gap (the chain three deep from the hung piece's
// foot, two under the gap's top edge).
const endsOf = (level: Level): Option.Option<Ends> =>
  Option.zipWith(
    stationCenterOf(level, 'Cleat'),
    gapBoxOf(level),
    (winch, gap): Ends => {
      const foot = Math.round(winch.y) + TILE_SIZE / 2
      return {
        winch: {
          x: Math.round(winch.x) - TILE_SIZE / 2 + WINCH_ROPE_COLUMN,
          floor: foot - 1,
          h: WINCH_HEIGHT_PX - 1,
        },
        gap: {
          x: Math.round((gap.left + gap.right) / 2),
          floor: Math.round(gap.top) - 1,
        },
      }
    },
  )

// NOTE: the rope for each state, or none in a level with no dining room.
export const chandelierRopeOf = (
  level: Level,
): Option.Option<Readonly<Record<ChandelierState, CarvedShowpiece>>> =>
  Option.map(endsOf(level), ends => ({
    Hung: pieceOf(blocksOf(ends, 'Hung')),
    Fallen: pieceOf(blocksOf(ends, 'Fallen')),
  }))
