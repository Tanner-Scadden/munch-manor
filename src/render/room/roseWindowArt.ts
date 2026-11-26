import { Array, Option, Record, Result, String } from 'effect'

import type * as Draw from '../draw'
import { pixelArt } from '../drawing'
import type { Box } from './roomPalette'

const SIZE = 17
const MIDDLE = (SIZE - 1) / 2

export const ROSE_PALETTE: Readonly<Record<string, string>> = {
  S: '#4a4250',
  s: '#6e6478',
  L: '#1a1420',
  r: '#c8283c',
  b: '#2e58c8',
  g: '#3aa060',
  p: '#8a3ac0',
  y: '#ffcc40',
}

const PETALS = 8
const PETAL_COLORS: ReadonlyArray<string> = ['r', 'b']
const HEART_COLORS: ReadonlyArray<string> = ['g', 'p']

const turnOf = (dx: number, dy: number): number =>
  (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1

const offSpoke = (dx: number, dy: number, count: number): number => {
  const share = turnOf(dx, dy) * count
  const off = Math.abs(share - Math.round(share)) / count
  return off * Math.PI * 2 * Math.hypot(dx, dy)
}

const letterAt = (column: number, row: number): string => {
  const dx = column - MIDDLE
  const dy = row - MIDDLE
  const radius = Math.hypot(dx, dy)
  if (radius > 8.4) {
    return '.'
  }
  if (radius > 7.4) {
    return dx + dy < 0 ? 's' : 'S'
  }
  if (radius > 6.5) {
    return 'L'
  }
  if (radius > 3.6) {
    const petal = Math.floor(turnOf(dx, dy) * PETALS) % PETALS
    return offSpoke(dx, dy, PETALS) < 0.55 ||
      (radius > 4.4 && radius < 5.2 && offSpoke(dx, dy, PETALS) > 1.9)
      ? 'L'
      : (PETAL_COLORS[petal % 2] ?? 'r')
  }
  if (radius > 2.7) {
    return 'L'
  }
  if (radius < 1.2) {
    return 'y'
  }
  const leaf = Math.floor(turnOf(dx, dy) * 4) % 4
  return offSpoke(dx, dy, 4) < 0.5 ? 'L' : (HEART_COLORS[leaf % 2] ?? 'g')
}

const ROSE_PIXELS: ReadonlyArray<string> = Array.makeBy(SIZE, row =>
  Array.join(
    Array.makeBy(SIZE, column => letterAt(column, row)),
    '',
  ),
)

const isRoseGlass = (letter: string): boolean =>
  String.includes(letter)('rbgpy')

const spotOf = (room: Box): Readonly<{ x: number; y: number }> => ({
  x: room.x + 224,
  y: room.y + 2,
})

export const roseGlassOf = (room: Box): Box => {
  const { x, y } = spotOf(room)
  return { x: x + 1, y: y + 1, width: SIZE - 2, height: SIZE - 2 }
}

const GLASS_RUNS: ReadonlyArray<Box> = Array.flatMap(ROSE_PIXELS, (line, row) =>
  Array.filterMap(
    Array.makeBy(SIZE, column => column),
    column => {
      const isGlass = (at: number): boolean =>
        isRoseGlass(String.charAt(line, at).pipe(Option.getOrElse(() => '.')))
      if (!isGlass(column) || (column > 0 && isGlass(column - 1))) {
        return Result.failVoid
      }
      const width = Array.findFirstIndex(
        Array.makeBy(SIZE - column, step => column + step),
        at => !isGlass(at),
      ).pipe(Option.getOrElse(() => SIZE - column))
      return Result.succeed({ x: column, y: row, width, height: 1 })
    },
  ),
)

export const roseLightsOf = (room: Box): ReadonlyArray<Box> => {
  const { x, y } = spotOf(room)
  return Array.map(GLASS_RUNS, run => ({ ...run, x: run.x + x, y: run.y + y }))
}

export const roseWindowShapes = (room: Box): ReadonlyArray<Draw.Shape> => {
  const { x, y } = spotOf(room)
  return pixelArt(x, y, ROSE_PIXELS, ROSE_PALETTE)
}

const GLASS_PALETTE: Readonly<Record<string, string>> = Record.filter(
  ROSE_PALETTE,
  (_, letter) => isRoseGlass(letter),
)

export const roseGlowShapes = (room: Box): ReadonlyArray<Draw.Shape> => {
  const { x, y } = spotOf(room)
  return pixelArt(x, y, ROSE_PIXELS, GLASS_PALETTE)
}
