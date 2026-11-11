import { Array, Function, Option, Order, Result, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import { bakeShapes } from '../art/sprite'
import { isCellarLit } from '../world/cellar/bulb'
import { type Room, levelOf } from '../world/level/arena'
import { CELLAR_ROOM_ID } from '../world/level/plan'
import { focusOf, playersOf } from '../world/party/party'
import type { World } from '../world/schema/world'
import type { Vector, Zombie } from '../world/schema/worldSchema'
import type { Camera } from './camera'
import { rect } from './drawing'
import { CELLAR_BULB_OFFSET } from './room/room'

// The cellar's twist (docs/ROOM_DRAFTS.md): it is dark but for a pool round
// each player, the flash of each shot, and the one bare bulb, and a zombie
// in the dark is not drawn at all until it is close to the viewing player
// (DARK_SIGHT): only its footsteps give it away. Yanking the bulb's chain
// (src/world/cellar/bulb.ts) lifts the dark for a while. It is a client
// cosmetic, read off the World each frame and never stored.
//
// The dark is drawn over the part of the cellar on the camera, cut along
// the edges of each light's square into a few pieces: a piece no light
// reaches is one dark rect, a piece one light reaches is a crop of that
// light's pool, a square image baked once (dark corners, two dim rings, a
// clear middle), and a piece two lights reach (where pools meet) is a few
// coarse cells, each as dark as its nearest light leaves it. One player
// costs about a dozen shapes. A zombie in the dark is not drawn at all, so
// the dark costs less than the zombies it hides.

// LIGHTS

// NOTE: a light's pool: clear inside LIT of its radius, then two dim rings,
// then dark.
type Light = Readonly<{ x: number; y: number; radius: number }>

const PLAYER_LIGHT_PX = 46
const FLASH_LIGHT_PX = 62
const BULB_LIGHT_PX = 30
const LIT = 0.55
const DIM = 0.8

// NOTE: the bulb's pool on the floor, a little below the glass where its
// art hangs.
const BULB_DROP_PX = 8

const BULB_GLASS = {
  x: CELLAR_BULB_OFFSET.x,
  y: CELLAR_BULB_OFFSET.y + BULB_DROP_PX,
}

type Shade = 'Lit' | 'Glow' | 'Dim' | 'Dark'

const SHADE_FILLS: Readonly<Record<Exclude<Shade, 'Lit'>, string>> = {
  Glow: 'rgba(6, 4, 10, 0.42)',
  Dim: 'rgba(6, 4, 10, 0.7)',
  Dark: 'rgba(6, 4, 10, 0.93)',
}

const shadeOfReach = (reach: number): Shade => {
  if (reach < LIT) {
    return 'Lit'
  } else if (reach < DIM) {
    return 'Glow'
  } else if (reach < 1) {
    return 'Dim'
  }
  return 'Dark'
}

const shadeAt = (lights: ReadonlyArray<Light>, x: number, y: number): Shade =>
  shadeOfReach(
    Array.reduce(lights, Infinity, (nearest, light) =>
      Math.min(nearest, Math.hypot(x - light.x, y - light.y) / light.radius),
    ),
  )

// POOLS

// NOTE: a pool's square, 2 radius across, as one baked image: each pixel
// row's runs of one shade, the clear middle left out.
const poolShapes = (radius: number): ReadonlyArray<Canvas.Shape> => {
  const size = radius * 2
  const light: Light = { x: radius, y: radius, radius }
  return Array.flatMap(
    Array.makeBy(size, row => row),
    row =>
      Array.filterMap(
        Array.reduce(
          Array.makeBy(size, column => column),
          NO_RUNS,
          (runs, column) => {
            const shade = shadeAt([light], column + 0.5, row + 0.5)
            return Option.match(Array.last(runs), {
              onNone: () => [{ x: column, width: 1, shade }],
              onSome: last =>
                last.shade === shade
                  ? [
                      ...Array.dropRight(runs, 1),
                      { ...last, width: last.width + 1 },
                    ]
                  : [...runs, { x: column, width: 1, shade }],
            })
          },
        ),
        ({ x, width, shade }) =>
          shade === 'Lit'
            ? Result.failVoid
            : Result.succeed(rect(x, row, width, 1, SHADE_FILLS[shade])),
      ),
  )
}

type PixelRun = Readonly<{ x: number; width: number; shade: Shade }>

const NO_RUNS: ReadonlyArray<PixelRun> = []

const poolImage = (radius: number): Option.Option<Canvas.Image> =>
  Array.findFirst(
    bakeShapes(poolShapes(radius)),
    (shape): shape is Canvas.Image => shape._tag === 'Image',
  )

// NOTE: built once, one for each radius a light has.
const POOLS: ReadonlyMap<number, Option.Option<Canvas.Image>> = new Map(
  Array.map([PLAYER_LIGHT_PX, FLASH_LIGHT_PX, BULB_LIGHT_PX], radius => [
    radius,
    poolImage(radius),
  ]),
)

// NOTE: a piece of a pool's image, cropped from wherever the image's pixels
// sit (an atlas region or its own source).
const poolPiece = (
  pool: Canvas.Image,
  square: Box,
  piece: Box,
): Canvas.Shape => ({
  _tag: 'Image',
  src: pool.src,
  x: piece.left,
  y: piece.top,
  width: piece.right - piece.left,
  height: piece.bottom - piece.top,
  crop: {
    x: (pool.crop?.x ?? 0) + piece.left - square.left - pool.x,
    y: (pool.crop?.y ?? 0) + piece.top - square.top - pool.y,
    width: piece.right - piece.left,
    height: piece.bottom - piece.top,
  },
  rendering: pool.rendering,
})

// THE MASK

type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const COARSE_CELL_PX = 5

const cellarOf = (world: World): Option.Option<Room> =>
  Array.findFirst(
    levelOf(world).rooms,
    ({ id, isOpen }) => id === CELLAR_ROOM_ID && isOpen,
  )

// NOTE: every player lights a pool, a bigger one in the instant after a
// shot, and the bulb its own small one. A light stands on a whole pixel, so
// its square's edges do.
const lightsOf = (world: World, cellar: Room): ReadonlyArray<Light> => [
  ...Array.map(playersOf(world), ({ player }): Light => ({
    x: Math.round(player.x),
    y: Math.round(player.y),
    radius: player.recoilRemainingMs > 0 ? FLASH_LIGHT_PX : PLAYER_LIGHT_PX,
  })),
  {
    x: cellar.box.left + BULB_GLASS.x,
    y: cellar.box.top + BULB_GLASS.y,
    radius: BULB_LIGHT_PX,
  },
]

const squareOf = ({ x, y, radius }: Light): Box => ({
  left: x - radius,
  top: y - radius,
  right: x + radius,
  bottom: y + radius,
})

// NOTE: the part of the cellar on the camera, in whole pixels.
const shownBox = (cellar: Room, camera: Camera): Option.Option<Box> => {
  const { box } = cellar
  const left = Math.max(box.left, Math.floor(camera.x) - 1)
  const top = Math.max(box.top, Math.floor(camera.y) - 1)
  const right = Math.min(box.right, Math.ceil(camera.x + camera.width) + 1)
  const bottom = Math.min(box.bottom, Math.ceil(camera.y + camera.height) + 1)
  return right > left && bottom > top
    ? Option.some({ left, top, right, bottom })
    : Option.none()
}

const ascending = Order.Number

// NOTE: the cut lines across the shown box: its own edges and every light
// square's edges inside it.
const cutsOf = (
  low: number,
  high: number,
  edges: ReadonlyArray<number>,
): ReadonlyArray<number> =>
  Array.dedupe(
    Array.sort(
      [low, high, ...Array.filter(edges, edge => edge > low && edge < high)],
      ascending,
    ),
  )

const spansOf = (
  cuts: ReadonlyArray<number>,
): ReadonlyArray<readonly [number, number]> =>
  Array.zip(cuts, Array.drop(cuts, 1))

const isCovering =
  (piece: Box) =>
  (square: Box): boolean =>
    square.left <= piece.left &&
    square.right >= piece.right &&
    square.top <= piece.top &&
    square.bottom >= piece.bottom

// NOTE: a piece where pools meet, as coarse cells in runs along each row.
const meetingShapes = (
  lights: ReadonlyArray<Light>,
  piece: Box,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(
    spansOf(
      cutsOf(
        piece.top,
        piece.bottom,
        Array.makeBy(
          Math.ceil((piece.bottom - piece.top) / COARSE_CELL_PX),
          index => piece.top + index * COARSE_CELL_PX,
        ),
      ),
    ),
    ([top, bottom]) =>
      Array.filterMap(
        Array.reduce(
          spansOf(
            cutsOf(
              piece.left,
              piece.right,
              Array.makeBy(
                Math.ceil((piece.right - piece.left) / COARSE_CELL_PX),
                index => piece.left + index * COARSE_CELL_PX,
              ),
            ),
          ),
          NO_CELLS,
          (cells, [left, right]) => {
            const shade = shadeAt(
              lights,
              (left + right) / 2,
              (top + bottom) / 2,
            )
            return Option.match(Array.last(cells), {
              onNone: () => [{ left, right, shade }],
              onSome: last =>
                last.shade === shade
                  ? [...Array.dropRight(cells, 1), { ...last, right }]
                  : [...cells, { left, right, shade }],
            })
          },
        ),
        ({ left, right, shade }) =>
          shade === 'Lit'
            ? Result.failVoid
            : Result.succeed(
                rect(left, top, right - left, bottom - top, SHADE_FILLS[shade]),
              ),
      ),
  )

type Cell = Readonly<{ left: number; right: number; shade: Shade }>

const NO_CELLS: ReadonlyArray<Cell> = []

type Piece = Readonly<{ box: Box; covers: ReadonlyArray<number> }>

// NOTE: the dark, piece by piece. Neighbouring dark pieces in a band are
// one rect.
const maskShapes = (
  lights: ReadonlyArray<Light>,
  shown: Box,
): ReadonlyArray<Canvas.Shape> => {
  const squares = Array.map(lights, squareOf)
  const columns = spansOf(
    cutsOf(
      shown.left,
      shown.right,
      Array.flatMap(squares, ({ left, right }) => [left, right]),
    ),
  )
  const bands = spansOf(
    cutsOf(
      shown.top,
      shown.bottom,
      Array.flatMap(squares, ({ top, bottom }) => [top, bottom]),
    ),
  )
  return Array.flatMap(bands, ([top, bottom]) => {
    const pieces = Array.map(columns, ([left, right]): Piece => {
      const box = { left, top, right, bottom }
      return {
        box,
        covers: Array.filterMap(squares, (square, index) =>
          isCovering(box)(square) ? Result.succeed(index) : Result.failVoid,
        ),
      }
    })
    const darkRuns = Array.reduce(pieces, NO_BOXES, (runs, { box, covers }) =>
      Array.isReadonlyArrayNonEmpty(covers)
        ? runs
        : Option.match(Array.last(runs), {
            onNone: () => [box],
            onSome: last =>
              last.right === box.left
                ? [...Array.dropRight(runs, 1), { ...last, right: box.right }]
                : [...runs, box],
          }),
    )
    return [
      ...Array.map(darkRuns, ({ left, right }) =>
        rect(left, top, right - left, bottom - top, SHADE_FILLS.Dark),
      ),
      ...Array.flatMap(pieces, ({ box, covers }) =>
        pieceShapes(lights, squares, box, covers),
      ),
    ]
  })
}

const NO_BOXES: ReadonlyArray<Box> = []

const pieceShapes = (
  lights: ReadonlyArray<Light>,
  squares: ReadonlyArray<Box>,
  box: Box,
  covers: ReadonlyArray<number>,
): ReadonlyArray<Canvas.Shape> => {
  if (covers.length !== 1) {
    return covers.length === 0
      ? []
      : meetingShapes(
          Array.getSomes(Array.map(covers, index => Array.get(lights, index))),
          box,
        )
  }
  return pipe(
    Option.all({
      light: Option.flatMap(Array.head(covers), index =>
        Array.get(lights, index),
      ),
      square: Option.flatMap(Array.head(covers), index =>
        Array.get(squares, index),
      ),
    }),
    Option.flatMap(({ light, square }) =>
      Option.map(
        Option.flatten(Option.fromNullishOr(POOLS.get(light.radius))),
        pool => [poolPiece(pool, square, box)],
      ),
    ),
    Option.getOrElse(() => meetingShapes(lights, box)),
  )
}

// WHAT THE VIEWER SEES

// NOTE: in the dark a viewer sees only the zombies close to them: whole
// within two tiles, fading out over the third, and nothing at all past it,
// no eyes, bar, or shadow (owner, 2026-11-11). Their footsteps are the tell.
// Each player sees by their own seat (focusOf), so in co-op a mate's pool
// lights the floor for you but shows you none of its zombies.
const DARK_SIGHT = { clearPx: 20, seenPx: 30 } as const

const isInside = ({ box }: Room, { x, y }: Vector): boolean =>
  x >= box.left && x < box.right && y >= box.top && y < box.bottom

// THE DARK

// NOTE: what the dark does to a frame: the mask to draw over the room, and
// how much of each zombie shows, from 1 (all of it) to 0 (none).
export type CellarDark = Readonly<{
  maskShapes: ReadonlyArray<Canvas.Shape>
  fadeOf: (zombie: Zombie) => number
}>

// NOTE: the dark is over the cellar once it is open, on the camera, and
// the bulb is out.
export const cellarDarkOf: {
  (camera: Camera): (world: World) => Option.Option<CellarDark>
  (world: World, camera: Camera): Option.Option<CellarDark>
} = Function.dual(
  2,
  (world: World, camera: Camera): Option.Option<CellarDark> =>
    pipe(
      cellarOf(world),
      // NOTE: the bulb's chain lights the whole cellar a while
      // (src/world/cellar/bulb.ts): no dark at all then.
      Option.filter(() => !isCellarLit(world)),
      Option.flatMap(cellar =>
        Option.map(shownBox(cellar, camera), shown => {
          const viewer = focusOf(world).player
          const fadeOf = (zombie: Zombie): number =>
            isInside(cellar, zombie)
              ? Math.min(
                  1,
                  Math.max(
                    0,
                    (DARK_SIGHT.seenPx -
                      Math.hypot(zombie.x - viewer.x, zombie.y - viewer.y)) /
                      (DARK_SIGHT.seenPx - DARK_SIGHT.clearPx),
                  ),
                )
              : 1
          return {
            maskShapes: maskShapes(lightsOf(world, cellar), shown),
            fadeOf,
          }
        }),
      ),
    ),
)
