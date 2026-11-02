import type { Vector } from './worldSchema'

// NOTE: a uniform grid for the checks between nearby things (zombies pushing
// apart, a bullet's sweep). It is built from scratch whenever a step needs it,
// by a counting sort of entity indices into two Int32Arrays, and thrown away
// with the step: a pure function of the list, never stored on the World and
// never kept between ticks. Typed arrays are allocated per build, not shared
// in a module buffer, so a Grid can be held across calls (a step builds two
// at once, or the room steps while a test still holds one) with nothing to
// clear or to get stale. Each is private to the step that built it.
//
// NOTE: a query hands back the original list's indices in ASCENDING order,
// exactly the order a loop over the whole list visits them. Summing floats and
// "who is first" (the lowest index wins a tie) therefore come out bit for bit
// as the all-pairs loops did. A query returns a superset of what is in reach
// (whole cells): the caller keeps its exact test.

export type Grid = Readonly<{
  minX: number
  minY: number
  inverseCellPx: number
  cols: number
  rows: number
  // cell c holds items[starts[c] .. starts[c + 1]), each cell ascending
  starts: Int32Array
  items: Int32Array
}>

// NOTE: a spread-out list (a zombie far outside) widens the cells instead of
// growing the grid, so the cell count stays bounded.
const MAX_CELLS_PER_SIDE = 48

const cellAt = (
  value: number,
  origin: number,
  inverse: number,
  count: number,
) => Math.min(count - 1, Math.max(0, Math.floor((value - origin) * inverse)))

export const buildGrid = <Point extends Vector>(
  points: ReadonlyArray<Point>,
  isIncluded: (point: Point) => boolean,
  minCellPx: number,
): Grid => {
  const size = points.length
  const included = new Uint8Array(size)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let index = 0; index < size; index++) {
    const point = points[index]
    if (point !== undefined && isIncluded(point)) {
      included[index] = 1
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (minX > maxX) {
    return {
      minX: 0,
      minY: 0,
      inverseCellPx: 1,
      cols: 1,
      rows: 1,
      starts: new Int32Array(2),
      items: new Int32Array(0),
    }
  }

  const cellPx = Math.max(
    minCellPx,
    (maxX - minX) / MAX_CELLS_PER_SIDE,
    (maxY - minY) / MAX_CELLS_PER_SIDE,
  )
  const inverseCellPx = 1 / cellPx
  const cols = Math.floor((maxX - minX) * inverseCellPx) + 1
  const rows = Math.floor((maxY - minY) * inverseCellPx) + 1
  const starts = new Int32Array(cols * rows + 1)
  const cellOf = new Int32Array(size)
  let count = 0
  for (let index = 0; index < size; index++) {
    const point = points[index]
    if (included[index] === 1 && point !== undefined) {
      const cell =
        cellAt(point.y, minY, inverseCellPx, rows) * cols +
        cellAt(point.x, minX, inverseCellPx, cols)
      cellOf[index] = cell
      starts[cell + 1] = (starts[cell + 1] ?? 0) + 1
      count++
    }
  }
  for (let cell = 0; cell < cols * rows; cell++) {
    starts[cell + 1] = (starts[cell + 1] ?? 0) + (starts[cell] ?? 0)
  }
  const fill = starts.slice(0, cols * rows)
  const items = new Int32Array(count)
  for (let index = 0; index < size; index++) {
    if (included[index] === 1) {
      const cell = cellOf[index] ?? 0
      items[fill[cell] ?? 0] = index
      fill[cell] = (fill[cell] ?? 0) + 1
    }
  }
  return { minX, minY, inverseCellPx, cols, rows, starts, items }
}

// NOTE: room for any query's answer: one list of candidates per caller, reused
// across that caller's queries within one step.
export const queryBuffer = (grid: Grid): Int32Array =>
  new Int32Array(grid.items.length)

const INSERTION_SORT_MAX = 24

// NOTE: writes into `out` the indices of every included point in the cells
// that touch the box, in ascending order, and returns how many.
export const queryBox = (
  grid: Grid,
  out: Int32Array,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number => {
  const { minX, minY, inverseCellPx, cols, rows, starts, items } = grid
  const firstCol = cellAt(fromX, minX, inverseCellPx, cols)
  const lastCol = cellAt(toX, minX, inverseCellPx, cols)
  const firstRow = cellAt(fromY, minY, inverseCellPx, rows)
  const lastRow = cellAt(toY, minY, inverseCellPx, rows)
  let count = 0
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const cell = row * cols + col
      const end = starts[cell + 1] ?? 0
      for (let at = starts[cell] ?? 0; at < end; at++) {
        out[count] = items[at] ?? 0
        count++
      }
    }
  }
  if (count > INSERTION_SORT_MAX) {
    out.subarray(0, count).sort()
  } else {
    for (let next = 1; next < count; next++) {
      const value = out[next] ?? 0
      let at = next - 1
      while (at >= 0 && (out[at] ?? 0) > value) {
        out[at + 1] = out[at] ?? 0
        at--
      }
      out[at + 1] = value
    }
  }
  return count
}

// NOTE: the same, for the cells within `reachPx` of a point.
export const queryAround = (
  grid: Grid,
  out: Int32Array,
  center: Vector,
  reachPx: number,
): number =>
  queryBox(
    grid,
    out,
    center.x - reachPx,
    center.y - reachPx,
    center.x + reachPx,
    center.y + reachPx,
  )
