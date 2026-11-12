import { Array, Function, Option, Order, Result, pipe } from "effect";
import type { Canvas } from "foldkit";

import { bakeShapes } from "../art/sprite";
import { isCellarLit } from "../world/cellar/bulb";
import { type Room, levelOf } from "../world/level/arena";
import { CELLAR_ROOM_ID } from "../world/level/plan";
import { focusOf, playersOf } from "../world/party/party";
import type { World } from "../world/schema/world";
import type { Vector, Zombie } from "../world/schema/worldSchema";
import type { Camera } from "./camera";
import { rect } from "./drawing";
import { CELLAR_BULB_OFFSET } from "./room/room";

// The cellar's twist (docs/ROOM_DRAFTS.md): it is dark but for a pool round
// each player, each player's flashlight beam the way they face, the flash
// of each shot, and the one bare bulb, and a zombie in the dark is not drawn
// at all until it is close to the viewing player (DARK_SIGHT) or in their
// beam: only its footsteps give it away. Yanking the bulb's chain
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
// then dark. A player's light is a pool and a flashlight beam (owner,
// 2026-11-12, a friend's idea: "a beam of light from the flashlight ... you
// would have to point to the zombies to see and fire at them"): a cone the
// way they face, out to BEAM's length, its edges dimming as a pool's do.
// `radius` is a plain pool's.
type Light = Readonly<{
  x: number;
  y: number;
  radius: number;
  maybeBeam: Option.Option<Beam>;
}>;

// NOTE: a beam snapped to one of BEAM.directions, so each is one baked
// image, and the pool round the player under it.
type Beam = Readonly<{ direction: number; poolPx: number }>;

const BEAM = { lengthPx: 120, halfAngle: Math.PI / 7, directions: 24 } as const;

const PLAYER_LIGHT_PX = 46;
const FLASH_LIGHT_PX = 62;
const BULB_LIGHT_PX = 30;
const LIT = 0.55;
const DIM = 0.8;

// NOTE: the bulb's pool on the floor, a little below the glass where its
// art hangs.
const BULB_DROP_PX = 8;

const BULB_GLASS = {
  x: CELLAR_BULB_OFFSET.x,
  y: CELLAR_BULB_OFFSET.y + BULB_DROP_PX,
};

type Shade = "Lit" | "Glow" | "Dim" | "Dark";

const SHADE_FILLS: Readonly<Record<Exclude<Shade, "Lit">, string>> = {
  Glow: "rgba(6, 4, 10, 0.42)",
  Dim: "rgba(6, 4, 10, 0.7)",
  Dark: "rgba(6, 4, 10, 0.93)",
};

const shadeOfReach = (reach: number): Shade => {
  if (reach < LIT) {
    return "Lit";
  } else if (reach < DIM) {
    return "Glow";
  } else if (reach < 1) {
    return "Dim";
  }
  return "Dark";
};

const angleOfDirection = (direction: number): number =>
  (direction / BEAM.directions) * Math.PI * 2;

// NOTE: the nearest of the beam's direction to a heading.
const directionOf = ({ x, y }: Vector): number =>
  (Math.round((Math.atan2(y, x) / (Math.PI * 2)) * BEAM.directions) +
    BEAM.directions) %
  BEAM.directions;

// NOTE: how far into a beam a point is, 0 at its root and 1 at its edge or
// its end, by whichever is further.
const beamReach = (beam: Beam, dx: number, dy: number): number => {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return 0;
  }
  const off = Math.abs(
    Math.atan2(
      Math.sin(Math.atan2(dy, dx) - angleOfDirection(beam.direction)),
      Math.cos(Math.atan2(dy, dx) - angleOfDirection(beam.direction)),
    ),
  );
  return Math.max(distance / BEAM.lengthPx, off / BEAM.halfAngle);
};

const reachOf = (light: Light, x: number, y: number): number => {
  const dx = x - light.x;
  const dy = y - light.y;
  return Option.match(light.maybeBeam, {
    onNone: () => Math.hypot(dx, dy) / light.radius,
    onSome: (beam) =>
      Math.min(Math.hypot(dx, dy) / beam.poolPx, beamReach(beam, dx, dy)),
  });
};

const shadeAt = (lights: ReadonlyArray<Light>, x: number, y: number): Shade =>
  shadeOfReach(
    Array.reduce(lights, Infinity, (nearest, light) =>
      Math.min(nearest, reachOf(light, x, y)),
    ),
  );

// POOLS

// NOTE: the box a light reaches, from its own spot: a pool's square, or
// the box round a beam's pool and its cone, so a beam's image is only as
// big as its light.
const extentOf = (radius: number, maybeBeam: Option.Option<Beam>): Box =>
  Option.match(maybeBeam, {
    onNone: () => ({
      left: -radius,
      top: -radius,
      right: radius,
      bottom: radius,
    }),
    onSome: ({ direction, poolPx }) => {
      const angle = angleOfDirection(direction);
      const rim = Array.map(
        Array.makeBy(17, (step) => angle + ((step - 8) / 8) * BEAM.halfAngle),
        (edge) => ({
          x: Math.cos(edge) * BEAM.lengthPx,
          y: Math.sin(edge) * BEAM.lengthPx,
        }),
      );
      const xs = [-poolPx, poolPx, ...Array.map(rim, ({ x }) => x)];
      const ys = [-poolPx, poolPx, ...Array.map(rim, ({ y }) => y)];
      return {
        left: Math.floor(Math.min(...xs)),
        top: Math.floor(Math.min(...ys)),
        right: Math.ceil(Math.max(...xs)),
        bottom: Math.ceil(Math.max(...ys)),
      };
    },
  });

// NOTE: a light's box as one baked image: each pixel row's runs of one
// shade, the clear middle left out.
const poolShapes = (
  radius: number,
  maybeBeam: Option.Option<Beam>,
): ReadonlyArray<Canvas.Shape> => {
  const extent = extentOf(radius, maybeBeam);
  const light: Light = { x: -extent.left, y: -extent.top, radius, maybeBeam };
  return Array.flatMap(
    Array.makeBy(extent.bottom - extent.top, (row) => row),
    (row) =>
      Array.filterMap(
        Array.reduce(
          Array.makeBy(extent.right - extent.left, (column) => column),
          NO_RUNS,
          (runs, column) => {
            const shade = shadeAt([light], column + 0.5, row + 0.5);
            return Option.match(Array.last(runs), {
              onNone: () => [{ x: column, width: 1, shade }],
              onSome: (last) =>
                last.shade === shade
                  ? [
                      ...Array.dropRight(runs, 1),
                      { ...last, width: last.width + 1 },
                    ]
                  : [...runs, { x: column, width: 1, shade }],
            });
          },
        ),
        ({ x, width, shade }) =>
          shade === "Lit"
            ? Result.failVoid
            : Result.succeed(rect(x, row, width, 1, SHADE_FILLS[shade])),
      ),
  );
};

type PixelRun = Readonly<{ x: number; width: number; shade: Shade }>;

const NO_RUNS: ReadonlyArray<PixelRun> = [];

const poolImage = (
  radius: number,
  maybeBeam: Option.Option<Beam>,
): Option.Option<Canvas.Image> =>
  Array.findFirst(
    bakeShapes(poolShapes(radius, maybeBeam)),
    (shape): shape is Canvas.Image => shape._tag === "Image",
  );

// NOTE: the bulb's pool, built once.
const BULB_POOL = poolImage(BULB_LIGHT_PX, Option.none());

// NOTE: a beam's image is built on first use, one for each direction and
// pool (a shot's flash widens the pool), and kept.
const beams = new Map<string, Option.Option<Canvas.Image>>();

const beamImage = (beam: Beam): Option.Option<Canvas.Image> => {
  const key = `${beam.direction}:${beam.poolPx}`;
  const kept = beams.get(key);
  if (kept !== undefined) {
    return kept;
  }
  const built = poolImage(beam.poolPx, Option.some(beam));
  beams.set(key, built);
  return built;
};

const imageOfLight = (light: Light): Option.Option<Canvas.Image> =>
  Option.match(light.maybeBeam, {
    onNone: () => BULB_POOL,
    onSome: beamImage,
  });

// NOTE: every beam image, for the sprite atlas (src/art/spritePrecompile.ts).
export const everyBeamImage = (): void => {
  Array.forEach(
    Array.makeBy(BEAM.directions, (index) => index),
    (direction) =>
      Array.forEach([PLAYER_LIGHT_PX, FLASH_LIGHT_PX], (poolPx) => {
        beamImage({ direction, poolPx });
      }),
  );
};

// NOTE: a piece of a pool's image, cropped from wherever the image's pixels
// sit (an atlas region or its own source).
const poolPiece = (
  pool: Canvas.Image,
  square: Box,
  piece: Box,
): Canvas.Shape => ({
  _tag: "Image",
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
});

// THE MASK

type Box = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

const COARSE_CELL_PX = 5;

const cellarOf = (world: World): Option.Option<Room> =>
  Array.findFirst(
    levelOf(world).rooms,
    ({ id, isOpen }) => id === CELLAR_ROOM_ID && isOpen,
  );

// NOTE: every player lights a pool, a bigger one in the instant after a
// shot, and a beam the way they face; the bulb lights its own small pool. A
// light stands on a whole pixel, so its square's edges do.
const lightsOf = (world: World, cellar: Room): ReadonlyArray<Light> => [
  ...Array.map(playersOf(world), ({ player }): Light => ({
    x: Math.round(player.x),
    y: Math.round(player.y),
    radius: PLAYER_LIGHT_PX,
    maybeBeam: Option.some({
      direction: directionOf(player.facing),
      poolPx: player.recoilRemainingMs > 0 ? FLASH_LIGHT_PX : PLAYER_LIGHT_PX,
    }),
  })),
  {
    x: cellar.box.left + BULB_GLASS.x,
    y: cellar.box.top + BULB_GLASS.y,
    radius: BULB_LIGHT_PX,
    maybeBeam: Option.none(),
  },
];

const squareOf = ({ x, y, radius, maybeBeam }: Light): Box => {
  const extent = extentOf(radius, maybeBeam);
  return {
    left: x + extent.left,
    top: y + extent.top,
    right: x + extent.right,
    bottom: y + extent.bottom,
  };
};

// NOTE: the part of the cellar on the camera, in whole pixels.
const shownBox = (cellar: Room, camera: Camera): Option.Option<Box> => {
  const { box } = cellar;
  const left = Math.max(box.left, Math.floor(camera.x) - 1);
  const top = Math.max(box.top, Math.floor(camera.y) - 1);
  const right = Math.min(box.right, Math.ceil(camera.x + camera.width) + 1);
  const bottom = Math.min(box.bottom, Math.ceil(camera.y + camera.height) + 1);
  return right > left && bottom > top
    ? Option.some({ left, top, right, bottom })
    : Option.none();
};

const ascending = Order.Number;

// NOTE: the cut lines across the shown box: its own edges and every light
// square's edges inside it.
const cutsOf = (
  low: number,
  high: number,
  edges: ReadonlyArray<number>,
): ReadonlyArray<number> =>
  Array.dedupe(
    Array.sort(
      [low, high, ...Array.filter(edges, (edge) => edge > low && edge < high)],
      ascending,
    ),
  );

const spansOf = (
  cuts: ReadonlyArray<number>,
): ReadonlyArray<readonly [number, number]> =>
  Array.zip(cuts, Array.drop(cuts, 1));

const isCovering =
  (piece: Box) =>
  (square: Box): boolean =>
    square.left <= piece.left &&
    square.right >= piece.right &&
    square.top <= piece.top &&
    square.bottom >= piece.bottom;

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
          (index) => piece.top + index * COARSE_CELL_PX,
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
                (index) => piece.left + index * COARSE_CELL_PX,
              ),
            ),
          ),
          NO_CELLS,
          (cells, [left, right]) => {
            const shade = shadeAt(
              lights,
              (left + right) / 2,
              (top + bottom) / 2,
            );
            return Option.match(Array.last(cells), {
              onNone: () => [{ left, right, shade }],
              onSome: (last) =>
                last.shade === shade
                  ? [...Array.dropRight(cells, 1), { ...last, right }]
                  : [...cells, { left, right, shade }],
            });
          },
        ),
        ({ left, right, shade }) =>
          shade === "Lit"
            ? Result.failVoid
            : Result.succeed(
                rect(left, top, right - left, bottom - top, SHADE_FILLS[shade]),
              ),
      ),
  );

type Cell = Readonly<{ left: number; right: number; shade: Shade }>;

const NO_CELLS: ReadonlyArray<Cell> = [];

type Piece = Readonly<{ box: Box; covers: ReadonlyArray<number> }>;

// NOTE: the dark, piece by piece. Neighbouring dark pieces in a band are
// one rect.
const maskShapes = (
  lights: ReadonlyArray<Light>,
  shown: Box,
): ReadonlyArray<Canvas.Shape> => {
  const squares = Array.map(lights, squareOf);
  const columns = spansOf(
    cutsOf(
      shown.left,
      shown.right,
      Array.flatMap(squares, ({ left, right }) => [left, right]),
    ),
  );
  const bands = spansOf(
    cutsOf(
      shown.top,
      shown.bottom,
      Array.flatMap(squares, ({ top, bottom }) => [top, bottom]),
    ),
  );
  return Array.flatMap(bands, ([top, bottom]) => {
    const pieces = Array.map(columns, ([left, right]): Piece => {
      const box = { left, top, right, bottom };
      return {
        box,
        covers: Array.filterMap(squares, (square, index) =>
          isCovering(box)(square) ? Result.succeed(index) : Result.failVoid,
        ),
      };
    });
    const darkRuns = Array.reduce(pieces, NO_BOXES, (runs, { box, covers }) =>
      Array.isReadonlyArrayNonEmpty(covers)
        ? runs
        : Option.match(Array.last(runs), {
            onNone: () => [box],
            onSome: (last) =>
              last.right === box.left
                ? [...Array.dropRight(runs, 1), { ...last, right: box.right }]
                : [...runs, box],
          }),
    );
    return [
      ...Array.map(darkRuns, ({ left, right }) =>
        rect(left, top, right - left, bottom - top, SHADE_FILLS.Dark),
      ),
      ...Array.flatMap(pieces, ({ box, covers }) =>
        pieceShapes(lights, squares, box, covers),
      ),
    ];
  });
};

const NO_BOXES: ReadonlyArray<Box> = [];

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
          Array.getSomes(
            Array.map(covers, (index) => Array.get(lights, index)),
          ),
          box,
        );
  }
  return pipe(
    Option.all({
      light: Option.flatMap(Array.head(covers), (index) =>
        Array.get(lights, index),
      ),
      square: Option.flatMap(Array.head(covers), (index) =>
        Array.get(squares, index),
      ),
    }),
    Option.flatMap(({ light, square }) =>
      Option.map(imageOfLight(light), (pool) => [poolPiece(pool, square, box)]),
    ),
    Option.getOrElse(() => meetingShapes(lights, box)),
  );
};

// WHAT THE VIEWER SEES

// NOTE: in the dark a viewer sees only the zombies close to them: whole
// within two tiles, fading out over the third, and nothing at all past it,
// no eyes, bar, or shadow (owner, 2026-11-11). Their footsteps are the tell.
// A zombie in the viewer's own beam shows whole, fading out over the beam's
// dim edge, so pointing the flashlight finds them (2026-11-12).
// Each player sees by their own seat (focusOf), so in co-op a mate's pool
// lights the floor for you but shows you none of its zombies.
const DARK_SIGHT = { clearPx: 20, seenPx: 30 } as const;

const isInside = ({ box }: Room, { x, y }: Vector): boolean =>
  x >= box.left && x < box.right && y >= box.top && y < box.bottom;

const nearFade = (viewer: Vector, zombie: Vector): number =>
  Math.min(
    1,
    Math.max(
      0,
      (DARK_SIGHT.seenPx -
        Math.hypot(zombie.x - viewer.x, zombie.y - viewer.y)) /
        (DARK_SIGHT.seenPx - DARK_SIGHT.clearPx),
    ),
  );

// NOTE: whole inside the beam's clear core, fading out across its dim edge.
const beamFade = (beam: Beam, dx: number, dy: number): number =>
  Math.min(1, Math.max(0, (1 - beamReach(beam, dx, dy)) / (1 - DIM)));

// THE DARK

// NOTE: what the dark does to a frame: the mask to draw over the room, and
// how much of each zombie shows, from 1 (all of it) to 0 (none).
export type CellarDark = Readonly<{
  maskShapes: ReadonlyArray<Canvas.Shape>;
  fadeOf: (zombie: Zombie) => number;
}>;

// NOTE: the dark is over the cellar once it is open, on the camera, and
// the bulb is out.
export const cellarDarkOf: {
  (camera: Camera): (world: World) => Option.Option<CellarDark>;
  (world: World, camera: Camera): Option.Option<CellarDark>;
} = Function.dual(
  2,
  (world: World, camera: Camera): Option.Option<CellarDark> =>
    pipe(
      cellarOf(world),
      // NOTE: the bulb's chain lights the whole cellar a while
      // (src/world/cellar/bulb.ts): no dark at all then.
      Option.filter(() => !isCellarLit(world)),
      Option.flatMap((cellar) =>
        Option.map(shownBox(cellar, camera), (shown) => {
          const viewer = focusOf(world).player;
          const beam: Beam = {
            direction: directionOf(viewer.facing),
            poolPx: PLAYER_LIGHT_PX,
          };
          const fadeOf = (zombie: Zombie): number =>
            isInside(cellar, zombie)
              ? Math.max(
                  nearFade(viewer, zombie),
                  beamFade(beam, zombie.x - viewer.x, zombie.y - viewer.y),
                )
              : 1;
          return {
            maskShapes: maskShapes(lightsOf(world, cellar), shown),
            fadeOf,
          };
        }),
      ),
    ),
);
