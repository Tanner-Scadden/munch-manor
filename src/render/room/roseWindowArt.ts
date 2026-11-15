// The library's rose window: a round stained-glass window high in the
// north wall over the reading nook, between the stopped clock and the map,
// over clear floor, so the colored light it throws lands where the crew
// walks, clear of the stacks and the secret shelf. Its glass is worked
// out from a wheel (eight petals round a four-leaf middle in lead), not
// drawn by hand, so the art and the light it throws read off one grid
// (src/render/iso/godRays.ts, src/render/iso/emissives.ts).

import { Array, Record, String } from 'effect'
import type { Canvas } from 'foldkit'

import { pixelArt } from '../drawing'
import type { Box } from './roomPalette'

// NOTE: the window's size in game pixels, its stone ring included.
const SIZE = 17
const MIDDLE = (SIZE - 1) / 2

// NOTE: the glass colors by letter: `L` is the lead between the panes, `S`
// and `s` the stone ring and its lit edge.
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

// NOTE: the share of a turn round the middle, 0 to 1, from the top going
// clockwise.
const turnOf = (dx: number, dy: number): number =>
  (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1

// NOTE: how far a pixel's middle sits from the nearest of `count` spokes,
// in pixels along its ring.
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

// NOTE: the window's pixel map, one letter a game pixel.
const ROSE_PIXELS: ReadonlyArray<string> = Array.makeBy(SIZE, row =>
  Array.join(
    Array.makeBy(SIZE, column => letterAt(column, row)),
    '',
  ),
)

// NOTE: whether a letter is colored glass, which glows and throws light.
const isRoseGlass = (letter: string): boolean =>
  String.includes(letter)('rbgpy')

const spotOf = (room: Box): Readonly<{ x: number; y: number }> => ({
  x: room.x + 224,
  y: room.y + 2,
})

// NOTE: the glass inside the stone ring, where the storm rains and its light
// leaves from.
export const roseGlassOf = (room: Box): Box => {
  const { x, y } = spotOf(room)
  return { x: x + 1, y: y + 1, width: SIZE - 2, height: SIZE - 2 }
}

export const roseWindowShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const { x, y } = spotOf(room)
  return pixelArt(x, y, ROSE_PIXELS, ROSE_PALETTE)
}

// NOTE: the glass alone, for the glow laid over it in the dark.
const GLASS_PALETTE: Readonly<Record<string, string>> = Record.filter(
  ROSE_PALETTE,
  (_, letter) => isRoseGlass(letter),
)

export const roseGlowShapes = (room: Box): ReadonlyArray<Canvas.Shape> => {
  const { x, y } = spotOf(room)
  return pixelArt(x, y, ROSE_PIXELS, GLASS_PALETTE)
}
