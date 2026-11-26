import { Array, Option, Order, Result, pipe } from 'effect'

import { TILE_SIZE } from '#shared/constants.ts'
import { type Level, closedExits } from '#world/level/arena.ts'
import { SECRET_EXIT } from '#world/level/plan.ts'
import { WALL_SYMBOL } from '#world/level/tileGrid.ts'
import { secretShelfOf } from '#world/library/secretShelf.ts'

import { LINTEL_FLOOR, lintelTilesOf } from './lintels.ts'
import {
  FRONT_WALL_ROWS,
  SOUTH_NORMAL,
  UNIT,
  UP_NORMAL,
  WALL_ROW,
  isNorthFaceAt,
  symbolAt,
  wallHeightAt,
  zOf,
} from './space.ts'

export type Spot = Readonly<{ row: number; column: number }>

type Standing = Readonly<{
  tiles: ReadonlyArray<string>
  borrowed: ReadonlyMap<number, Spot>
}>

const standings = new WeakMap<Level, Standing>()

const spotKey = (level: Level, row: number, column: number): number =>
  row * level.columns + column

const localOf = (level: Level, { row, column }: Spot): Spot => ({
  row: row - level.topRow,
  column: column - level.leftColumn,
})

const standingOf = (level: Level): Standing => {
  const kept = standings.get(level)
  if (kept !== undefined) {
    return kept
  }
  const shut = Array.flatMap(closedExits(level), exit =>
    Array.map(exit.tiles, tile => localOf(level, tile)),
  )
  const shelf = pipe(
    closedExits(level),
    Array.filter(exit => exit.id === SECRET_EXIT),
    Array.flatMap(exit => Array.map(exit.tiles, tile => localOf(level, tile))),
  )
  const top = Array.reduce(shelf, Infinity, (most, { row }) =>
    Math.min(most, row),
  )
  const shelfColumn = Option.match(secretShelfOf(level), {
    onNone: () => -1,
    onSome: ({ tile }) => tile.column - level.leftColumn,
  })
  const keys = new Set(
    Array.map(shut, ({ row, column }) => spotKey(level, row, column)),
  )
  const standing: Standing = {
    tiles:
      keys.size === 0
        ? level.tiles
        : Array.map(level.tiles, (line, row) =>
            Array.join(
              Array.map(Array.fromIterable(line), (symbol, column) =>
                keys.has(spotKey(level, row, column)) ? WALL_SYMBOL : symbol,
              ),
              '',
            ),
          ),
    borrowed: new Map(
      Array.filterMap(shelf, ({ row, column }) =>
        column === shelfColumn
          ? Result.failVoid
          : Result.succeed([
              spotKey(level, row, column),
              { row: top - 1, column },
            ] as const),
      ),
    ),
  }
  standings.set(level, standing)
  return standing
}

export const standingTilesOf = (level: Level): ReadonlyArray<string> =>
  standingOf(level).tiles

export const artAt = ({
  level,
  row,
  column,
}: Readonly<{ level: Level; row: number; column: number }>): Spot =>
  standingOf(level).borrowed.get(spotKey(level, row, column)) ?? {
    row,
    column,
  }

const isWallTile = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): boolean => Option.contains(symbolAt(tiles, row, column), WALL_SYMBOL)

type FaceArt = Readonly<{
  foot: number
  cap: number
}>

const faceArtOf = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): Option.Option<FaceArt> => {
  const faceRow = isNorthFaceAt({ tiles, row, column })
    ? Option.some(row)
    : isWallTile(tiles, row, column) &&
        isNorthFaceAt({ tiles, row: row + 1, column })
      ? Option.some(row + 1)
      : Option.none()
  return Option.map(faceRow, face => ({
    foot: (face + 1) * TILE_SIZE,
    cap: (isWallTile(tiles, face - 1, column) ? face - 1 : face) * TILE_SIZE,
  }))
}

type Point = readonly [number, number, number]

type ArtPoint = readonly [number, number]

export type ArtQuad = Readonly<{
  corners: readonly [Point, Point, Point, Point]
  art: readonly [ArtPoint, ArtPoint, ArtPoint, ArtPoint]
  normal: Point
  shade: Point
  wears: Wears
  fan: Option.Option<Fan>
}>

type Fan = Readonly<{
  seam: number
  corners: ReadonlyArray<number>
}>

export const NEAREST_SEAM = 1

export const fannedX = (
  input: Readonly<{
    x: number
    z: number
    seam: number
    eyeX: number
    eyeZ: number
  }>,
): number => {
  const { x, z, seam, eyeX, eyeZ } = input
  const reach = eyeZ - seam
  return reach < NEAREST_SEAM ? x : eyeX + ((x - eyeX) * (eyeZ - z)) / reach
}

const NO_FAN: Option.Option<Fan> = Option.none()
const ALL_CORNERS: ReadonlyArray<number> = Array.makeBy(4, corner => corner)
const TOP_CORNERS: ReadonlyArray<number> = [0, 1]

type Wears = 'Art' | 'Cap' | 'Night'

const UP: Point = UP_NORMAL
const SOUTH: Point = SOUTH_NORMAL

const TOP_LIFT = 0.002
const FACE_LIFT = 0.003
export const BLOCK_INSET = 0.003
const EDGE_TEXEL = 0.5
const MID_ROW = 0.5

const xOf = (level: Level, x: number): number => (level.left + x) * UNIT

const zAtRow = (level: Level, y: number): number => zOf(level.top + y)

const topQuad = (
  input: Readonly<{
    level: Level
    column: number
    height: number
    artColumn: number
    from: number
    to: number
    artFrom: number
    artTo: number
    wears: Wears
    shade: Point
    seam: Option.Option<number>
  }>,
): ArtQuad => {
  const { level, column, height, from, to, artFrom, artTo, wears } = input
  const [x0, x1] = [
    xOf(level, column * TILE_SIZE),
    xOf(level, (column + 1) * TILE_SIZE),
  ]
  const left = input.artColumn * TILE_SIZE
  const right = left + TILE_SIZE
  const [z0, z1] = [zAtRow(level, from), zAtRow(level, to)]
  const y = height + TOP_LIFT
  return {
    corners: [
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
      [x0, y, z1],
    ],
    art: [
      [left, artFrom],
      [right, artFrom],
      [right, artTo],
      [left, artTo],
    ],
    normal: UP,
    shade: input.shade,
    wears,
    fan: Option.map(input.seam, seam => ({ seam, corners: ALL_CORNERS })),
  }
}

const besideFaceOf = (
  input: Readonly<{
    tiles: ReadonlyArray<string>
    row: number
    column: number
    height: number
  }>,
): Option.Option<FaceArt> => {
  const { tiles, row, column, height } = input
  const isAsTall = (at: number): boolean =>
    wallHeightAt({ tiles, row, column: at }) === height
  const stepsTo = (way: number): Option.Option<readonly [number, FaceArt]> => {
    for (let at = column + way; isAsTall(at); at += way) {
      const face = faceArtOf(tiles, row, at)
      if (Option.isSome(face)) {
        return Option.some([Math.abs(at - column), face.value])
      }
    }
    return Option.none()
  }
  return Option.map(
    Array.head(
      Array.sort(
        Array.getSomes([stepsTo(-1), stepsTo(1)]),
        Order.mapInput(
          Order.Number,
          ([steps]: readonly [number, FaceArt]) => steps,
        ),
      ),
    ),
    ([, face]) => face,
  )
}

const faceOrBesideOf = (
  input: Readonly<{
    tiles: ReadonlyArray<string>
    row: number
    column: number
    height: number
  }>,
): Option.Option<FaceArt> =>
  Option.orElse(faceArtOf(input.tiles, input.row, input.column), () =>
    besideFaceOf(input),
  )

const seamOf = (
  input: Readonly<{
    level: Level
    tiles: ReadonlyArray<string>
    row: number
    column: number
    height: number
  }>,
): Option.Option<number> =>
  Option.map(faceOrBesideOf(input), ({ foot }) => zAtRow(input.level, foot))

export const isFannedAt = (
  input: Readonly<{ level: Level; row: number; column: number }>,
): boolean => {
  const tiles = standingTilesOf(input.level)
  return Option.isSome(
    seamOf({
      ...input,
      tiles,
      height: wallHeightAt({ tiles, row: input.row, column: input.column }),
    }),
  )
}

const topQuadsOf = (
  input: Readonly<{
    level: Level
    tiles: ReadonlyArray<string>
    row: number
    column: number
    height: number
  }>,
): ReadonlyArray<ArtQuad> => {
  const { level, tiles, row, column, height } = input
  const from = row * TILE_SIZE
  const to = from + TILE_SIZE
  const art = artAt({ level, row, column })
  const at = {
    level,
    column,
    height,
    artColumn: art.column,
    seam: seamOf({ level, tiles, row, column, height }),
  }
  const own = faceArtOf(tiles, row, column)
  const face = faceOrBesideOf({ tiles, row, column, height })
  const capOf = Option.map(face, ({ cap }) => cap)
  const rows = Math.round(height / WALL_ROW)
  const split = Option.match(capOf, {
    onNone: () => from,
    onSome: cap => Math.min(to, Math.max(from, cap + rows)),
  })
  const plainRow = Option.getOrElse(capOf, () => from) + MID_ROW
  const isBehindTaller =
    Option.isSome(own) &&
    !isNorthFaceAt({ tiles, row, column }) &&
    wallHeightAt({ tiles, row: row + 1, column }) > height
  if (isBehindTaller) {
    return [
      topQuad({
        ...at,
        from,
        to,
        artFrom: plainRow,
        artTo: plainRow,
        wears: 'Cap',
        shade: UP,
      }),
    ]
  }
  const isRunOn = Option.isSome(own)
  return [
    ...(split > from
      ? [
          topQuad({
            ...at,
            from,
            to: split,
            artFrom: plainRow,
            artTo: plainRow,
            wears: rows <= FRONT_WALL_ROWS ? 'Cap' : 'Night',
            shade: UP,
          }),
        ]
      : []),
    ...(split < to
      ? [
          topQuad({
            ...at,
            from: split,
            to,
            artFrom: isRunOn
              ? split - rows
              : art.row * TILE_SIZE + split - from,
            artTo: isRunOn ? to - rows : (art.row + 1) * TILE_SIZE,
            wears: 'Art',
            shade: UP,
          }),
        ]
      : []),
  ]
}

const runsToward = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): boolean =>
  !(isWallTile(tiles, row, column) && !isWallTile(tiles, row + 1, column))

const faceQuad = (
  input: Readonly<{
    level: Level
    column: number
    edge: number
    bottom: number
    top: number
    artColumn: number
    foot: number
    runWest: boolean
    runEast: boolean
  }>,
): ArtQuad => {
  const { level, column, edge, bottom, top, artColumn, foot } = input
  const westRun = input.runWest ? FACE_LIFT : 0
  const eastRun = input.runEast ? FACE_LIFT : 0
  const x0 = xOf(level, column * TILE_SIZE) - westRun
  const x1 = xOf(level, (column + 1) * TILE_SIZE) + eastRun
  const lid = top + TOP_LIFT
  const z = zAtRow(level, edge)
  const zAt = (y: number): number =>
    z + (FACE_LIFT * (lid - y)) / (lid - bottom)
  const u0 = artColumn * TILE_SIZE - westRun / UNIT
  const u1 = (artColumn + 1) * TILE_SIZE + eastRun / UNIT
  const [vTop, vBottom] = [foot - lid / WALL_ROW, foot - bottom / WALL_ROW]
  return {
    corners: [
      [x0, lid, zAt(lid)],
      [x1, lid, zAt(lid)],
      [x1, bottom, zAt(bottom)],
      [x0, bottom, zAt(bottom)],
    ],
    art: [
      [u0, vTop],
      [u1, vTop],
      [u1, vBottom],
      [u0, vBottom],
    ],
    normal: SOUTH,
    shade: UP,
    wears: 'Art',
    fan: NO_FAN,
  }
}

const faceQuadsOf = (level: Level): ReadonlyArray<ArtQuad> => {
  const tiles = standingTilesOf(level)
  return [
    ...Array.flatMap(tiles, (line, row) =>
      Array.filterMap(Array.fromIterable(line), (symbol, column) =>
        symbol !== WALL_SYMBOL || isWallTile(tiles, row + 1, column)
          ? Result.failVoid
          : Result.succeed(
              faceQuad({
                level,
                column,
                edge: (row + 1) * TILE_SIZE,
                bottom: 0,
                top: wallHeightAt({ tiles, row, column }),
                artColumn: artAt({ level, row, column }).column,
                foot: (artAt({ level, row, column }).row + 1) * TILE_SIZE,
                runWest: runsToward(tiles, row, column - 1),
                runEast: runsToward(tiles, row, column + 1),
              }),
            ),
      ),
    ),
    ...Array.map(lintelTilesOf(level), ({ row, column, height, art }) =>
      faceQuad({
        level,
        column,
        edge: (row + 1) * TILE_SIZE,
        bottom: LINTEL_FLOOR,
        top: height,
        artColumn: art.column,
        foot: (row + 1) * TILE_SIZE,
        runWest: true,
        runEast: true,
      }),
    ),
  ]
}

const SIDE_IN = BLOCK_INSET / 2

const sideQuadsOf = (level: Level): ReadonlyArray<ArtQuad> => {
  const tiles = standingTilesOf(level)
  return Array.flatMap(tiles, (line, row) =>
    Array.flatMap(Array.fromIterable(line), (symbol, column) => {
      if (symbol !== WALL_SYMBOL) {
        return []
      }
      const top = wallHeightAt({ tiles, row, column })
      const art = artAt({ level, row, column })
      const face = faceArtOf(tiles, row, column)
      const seam = seamOf({ level, tiles, row, column, height: top })
      return Array.filterMap([true, false], isEast => {
        const bottom = wallHeightAt({
          tiles,
          row,
          column: isEast ? column + 1 : column - 1,
        })
        if (bottom >= top) {
          return Result.failVoid
        }
        const west = xOf(level, column * TILE_SIZE)
        const edge = isEast ? west + TILE_SIZE * UNIT : west
        const x = isEast ? edge - SIDE_IN : edge + SIDE_IN
        const lip = top + TOP_LIFT
        const back = zAtRow(level, row * TILE_SIZE)
        const front = zAtRow(level, (row + 1) * TILE_SIZE) + FACE_LIFT
        const u =
          art.column * TILE_SIZE +
          (isEast ? TILE_SIZE - EDGE_TEXEL : EDGE_TEXEL)
        const [vBackTop, vFrontTop, vBackBottom, vFrontBottom] = Option.match(
          face,
          {
            onNone: () => {
              const vBack = art.row * TILE_SIZE
              const vFront = (art.row + 1) * TILE_SIZE + FACE_LIFT / zOf(1)
              return [vBack, vFront, vBack, vFront]
            },
            onSome: ({ foot }) => {
              const [vTop, vBottom] = [
                foot - lip / WALL_ROW,
                foot - bottom / WALL_ROW,
              ]
              return [vTop, vTop, vBottom, vBottom]
            },
          },
        )
        const near = isEast
          ? { z: front, top: vFrontTop, bottom: vFrontBottom }
          : { z: back, top: vBackTop, bottom: vBackBottom }
        const far = isEast
          ? { z: back, top: vBackTop, bottom: vBackBottom }
          : { z: front, top: vFrontTop, bottom: vFrontBottom }
        return Result.succeed<ArtQuad>({
          corners: [
            [edge, lip, near.z],
            [edge, lip, far.z],
            [x, bottom, far.z],
            [x, bottom, near.z],
          ],
          art: [
            [u, near.top],
            [u, far.top],
            [u, far.bottom],
            [u, near.bottom],
          ],
          normal: [isEast ? 1 : -1, 0, 0],
          shade: [isEast ? 1 : -1, 0, 0],
          wears: 'Art',
          fan: Option.map(seam, at => ({ seam: at, corners: TOP_CORNERS })),
        })
      })
    }),
  )
}

const lintelSeamOf = (
  input: Readonly<{
    level: Level
    tiles: ReadonlyArray<string>
    row: number
    column: number
  }>,
): Option.Option<number> => {
  const { level, tiles, row, column } = input
  const seamToward = (way: number): Option.Option<number> => {
    for (
      let at = column + way;
      Option.isSome(symbolAt(tiles, row, at));
      at += way
    ) {
      if (isWallTile(tiles, row, at)) {
        return seamOf({
          level,
          tiles,
          row,
          column: at,
          height: wallHeightAt({ tiles, row, column: at }),
        })
      }
    }
    return Option.none()
  }
  return Option.orElse(seamToward(-1), () => seamToward(1))
}

export const fannedBlocksOf = (level: Level): ReadonlyArray<ArtQuad> => {
  const tiles = standingTilesOf(level)
  return Array.flatMap(tiles, (line, row) =>
    Array.flatMap(Array.fromIterable(line), (symbol, column) => {
      if (symbol !== WALL_SYMBOL) {
        return []
      }
      const height = wallHeightAt({ tiles, row, column })
      return Option.match(seamOf({ level, tiles, row, column, height }), {
        onNone: () => [],
        onSome: seam => {
          const x0 = xOf(level, column * TILE_SIZE) + BLOCK_INSET
          const x1 = xOf(level, (column + 1) * TILE_SIZE) - BLOCK_INSET
          const z0 = zAtRow(level, row * TILE_SIZE) + BLOCK_INSET
          const z1 = zAtRow(level, (row + 1) * TILE_SIZE) - BLOCK_INSET
          const h = height
          const plain = (
            corners: readonly [Point, Point, Point, Point],
            normal: Point,
            fanned: ReadonlyArray<number>,
          ): ArtQuad => ({
            corners,
            art: [
              [0, 0],
              [0, 0],
              [0, 0],
              [0, 0],
            ],
            normal,
            shade: normal,
            wears: 'Cap',
            fan: Option.some({ seam, corners: fanned }),
          })
          return [
            plain(
              [
                [x0, h, z0],
                [x1, h, z0],
                [x1, h, z1],
                [x0, h, z1],
              ],
              UP,
              ALL_CORNERS,
            ),
            plain(
              [
                [x0, h, z1],
                [x1, h, z1],
                [x1, 0, z1],
                [x0, 0, z1],
              ],
              SOUTH,
              TOP_CORNERS,
            ),
            plain(
              [
                [x1, h, z0],
                [x0, h, z0],
                [x0, 0, z0],
                [x1, 0, z0],
              ],
              [0, 0, -1],
              TOP_CORNERS,
            ),
            plain(
              [
                [x1, h, z1],
                [x1, h, z0],
                [x1, 0, z0],
                [x1, 0, z1],
              ],
              [1, 0, 0],
              TOP_CORNERS,
            ),
            plain(
              [
                [x0, h, z0],
                [x0, h, z1],
                [x0, 0, z1],
                [x0, 0, z0],
              ],
              [-1, 0, 0],
              TOP_CORNERS,
            ),
          ]
        },
      })
    }),
  )
}

const builtQuads = new WeakMap<Level, ReadonlyArray<ArtQuad>>()

export const wallQuadsOf = (level: Level): ReadonlyArray<ArtQuad> => {
  const kept = builtQuads.get(level)
  if (kept !== undefined) {
    return kept
  }
  const tiles = standingTilesOf(level)
  const quads = [
    ...Array.flatMap(tiles, (line, row) =>
      Array.flatMap(Array.fromIterable(line), (symbol, column) =>
        symbol === WALL_SYMBOL
          ? topQuadsOf({
              level,
              tiles,
              row,
              column,
              height: wallHeightAt({ tiles, row, column }),
            })
          : [],
      ),
    ),
    ...Array.map(lintelTilesOf(level), ({ row, column, height, art }) =>
      topQuad({
        level,
        column,
        height,
        artColumn: art.column,
        from: row * TILE_SIZE,
        to: (row + 1) * TILE_SIZE,
        artFrom: row * TILE_SIZE + MID_ROW,
        artTo: row * TILE_SIZE + MID_ROW,
        wears: 'Night',
        shade: UP,
        seam: lintelSeamOf({ level, tiles, row, column }),
      }),
    ),
    ...faceQuadsOf(level),
    ...sideQuadsOf(level),
  ]
  builtQuads.set(level, quads)
  return quads
}

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const liftedBy = (quad: ArtQuad, lift: number): ArtQuad => {
  const [nx, ny, nz] = quad.normal
  const lifted = ([x, y, z]: Point): Point => [
    x + nx * lift,
    y + ny * lift,
    z + nz * lift,
  ]
  const [c0, c1, c2, c3] = quad.corners
  return { ...quad, corners: [lifted(c0), lifted(c1), lifted(c2), lifted(c3)] }
}

const tilesUnder = (level: Level, boxes: ReadonlyArray<Box>): Set<number> => {
  const keys = new Set<number>()
  Array.forEach(boxes, ({ x, y, width, height }) => {
    for (
      let row = Math.floor(y / TILE_SIZE);
      row <= Math.floor((y + height - 1) / TILE_SIZE);
      row += 1
    ) {
      for (
        let column = Math.floor(x / TILE_SIZE);
        column <= Math.floor((x + width - 1) / TILE_SIZE);
        column += 1
      ) {
        keys.add(spotKey(level, row, column))
      }
    }
  })
  return keys
}

const isOver = (level: Level, quad: ArtQuad, keys: Set<number>): boolean => {
  const us = Array.map(quad.art, ([u]) => u)
  const vs = Array.map(quad.art, ([, v]) => v)
  const [left, right] = [Math.min(...us), Math.max(...us)]
  const [top, bottom] = [Math.min(...vs), Math.max(...vs)]
  for (
    let row = Math.floor(top / TILE_SIZE);
    row < Math.ceil(bottom / TILE_SIZE);
    row += 1
  ) {
    for (
      let column = Math.floor(left / TILE_SIZE);
      column < Math.ceil(right / TILE_SIZE);
      column += 1
    ) {
      if (keys.has(spotKey(level, row, column))) {
        return true
      }
    }
  }
  return false
}

export const artQuadsOver = (
  input: Readonly<{
    level: Level
    boxes: ReadonlyArray<Box>
    overWall: number
    overFloor: number
  }>,
): ReadonlyArray<ArtQuad> => {
  const { level, overWall, overFloor } = input
  const keys = tilesUnder(
    level,
    Array.map(input.boxes, box => ({
      ...box,
      x: box.x - level.left,
      y: box.y - level.top,
    })),
  )
  const tiles = standingTilesOf(level)
  const walls = Array.filterMap(wallQuadsOf(level), quad =>
    quad.wears === 'Art' && isOver(level, quad, keys)
      ? Result.succeed(liftedBy(quad, overWall))
      : Result.failVoid,
  )
  const floors = Array.flatMap(tiles, (line, row) =>
    Array.filterMap(Array.fromIterable(line), (symbol, column) => {
      if (symbol === WALL_SYMBOL) {
        return Result.failVoid
      }
      const quad = topQuad({
        level,
        column,
        artColumn: column,
        height: overFloor - TOP_LIFT,
        from: row * TILE_SIZE,
        to: (row + 1) * TILE_SIZE,
        artFrom: row * TILE_SIZE,
        artTo: (row + 1) * TILE_SIZE,
        wears: 'Art',
        shade: UP,
        seam: Option.none(),
      })
      return isOver(level, quad, keys) ? Result.succeed(quad) : Result.failVoid
    }),
  )
  return [...walls, ...floors]
}
