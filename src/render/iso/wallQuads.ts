// The walls as the house stands them, as plain data (src/render/iso/
// house.ts builds their meshes): the map with every shut exit as wall, the
// art each wall tile wears, and a quad for every wall top, face, and side
// the lens can see, each with the corners of the room's picture it wears.
// The storm and the house's glows lie over the same quads (`artQuadsOver`),
// so they land on the art wherever it stands.

import { Array, Option, Order, Result, pipe } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import { type Level, closedExits } from '../../world/level/arena'
import { SECRET_EXIT } from '../../world/level/plan'
import { WALL_SYMBOL } from '../../world/level/tileGrid'
import { secretShelfOf } from '../../world/library/secretShelf'
import { LINTEL_FLOOR, lintelTilesOf } from './lintels'
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
} from './space'

// STANDING

// NOTE: the map as the house stands it: the level's tiles with every shut
// exit as wall, as the 2D game drew one (src/render/room/roomWalls.ts), so
// a boarded door stands in its wall with its boards up its face, and the
// library's shut secret shelf (src/world/library/secretShelf.ts) stands as
// tall as the side wall it is set in, the carved case on its face
// (src/render/room/shelfCarve.ts) all that stands proud of it. The shelf's
// tile behind it, in the next room's wall, has no art of its own, so it
// wears the top of the wall just north of the shelf. Opened, an exit's
// tiles are floor, a passage through the wall. Kept per level.
export type Spot = Readonly<{ row: number; column: number }>

type Standing = Readonly<{
  tiles: ReadonlyArray<string>
  // NOTE: the tile whose art a tile wears, by `row:column`, where it is
  // not its own.
  borrowed: ReadonlyMap<number, Spot>
}>

const standings = new WeakMap<Level, Standing>()

// NOTE: a tile's index in the level's rows, columns across.
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

// NOTE: the tile whose art a standing wall tile wears.
export const artAt = ({
  level,
  row,
  column,
}: Readonly<{ level: Level; row: number; column: number }>): Spot =>
  standingOf(level).borrowed.get(spotKey(level, row, column)) ?? { row, column }

const isWallTile = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): boolean => Option.contains(symbolAt(tiles, row, column), WALL_SYMBOL)

// THE ART'S ROWS

// NOTE: the picture's rows, a game pixel each from the level's top left
// (the room's picture, src/render/room/room.ts), as the quads wear them.
// A north wall wears the 2D game's wall where the lens sees it, a row a
// screen pixel: its face stands its art plumb from its foot up, as tall as
// the wall (space.ts), and its top runs the same picture on from the face's
// top edge back to the cap, lit alike, so face and top read as one wall
// with its paper, its portraits, and its trim, as the 2D game drew them,
// and no crease between them (owner, 2026-11-15: the top walls were folded
// in). The top runs back past the cap by the wall's height: that part is
// plain, black as the night round the house behind a tall wall (house.ts
// `buildWallDark`), so the wall ends at its slim cap, and the cap's own
// color behind a low front wall, where the room beyond shows round it.
type FaceArt = Readonly<{
  // NOTE: the picture's row at the face's foot.
  foot: number
  // NOTE: the first row of the wall's art, the cap's.
  cap: number
}>

// NOTE: the north face a wall tile's top runs back from: its own, or the
// one just south of it, of the wall the 2D game drew over two tiles.
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

// QUADS

type Point = readonly [number, number, number]

// NOTE: a point of the room's picture, in its game pixels from its top
// left, across and down.
type ArtPoint = readonly [number, number]

// NOTE: one quad of the walls: its corners in the world, top left first as
// it is seen from its outside and on round, the point of the picture each
// corner wears, its normal, and the normal it is lit by (a north wall's
// face is lit as its top). A plain quad wears one row of the picture along
// its depth (a wall's cap), so nothing laid over the art lands on it: the
// cap's own color, lit, where the room beyond shows round it (a low front
// wall), or black as the night round the house behind a tall wall.
export type ArtQuad = Readonly<{
  corners: readonly [Point, Point, Point, Point]
  art: readonly [ArtPoint, ArtPoint, ArtPoint, ArtPoint]
  normal: Point
  shade: Point
  wears: Wears
}>

type Wears = 'Art' | 'Cap' | 'Night'

const UP: Point = UP_NORMAL
const SOUTH: Point = SOUTH_NORMAL

// NOTE: just over the block's own top, so the two never fight.
const TOP_LIFT = 0.002
// NOTE: just in front of the block's own face, so the two never fight.
const FACE_LIFT = 0.003
// NOTE: each block stands this far inside its tile, across and along, so
// the art over its front and its open sides, lifted off its tile's edges
// (FACE_LIFT), closes round it: no sliver of the plain block shows at a
// corner where two of them meet, as one did down every doorway's jambs.
export const BLOCK_INSET = 0.003
// NOTE: half a texel in from the tile's edge, so a side samples its own
// tile's edge column and never its neighbor's.
const EDGE_TEXEL = 0.5
// NOTE: the middle of a row, so a plain quad samples that row alone.
const MID_ROW = 0.5

const xOf = (level: Level, x: number): number => (level.left + x) * UNIT

const zAtRow = (level: Level, y: number): number => zOf(level.top + y)

// NOTE: the top over the picture's rows `from` to `to` of a tile at
// `height`, wearing the rows `art` gives each.
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
  }
}

// NOTE: the north face nearest along the row through the wall as tall
// as this tile, east or west: a side wall's, two tiles thick at most,
// meeting a north wall.
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
  // NOTE: the steps to the face each way, while the wall runs on as tall.
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

// NOTE: a wall tile's top: its own art, or over a north face (its own or
// the one south of it) the face's picture run on, each floor row wearing
// the row the lens sees there, the wall's height in rows higher, and plain
// behind the cap. A top beside a north wall's as tall (a side wall's, where
// it meets one) is plain over the same rows, so it never stands up past
// the cap.
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
  const at = { level, column, height, artColumn: art.column }
  const own = faceArtOf(tiles, row, column)
  const capOf = Option.match(own, {
    onSome: ({ cap }) => Option.some(cap),
    onNone: () =>
      Option.map(
        besideFaceOf({ tiles, row, column, height }),
        ({ cap }) => cap,
      ),
  })
  // NOTE: the floor row whose top the lens sees where the cap's first row
  // is: the wall's height in rows south of the cap.
  const rows = Math.round(height / WALL_ROW)
  const split = Option.match(capOf, {
    onNone: () => from,
    onSome: cap => Math.min(to, Math.max(from, cap + rows)),
  })
  const plainRow = Option.getOrElse(capOf, () => from) + MID_ROW
  // NOTE: a low tile behind a taller north face (the dining room's top
  // wall, the kitchen's front wall behind it) lies under that face's top,
  // which wears the art: it shows only a sliver past it, its cap's color.
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

// NOTE: whether a face runs out past its tile's end toward a neighbor: not
// toward a wall that has its own south face in the same row, the low front
// wall a tall corner meets or a wall beside it, whose face lies in the same
// plane. Two faces run into each other there fought over the strip they
// shared (owner, 2026-11-15: the step where a front wall meets a side wall).
const runsToward = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): boolean =>
  !(isWallTile(tiles, row, column) && !isWallTile(tiles, row + 1, column))

// NOTE: a face over the floor row `edge` (a game pixel row of the picture),
// from `bottom` to `top`, wearing the art of `artColumn` read from `foot`
// up, a row each `WALL_ROW`. It leans in its lift's depth from its top to
// its foot, so its top edge meets the top's edge exactly.
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
  // NOTE: run out past the tile's ends to the sides' plane (FACE_LIFT),
  // its art run on with it, so a jamb's corner closes with no notch.
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
  }
}

// NOTE: every wall face the lens sees: a wall tile's south side over
// floor, from the floor to its top, and a lintel's from its floor to its
// top, each its tile's art read from its foot up. A tall wall beside a low
// front wall wears its own art from the same foot, so the low wall's
// skirting runs on into it at its height.
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
    // NOTE: a lintel's face stands a tile back, over its doorway's near
    // row, and wears the wall beside it where the lens sees it, read from
    // its own edge up: the cap's dark band run on over the opening.
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

// NOTE: the lens is turned a little off north (src/render/lens.ts) and sees
// through a slight perspective, so beside a wall's front it sees one of its
// sides: a doorway's jambs, the end of a wall, a side wall's face. A north
// wall's side wears the column of its face's art on that edge at the
// face's heights, so the casing, the chair rail, and the skirting turn the
// corner into a doorway; any other wall's wears its top's edge column run
// from the tile's back to its front and stood up the wall, a wall's dark
// edge down its end, where the plain block showed slivers of grey.
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
      return Array.filterMap([true, false], isEast => {
        // NOTE: what stands beside hides the side up to its own height:
        // nothing over the floor, a doorway, or the dark round the house
        // (a wall's end on the house's edge, which the lens sees past the
        // turn), a lower wall's height beside a low front wall.
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
        // NOTE: just inside its own tile, between the tile's edge and the
        // inset block (BLOCK_INSET), so the look pass colors it by its own
        // room's ramp (look.ts reads the room off the tile under a
        // fragment), never the next room's or the black round the house.
        const x = isEast ? edge - SIDE_IN : edge + SIDE_IN
        // NOTE: its top edge meets the top's edge exactly, at its lift,
        // leaning in the lift's width, so no line of the block shows
        // between them along a wall's top; it runs on to the front's plane
        // (FACE_LIFT) to meet a wall's front face at the corner.
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
        // NOTE: corners in the order a front face takes them, top left
        // first as the side is seen from out in the room: the front first
        // on an east side, the back first on a west one.
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
        })
      })
    }),
  )
}

const builtQuads = new WeakMap<Level, ReadonlyArray<ArtQuad>>()

// NOTE: every quad of the walls the house stands for a level, kept per
// level: the tops of the walls and the lintels, the faces, and the sides.
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
    // NOTE: a lintel's top is the wall's plain cap, as the wall's beside
    // it is over the same rows, lit as its face.
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
      }),
    ),
    ...faceQuadsOf(level),
    ...sideQuadsOf(level),
  ]
  builtQuads.set(level, quads)
  return quads
}

// OVER THE ART

// NOTE: a box of the picture, in the world's game pixels.
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

// NOTE: every tile of the picture any of `boxes` touches (in its own
// pixels), by index.
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

// NOTE: whether a quad wears any of the picture on the tiles `keys` holds:
// the few tiles its art spans (a face's two, a top's one).
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

// NOTE: a quad over every part of the walls or the floor that wears any of
// `boxes` (in the world's game pixels), lifted just off what it lies on, so
// a picture painted over the room's (the storm on the glass, a window's
// glow) lands on its art: on a wall's face where the art stands up it, on
// its top or the floor where it lies. Never a wall's plain cap.
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
      })
      return isOver(level, quad, keys) ? Result.succeed(quad) : Result.failVoid
    }),
  )
  return [...walls, ...floors]
}
