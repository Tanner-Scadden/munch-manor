import { Array, Function } from 'effect'

import { bakeShapes, placeAt } from '../art/sprite'
import * as Draw from './draw'

export type BarSize = 'Small' | 'Large'
export type BarTone = 'Zombie' | 'Ally' | 'Rage'

type BarSpec = Readonly<{
  width: number
  height: number
  segments: number
}>

const BAR_SPECS: Readonly<Record<BarSize, BarSpec>> = {
  Small: { width: 12, height: 2, segments: 4 },
  Large: { width: 80, height: 4, segments: 10 },
}

type BarColors = Readonly<{ body: string; shine: string }>

const BAR_COLORS: Readonly<Record<BarTone, BarColors>> = {
  Zombie: { body: '#e8323a', shine: '#ff8f93' },
  Ally: { body: '#3fc44a', shine: '#a8f59a' },
  Rage: { body: '#ff7a1f', shine: '#ffc27a' },
}

const BAR_OUTLINE = '#0a0508'
const BAR_TRACK = '#241820'

const solid = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
) => Draw.Rect({ x, y, width, height, fill })

const outlineShapes = ({ width, height, segments }: BarSpec) => [
  solid(-1, -1, width + 2, 1, BAR_OUTLINE),
  solid(-1, height, width + 2, 1, BAR_OUTLINE),
  solid(-1, 0, 1, height, BAR_OUTLINE),
  solid(width, 0, 1, height, BAR_OUTLINE),
  ...Array.makeBy(segments - 1, index =>
    solid(
      Math.round(((index + 1) * width) / segments) - 1,
      0,
      1,
      height,
      BAR_OUTLINE,
    ),
  ),
]

const fillShapes = (
  { height }: BarSpec,
  colors: BarColors,
  left: number,
  top: number,
  filled: number,
) =>
  filled > 0
    ? [
        solid(left, top, filled, height, colors.body),
        solid(left, top, filled, 1, colors.shine),
      ]
    : []

const SMALL = BAR_SPECS.Small
const LARGE = BAR_SPECS.Large

const smallBarsOf = (colors: BarColors) =>
  Array.makeBy(SMALL.width + 1, filled =>
    bakeShapes([
      solid(0, 0, SMALL.width, SMALL.height, BAR_TRACK),
      ...fillShapes(SMALL, colors, 0, 0, filled),
      ...outlineShapes(SMALL),
    ]),
  )

const SMALL_BARS: Readonly<
  Record<BarTone, ReadonlyArray<ReadonlyArray<Draw.Shape>>>
> = {
  Zombie: smallBarsOf(BAR_COLORS.Zombie),
  Ally: smallBarsOf(BAR_COLORS.Ally),
  Rage: smallBarsOf(BAR_COLORS.Rage),
}

const LARGE_CAGE = bakeShapes(outlineShapes(LARGE))

export const barWidthOf = (size: BarSize): number => BAR_SPECS[size].width

export const healthBarShapes: {
  (
    tone: BarTone,
    left: number,
    top: number,
    share: number,
  ): (size: BarSize) => ReadonlyArray<Draw.Shape>
  (
    size: BarSize,
    tone: BarTone,
    left: number,
    top: number,
    share: number,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  5,
  (
    size: BarSize,
    tone: BarTone,
    left: number,
    top: number,
    share: number,
  ): ReadonlyArray<Draw.Shape> => {
    const { width } = BAR_SPECS[size]
    const clamped = Math.min(1, Math.max(0, share))
    const filled = Math.min(
      width,
      Math.max(clamped > 0 ? 1 : 0, Math.round(width * clamped)),
    )
    return size === 'Small'
      ? [placeAt(left, top, SMALL_BARS[tone][filled] ?? [])]
      : [
          solid(left, top, LARGE.width, LARGE.height, BAR_TRACK),
          ...fillShapes(LARGE, BAR_COLORS[tone], left, top, filled),
          placeAt(left, top, LARGE_CAGE),
        ]
  },
)
