import { Array, Option, Record, String } from 'effect'

import { type Sprite, TOP_LEFT, spriteShapes } from '#art/sprite.ts'
import { BOOK_COLORS } from '#render/room/roomCover.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import { unitOf } from '#shared/prng.ts'
import { LIBRARY_MAP, STACK_DROPS } from '#world/level/plan.ts'
import type { StackId } from '#world/library/stacks.ts'
import { clamp } from '#world/step/geometry.ts'

const MAIN_LETTERS: ReadonlyArray<string> = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const SHADE_LETTERS: ReadonlyArray<string> = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const letterOf = (letters: ReadonlyArray<string>, index: number): string =>
  letters[index] ?? 'x'
const SHADES: ReadonlyArray<string> = [
  '#4e1524',
  '#1d3b33',
  '#3a2859',
  '#7a5428',
  '#27324e',
  '#5a301b',
  '#2f4425',
]

const PALETTE: Readonly<Record<string, string>> = {
  ...Record.fromEntries(
    Array.map(BOOK_COLORS, (color, index) => [
      letterOf(MAIN_LETTERS, index),
      color,
    ]),
  ),
  ...Record.fromEntries(
    Array.map(SHADES, (color, index) => [
      letterOf(SHADE_LETTERS, index),
      color,
    ]),
  ),
  p: '#d6c7a0',
  q: '#9e8e6c',
  h: '#a88a4a',
  x: '#1e140d',
}

const LOW = 3
const HEADROOM = 3

type Grid = Array<Array<string>>

const put = (grid: Grid, x: number, y: number, letter: string): void => {
  const row = grid[y]
  if (row !== undefined && x >= 0 && x < row.length) {
    row[x] = letter
  }
}

const isSolidAt = (grid: Grid, x: number, y: number): boolean => {
  const letter = grid[y]?.[x]
  return letter !== undefined && letter !== '.'
}

const topOf = (grid: Grid, x: number): number =>
  Option.getOrElse(
    Array.findFirstIndex(grid, (_, y) => isSolidAt(grid, x, y)),
    () => grid.length - 1,
  )

type Book = Readonly<{
  x: number
  level: number
  length: number
  thick: number
  color: number
  tilt: number
  isOpenSide: boolean
}>

const drawBook = (grid: Grid, book: Book): void => {
  const floor = grid.length - 1
  const main = letterOf(MAIN_LETTERS, book.color)
  const shade = letterOf(SHADE_LETTERS, book.color)
  for (let index = 0; index < book.length; index += 1) {
    const lift =
      book.tilt > 0
        ? Math.floor(index / 3)
        : book.tilt < 0
          ? Math.floor((book.length - 1 - index) / 3)
          : 0
    const bottom = floor - book.level - lift
    const isBand =
      book.length >= 6 && (index === 1 || index === book.length - 2)
    for (let row = 0; row < book.thick; row += 1) {
      const y = bottom - row
      const isTop = row === book.thick - 1
      const letter =
        row === 0
          ? shade
          : book.isOpenSide && !isTop
            ? index === 0 || index === book.length - 1
              ? main
              : 'p'
            : isBand && !book.isOpenSide
              ? 'h'
              : main
      put(grid, book.x + index, y, letter)
    }
  }
}

const TENT: ReadonlyArray<string> = ['..c..', '.cpc.', 'cpqpc']

const drawTent = (grid: Grid, x: number, color: number): void => {
  const foot = topOf(grid, x + 2)
  Array.forEach(TENT, (row, index) => {
    Array.forEach(String.split(row, ''), (letter, column) => {
      if (letter !== '.') {
        put(
          grid,
          x + column,
          foot - TENT.length + 1 + index,
          letter === 'c' ? letterOf(MAIN_LETTERS, color) : letter,
        )
      }
    })
  })
}

const drawPage = (grid: Grid, x: number): void => {
  const foot = topOf(grid, x + 1) - 1
  put(grid, x, foot + 1, 'q')
  put(grid, x + 1, foot, 'p')
  put(grid, x + 2, foot, 'p')
}

const heapRowArt = (
  input: Readonly<{ width: number; peak: number; seed: number }>,
): ReadonlyArray<string> => {
  const { width, peak, seed } = input
  const height = peak + HEADROOM
  let draws = 0
  const next = (): number => {
    draws += 1
    return unitOf(seed * 7919 + draws * 104729)
  }
  const grid: Grid = Array.makeBy(height, () => Array.makeBy(width, () => '.'))
  const profileAt = (x: number): number => {
    const t = (clamp(x, 0, width - 1) + 0.5 - width / 2) / (width / 2)
    return Math.round(LOW + (peak - LOW) * (1 - t * t))
  }
  for (let x = 0; x < width; x += 1) {
    for (let up = 0; up < profileAt(x) - 2; up += 1) {
      put(grid, x, height - 1 - up, 'x')
    }
  }
  for (let level = 0; level < peak; level += 2) {
    let x = -Math.floor(next() * 4)
    while (x < width) {
      const length = 3 + Math.floor(next() * 6)
      const thick = next() < 0.35 ? 3 : 2
      const tiltRoll = next()
      const tilt = tiltRoll < 0.15 ? -1 : tiltRoll < 0.3 ? 1 : 0
      const sink = next() < 0.25 ? 1 : 0
      const color = Math.floor(next() * MAIN_LETTERS.length)
      const isOpenSide = thick === 3 && next() < 0.5
      const isUnderTop = Array.every(
        Array.makeBy(length, index => index),
        index => profileAt(x + index) >= level + thick - 1,
      )
      if (isUnderTop) {
        drawBook(grid, {
          x,
          level: Math.max(0, level - sink),
          length,
          thick,
          color,
          tilt,
          isOpenSide,
        })
      }
      x += isUnderTop ? length + (next() < 0.2 ? 1 : 0) : 1
    }
  }
  const tents = width >= 30 ? 2 : 1
  for (let index = 0; index < tents; index += 1) {
    const share = (index + 1) / (tents + 1)
    const at = Math.round(width * share) - 2 + Math.floor(next() * 3) - 1
    drawTent(
      grid,
      clamp(at, 0, width - 5),
      Math.floor(next() * MAIN_LETTERS.length),
    )
  }
  drawPage(grid, clamp(Math.floor(next() * (width - 3)), 0, width - 3))
  return Array.map(grid, row => Array.join(row, ''))
}

const heapSizeOf = (
  id: StackId,
): Readonly<{ columns: number; rows: number }> => {
  const { symbol } = STACK_DROPS[id]
  const rows = Array.filter(LIBRARY_MAP, row => String.includes(symbol)(row))
  return {
    rows: rows.length,
    columns: Array.reduce(rows, 0, (most, row) =>
      Math.max(most, String.split(row, symbol).length - 1),
    ),
  }
}

const peaksOf = (rows: number): ReadonlyArray<number> =>
  rows >= 3
    ? Array.makeBy(rows, row => (row === Math.floor(rows / 2) ? 12 : 8))
    : Array.makeBy(rows, row => (row === 0 ? 12 : 9))

export type HeapRow = Readonly<{ sprite: Sprite; height: number }>

const heapRowsOf = (id: StackId, seed: number): ReadonlyArray<HeapRow> => {
  const { columns, rows } = heapSizeOf(id)
  return Array.map(peaksOf(rows), (peak, row) => {
    const art = heapRowArt({
      width: columns * TILE_SIZE,
      peak,
      seed: seed + row * 31,
    })
    return {
      sprite: spriteShapes(art, PALETTE, TOP_LEFT),
      height: art.length,
    }
  })
}

export const HEAP_ROWS: Readonly<Record<StackId, ReadonlyArray<HeapRow>>> = {
  NorthStack: heapRowsOf('NorthStack', 11),
  SouthStack: heapRowsOf('SouthStack', 47),
}

export const BOOK_PALETTE = PALETTE
