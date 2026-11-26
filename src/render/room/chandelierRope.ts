import { Array, Option, String } from 'effect'

import { blocksModelOf } from '#art/carve.ts'
import {
  BRASS_COLOR,
  BRASS_DARK_COLOR,
  BRASS_SHINE_COLOR,
  ROPE_DARK_COLOR,
  ROPE_LIGHT_COLOR,
  WINCH_HEIGHT_PX,
  WINCH_ROPE_COLUMN,
} from '#art/winchArt.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import { gapBoxOf } from '#world/dining/chandelier.ts'
import type { Level } from '#world/level/arena.ts'
import { stationCenterOf } from '#world/stations/stationSpots.ts'

import type { CarvedShowpiece } from './chandelierCarve.ts'
import type { ChandelierState } from './diningArt.ts'

type Block = Readonly<{ x: number; floor: number; h: number; color: string }>

const PULLEY_LOW = 59
const PULLEY_ROWS: ReadonlyArray<string> = ['.YG.', 'GbbG', 'GbbG', '.GG.']
const PULLEY_COLORS: Readonly<Record<string, string>> = {
  G: BRASS_COLOR,
  b: BRASS_DARK_COLOR,
  Y: BRASS_SHINE_COLOR,
}
const RUN_LOW = PULLEY_LOW + PULLEY_ROWS.length - 2
const SAG_PX = 9
const BOW_PX = 2
const LOOSE_END_PX = 20

const ropeColorOf = (x: number, h: number): string =>
  (x + h) % 2 === 0 ? ROPE_LIGHT_COLOR : ROPE_DARK_COLOR

const ropeAt = (x: number, floor: number, h: number): Block => ({
  x,
  floor,
  h,
  color: ropeColorOf(x, h),
})

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
  winch: Readonly<{ x: number; floor: number; h: number }>
  gap: Readonly<{ x: number; floor: number }>
}>

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

export const chandelierRopeOf = (
  level: Level,
): Option.Option<Readonly<Record<ChandelierState, CarvedShowpiece>>> =>
  Option.map(endsOf(level), ends => ({
    Hung: pieceOf(blocksOf(ends, 'Hung')),
    Fallen: pieceOf(blocksOf(ends, 'Fallen')),
  }))
