import { Array, Option, Order, Record, Result, String } from 'effect'
import { describe, expect, test } from 'vitest'

import { TILE_SIZE } from '../../../shared/constants'
import { type Level, closedExits, levelFor } from '../../../world/level/arena'
import {
  ARRANGEMENTS,
  SECRET_EXIT,
  manorSpecFor,
} from '../../../world/level/plan'
import { DOOR_SYMBOLS, WALL_SYMBOL } from '../../../world/level/tileGrid'
import { secretShelfOf } from '../../../world/library/secretShelf'
import {
  FRONT_WALL_ROWS,
  STRETCH,
  UNIT,
  WALL_FACE_ROWS,
  WALL_ROW,
  wallHeightAt,
} from '../space'
import {
  type ArtQuad,
  artAt,
  artQuadsOver,
  fannedX,
  standingTilesOf,
  wallQuadsOf,
} from '../wallQuads'

// The walls as the house stands them (src/render/iso/wallQuads.ts): each
// wall face is one flat quad wearing its art plumb, a row a screen pixel,
// a north wall's top runs the rest of its art on, lit as its face is, every
// shut exit stands as wall, the library's shut secret
// shelf stands as tall as its wall, and no two faces in one plane run into
// each other.

const SLOTS_OPEN = ['Kitchen', 'West', 'East', 'Far']

const houseOf = (
  arrangement: (typeof ARRANGEMENTS)[number],
  isSwung: boolean,
): Level =>
  levelFor(
    manorSpecFor(arrangement),
    isSwung ? [...SLOTS_OPEN, SECRET_EXIT] : SLOTS_OPEN,
  )

const HOUSES = Array.map(
  ARRANGEMENTS,
  (arrangement, house): readonly [number, Level] => [
    house,
    houseOf(arrangement, true),
  ],
)

const symbolAt = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): string => Option.getOrElse(String.charAt(tiles[row] ?? '', column), () => '')

const DOORS: ReadonlyArray<string> = Record.values(DOOR_SYMBOLS)

type Tile = Readonly<{ row: number; column: number }>

// NOTE: every north face of the map, in the level's own rows and columns:
// a wall tile over a tile that is not wall or a doorway, as the 2D game
// drew one.
const northFacesOf = (level: Level): ReadonlyArray<Tile> => {
  const tiles = standingTilesOf(level)
  return Array.flatMap(tiles, (line, row) =>
    Array.flatMap(Array.fromIterable(line), (symbol, column) => {
      const below = symbolAt(tiles, row + 1, column)
      return symbol === WALL_SYMBOL &&
        below !== '' &&
        below !== WALL_SYMBOL &&
        !Array.contains(DOORS, below)
        ? [{ row, column }]
        : []
    }),
  )
}

const isFace = ({ normal }: ArtQuad): boolean => normal[2] === 1
const isTop = ({ normal }: ArtQuad): boolean => normal[1] === 1
const isArt = ({ wears }: ArtQuad): boolean => wears === 'Art'

// NOTE: the tile a quad stands over, off its corners: a top lies over its
// tile, a face stands on its tile's south edge.
const tileOf = (level: Level, quad: ArtQuad): Tile => {
  const xs = Array.map(quad.corners, ([x]) => x)
  const zs = Array.map(quad.corners, ([, , z]) => z)
  const x = (Math.min(...xs) + Math.max(...xs)) / 2 / UNIT - level.left
  const y = Math.min(...zs) / UNIT / STRETCH - level.top
  return {
    row: Math.floor((isFace(quad) ? y - TILE_SIZE / 2 : y + 0.5) / TILE_SIZE),
    column: Math.floor(x / TILE_SIZE),
  }
}

const rowsOf = ({ art }: ArtQuad): readonly [number, number] => {
  const vs = Array.map(art, ([, v]) => v)
  return [Math.min(...vs), Math.max(...vs)]
}

const quadsAt = (
  level: Level,
  { row, column }: Tile,
  is: (quad: ArtQuad) => boolean,
): ReadonlyArray<ArtQuad> =>
  Array.filter(wallQuadsOf(level), quad => {
    const tile = tileOf(level, quad)
    return is(quad) && tile.row === row && tile.column === column
  })

describe('the walls', () => {
  test.each(HOUSES)(
    'house %i: every north face is one flat quad wearing its art plumb',
    (_house, level) => {
      const tiles = standingTilesOf(level)
      Array.forEach(northFacesOf(level), tile => {
        const faces = quadsAt(level, tile, isFace)
        expect(faces).toHaveLength(1)
        const height = wallHeightAt({ tiles, ...tile })
        const rows = Math.round(height / WALL_ROW)
        expect([WALL_FACE_ROWS, FRONT_WALL_ROWS]).toContain(rows)
        const foot = (artAt({ level, ...tile }).row + 1) * TILE_SIZE
        Array.forEach(faces, face => {
          const [top, bottom] = rowsOf(face)
          expect(bottom).toBeCloseTo(foot, 6)
          expect(foot - top).toBeCloseTo(rows, 1)
          // NOTE: upright, with no fold: its corners at two heights only.
          expect(
            new Set(Array.map(face.corners, ([, y]) => y.toFixed(6))).size,
          ).toBe(2)
        })
      })
    },
  )

  // NOTE: each north face with its height in rows, its foot, and the
  // tops of its two tiles of wall.
  const northWallsOf = (level: Level) => {
    const tiles = standingTilesOf(level)
    return Array.map(northFacesOf(level), tile => {
      const isThick = symbolAt(tiles, tile.row - 1, tile.column) === WALL_SYMBOL
      const height = wallHeightAt({ tiles, ...tile })
      return {
        tile,
        rows: Math.round(height / WALL_ROW),
        // NOTE: a tall face with a low front wall behind it (the dining
        // room's top wall under the kitchen): the low tile wears its cap's
        // color, the cap's row.
        isStepped:
          isThick &&
          wallHeightAt({ tiles, ...tile, row: tile.row - 1 }) < height,
        foot: (tile.row + 1) * TILE_SIZE,
        // NOTE: the wall's first row, the cap's: its two tiles' first, or
        // its one's.
        cap: (tile.row - (isThick ? 1 : 0)) * TILE_SIZE,
        tops: [
          ...quadsAt(level, tile, isTop),
          ...(isThick
            ? quadsAt(level, { ...tile, row: tile.row - 1 }, isTop)
            : []),
        ],
      }
    })
  }

  test.each(HOUSES)(
    'house %i: every north wall wears all its art, face and top lit alike, and the night or its cap behind',
    (_house, level) => {
      const walls = northWallsOf(level)
      expect(new Set(Array.map(walls, ({ rows }) => rows))).toEqual(
        new Set([WALL_FACE_ROWS, FRONT_WALL_ROWS]),
      )
      Array.forEach(walls, ({ tile, rows, isStepped, foot, cap, tops }) => {
        const face = Option.getOrThrow(Array.head(quadsAt(level, tile, isFace)))
        // NOTE: the face and the tops' art together run from the cap to
        // the foot with no row left out: the trim, the paper, and the
        // portraits all show, a low front wall's as a tall one's.
        const spans = Array.sort(
          [rowsOf(face), ...Array.map(Array.filter(tops, isArt), rowsOf)],
          Order.Tuple([Order.Number, Order.Number]),
        )
        const reach = Array.reduce(
          spans,
          cap + (isStepped ? 1 : 0),
          (most, [from, to]) => {
            expect(from).toBeLessThanOrEqual(most + 1e-6)
            return Math.max(most, to)
          },
        )
        expect(reach).toBeCloseTo(foot, 6)
        // NOTE: and lit as one, so no crease shows where the face meets
        // its top.
        Array.forEach(tops, top => {
          expect(top.shade).toEqual(face.shade)
        })
        // NOTE: behind its cap a tall wall lies against the night, and a
        // low front wall shows its cap's color, the room beyond round it.
        Array.forEach(
          Array.filter(tops, top => !isArt(top)),
          ({ wears }) => {
            expect(wears).toBe(
              rows === FRONT_WALL_ROWS || isStepped ? 'Cap' : 'Night',
            )
          },
        )
      })
    },
  )

  // NOTE: the floor rows a top lies over, off its corners.
  const depthOf = ({ corners }: ArtQuad): readonly [number, number] => {
    const zs = Array.map(corners, ([, , z]) => z)
    return [Math.min(...zs), Math.max(...zs)]
  }

  test.each(HOUSES)(
    'house %i: no lit top of a wall stands up past the dark behind a cap beside it',
    (_house, level) => {
      const tiles = standingTilesOf(level)
      const nights = Array.filter(
        wallQuadsOf(level),
        quad => isTop(quad) && quad.wears === 'Night',
      )
      expect(nights.length).toBeGreaterThan(0)
      Array.forEach(nights, night => {
        const tile = tileOf(level, night)
        const height = wallHeightAt({ tiles, ...tile })
        const [north, south] = depthOf(night)
        Array.forEach([tile.column - 1, tile.column + 1], column => {
          const beside = { row: tile.row, column }
          if (wallHeightAt({ tiles, ...beside }) !== height) {
            return
          }
          Array.forEach(quadsAt(level, beside, isTop), top => {
            const [from, to] = depthOf(top)
            const isLitOver =
              isArt(top) && from < south - 1e-6 && to > north + 1e-6
            expect(isLitOver).toBe(false)
          })
        })
      })
    },
  )

  test.each(HOUSES)(
    'house %i: every shut exit stands as wall',
    (_house, level) => {
      const tiles = standingTilesOf(level)
      Array.forEach(closedExits(level), exit =>
        Array.forEach(exit.tiles, ({ row, column }) => {
          expect(
            symbolAt(tiles, row - level.topRow, column - level.leftColumn),
          ).toBe(WALL_SYMBOL)
        }),
      )
    },
  )

  test.each(HOUSES)(
    "house %i: what lies over the art is never a wall's plain cap",
    (_house, level) => {
      const over = artQuadsOver({
        level,
        boxes: [
          {
            x: level.left,
            y: level.top,
            width: level.width,
            height: level.height,
          },
        ],
        overWall: 0.006,
        overFloor: 0.014,
      })
      expect(Array.some(over, isFace)).toBe(true)
      expect(Array.some(over, quad => !isArt(quad))).toBe(false)
    },
  )
})

// NOTE: the shelf's four tiles, in the level's own rows and columns.
const shelfTilesOf = (level: Level): ReadonlyArray<Tile> =>
  Option.match(secretShelfOf(level), {
    onNone: () => [],
    onSome: ({ tile, side }) => {
      const behind = side === 'West' ? tile.column - 1 : tile.column + 1
      return Array.flatMap([tile.row, tile.row + 1], row =>
        Array.map([tile.column, behind], column => ({
          row: row - level.topRow,
          column: column - level.leftColumn,
        })),
      )
    },
  })

describe('the secret shelf', () => {
  test.each(
    Array.map(ARRANGEMENTS, (arrangement, house) => [house, arrangement]),
  )(
    'house %i stands it shut as tall as its wall, and swung as floor',
    (_house, arrangement) => {
      const shut = houseOf(arrangement, false)
      const tiles = shelfTilesOf(shut)
      expect(tiles).toHaveLength(4)
      const wall = Array.map(tiles, ({ row, column }) =>
        wallHeightAt({ tiles: standingTilesOf(shut), row, column }),
      )
      const beside = Array.map(tiles, ({ row, column }) =>
        wallHeightAt({ tiles: standingTilesOf(shut), row: row - 1, column }),
      )
      expect(wall).toEqual(beside)
      expect(Array.every(wall, height => height > 1)).toBe(true)
      const swung = houseOf(arrangement, true)
      Array.forEach(shelfTilesOf(swung), ({ row, column }) => {
        expect(symbolAt(standingTilesOf(swung), row, column)).not.toBe(
          WALL_SYMBOL,
        )
      })
    },
  )

  test("its tile behind wears the wall's top just north of it", () => {
    const level = houseOf(Array.headNonEmpty(ARRANGEMENTS), false)
    const shelf = Option.getOrThrow(secretShelfOf(level))
    const shelfTiles = shelfTilesOf(level)
    const own = Option.getOrThrow(Array.head(shelfTiles))
    expect(artAt({ level, ...own })).toEqual(own)
    const top = shelf.tile.row - level.topRow
    const behind = Array.filter(
      shelfTiles,
      ({ column }) => column !== own.column,
    )
    expect(behind.length).toBeGreaterThan(0)
    Array.forEach(behind, ({ row, column }) => {
      const art = artAt({ level, row, column })
      expect(art).toEqual({ row: top - 1, column })
      expect(symbolAt(level.tiles, art.row, art.column)).toBe(WALL_SYMBOL)
      // NOTE: its top wears the borrowed art.
      Array.forEach(quadsAt(level, { row, column }, isTop), quad => {
        const [from] = rowsOf(quad)
        expect(from).toBe(art.row * TILE_SIZE)
      })
    })
  })
})

describe('where a low front wall meets a tall wall', () => {
  const level = houseOf(Array.headNonEmpty(ARRANGEMENTS), true)
  const faces = Array.filter(wallQuadsOf(level), isFace)
  const runsOf = (face: ArtQuad): Readonly<{ west: number; east: number }> => {
    const xs = Array.map(face.corners, ([x]) => x)
    const { column } = tileOf(level, face)
    const west = (level.left + column * TILE_SIZE) * UNIT
    return {
      west: west - Math.min(...xs),
      east: Math.max(...xs) - (west + TILE_SIZE * UNIT),
    }
  }

  test('no two faces side by side run into each other', () => {
    const footFaces = Array.filter(faces, ({ corners }) =>
      Array.some(corners, ([, y]) => y === 0),
    )
    const byTile = new Map(
      Array.map(footFaces, face => {
        const { row, column } = tileOf(level, face)
        return [row * level.columns + column, face] as const
      }),
    )
    const pairs = Array.filterMap(footFaces, face => {
      const { row, column } = tileOf(level, face)
      return Result.fromOption(
        Option.fromNullishOr(byTile.get(row * level.columns + column + 1)),
        () => undefined,
      ).pipe(Result.map(east => [face, east] as const))
    })
    expect(pairs.length).toBeGreaterThan(0)
    Array.forEach(pairs, ([face, east]) => {
      expect(runsOf(face).east).toBeCloseTo(0, 6)
      expect(runsOf(east).west).toBeCloseTo(0, 6)
    })
    // NOTE: a face beside floor still runs out, closing on the jamb.
    expect(Array.some(faces, face => runsOf(face).east > 0.001)).toBe(true)
  })
})

// NOTE: the lens sees a north face's upright lines plumb and its top's run
// north, so the two met in a crease at the seam through its perspective
// (owner, 2026-11-15). A fanned corner of a top's art (`fannedX`) lies in
// the upright plane through the eye and the face's column wearing the same
// column of the picture, so the lens sees the face's column and the top's
// as one straight line, from an eye off to either side.
describe('a north wall seen through the lens', () => {
  const EYE_HEIGHT = 30
  const EYE_BACK = 25
  const EYE_ASIDE = [-18, 18]

  test.each(HOUSES)(
    'house %i: each upright line of a face runs straight on over its top',
    (_house, level) => {
      const quads = wallQuadsOf(level)
      const faces = Array.filter(quads, quad => isFace(quad) && isArt(quad))
      const fannedTops = Array.filter(
        quads,
        quad => isTop(quad) && isArt(quad) && Option.isSome(quad.fan),
      )
      expect(fannedTops.length).toBeGreaterThan(0)
      const offs: Array<number> = []
      Array.forEach(fannedTops, top => {
        const { seam, corners } = Option.getOrThrow(top.fan)
        Array.forEach(corners, corner => {
          const [x, , z] = top.corners[corner] ?? [0, 0, 0]
          const [u] = top.art[corner] ?? [0, 0]
          // NOTE: the face whose top edge lies on the seam and that wears
          // this column of the picture, and where across it stands.
          const face = Array.findFirst(faces, ({ corners: at, art }) => {
            const [[x0, , z0], [x1]] = at
            const [[u0], [u1]] = art
            return (
              Math.abs(z0 - seam) < 1e-9 &&
              u >= u0 - 1e-9 &&
              u <= u1 + 1e-9 &&
              x >= x0 - 1e-9 &&
              x <= x1 + 1e-9
            )
          })
          if (Option.isSome(face)) {
            const { corners: at, art } = face.value
            const [[x0], [x1]] = at
            const [[u0], [u1]] = art
            const faceX = x0 + ((x1 - x0) * (u - u0)) / (u1 - u0)
            Array.forEach(EYE_ASIDE, aside => {
              const eyeX = faceX + aside
              const eyeZ = seam + EYE_BACK
              const fanned = fannedX({ x, z, seam, eyeX, eyeZ })
              // NOTE: the corner, the face's column, and the eye in one
              // upright plane: across over along, measured from the eye.
              const off =
                (faceX - eyeX) * (z - eyeZ) - (seam - eyeZ) * (fanned - eyeX)
              offs.push(Math.abs(off))
            })
          }
        })
      })
      expect(offs.length).toBeGreaterThan(0)
      expect(Math.max(...offs)).toBeLessThan(1e-6 * EYE_HEIGHT)
    },
  )
})
