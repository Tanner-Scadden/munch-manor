// The walls where the rooms meet, and the zombies' doorways, in 3D
// (src/render/iso/house.ts): each of the six houses the seed can roll
// (`house=0` to `5`, src/world/level/plan.ts ARRANGEMENTS), every exit open,
// the player at each seam (the kitchen over the dining room, the west slot,
// the east slot, the far slot) and at each spawn doorway, in a quiet break
// and as a wave's first zombies walk in, at each corner where a low front
// wall meets a tall wall, by the library's secret shelf shut and swung,
// near and far from every room's north wall, and up close at every room's
// top wall, its doorway, and the screen's top edge (`top-*`, house 0), as
// `walls-<TAG>-<viewport>-h<house>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsWalls.ts
// ONLY picks scenes, HOUSES picks houses (`HOUSES=0,3`), and VIEWPORTS
// picks screens.
import { Array, Effect, Option } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  EVERY_EXIT_OPEN,
  LEARNED_ALL,
  OPEN_BREAK,
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  listFromEnv,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'

type Scene = Readonly<{ name: string; query: (house: number) => string }>

const WAVE = `${LEARNED_ALL}&wave=5&start=wave&elapsed=6000&god&crowd=12&${EVERY_EXIT_OPEN}`

// NOTE: the seams by where they stand on the plan (in game pixels, a tile
// is 10): the dining room is columns 0 to 35 and rows 0 to 21, the kitchen
// above it, the west slot at columns -32 to -1 from row 4, the east slot at
// 36 to 67 and the far slot at 68 to 99, both from row 0.
const SEAMS: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'kitchen-seam', query: `${OPEN_BREAK}&px=100&py=30` },
  { name: 'kitchen-in', query: `${OPEN_BREAK}&px=100&py=-40` },
  { name: 'west-seam', query: `${OPEN_BREAK}&px=20&py=110` },
  { name: 'west-in', query: `${OPEN_BREAK}&px=-30&py=110` },
  { name: 'east-seam', query: `${OPEN_BREAK}&px=340&py=90` },
  { name: 'east-in', query: `${OPEN_BREAK}&px=390&py=90` },
  { name: 'far-seam', query: `${OPEN_BREAK}&px=670&py=90` },
  { name: 'dining-north', query: `${OPEN_BREAK}&px=270&py=40` },
  { name: 'dining-south', query: `${OPEN_BREAK}&px=70&py=190` },
  { name: 'dining-east', query: `${OPEN_BREAK}&px=330&py=180` },
  { name: 'west-doors', query: `${OPEN_BREAK}&px=-120&py=80` },
  { name: 'west-south', query: `${OPEN_BREAK}&px=-240&py=190` },
  { name: 'east-doors', query: `${OPEN_BREAK}&px=520&py=40` },
  { name: 'east-south', query: `${OPEN_BREAK}&px=540&py=150` },
  { name: 'far-doors', query: `${OPEN_BREAK}&px=820&py=40` },
  { name: 'far-south', query: `${OPEN_BREAK}&px=860&py=150` },
  { name: 'wave-north', query: `${WAVE}&px=270&py=60&freeze=40` },
  { name: 'wave-west', query: `${WAVE}&px=-120&py=60&freeze=40` },
]

// NOTE: under the library's rose window, 232 pixels into its slot and high
// on its north wall (src/render/room/roseWindowArt.ts), by the slot each
// house puts the library in (ARRANGEMENTS): east in 0 and 5, far in 1 and
// 4, west in 2 and 3.
const ROSE_SPOTS: ReadonlyArray<string> = [
  'px=592&py=60',
  'px=912&py=60',
  'px=-88&py=100',
  'px=-88&py=100',
  'px=912&py=60',
  'px=592&py=60',
]

// NOTE: each room's low front (south) wall and what stands against it,
// three tiles north of it at its west, middle, and east: the dining room's
// at row 21, the west slot's at row 21, the east and far slots' at row 17.
// The dining room's side spawn doors close up: `W` in its west wall at rows
// 2 and 3, `E` in its east wall at rows 18 and 19.
const FRONT_ROWS: ReadonlyArray<
  Readonly<{ room: string; xs: ReadonlyArray<number>; py: number }>
> = [
  { room: 'dining', xs: [60, 180, 300], py: 185 },
  { room: 'west', xs: [-270, -160, -50], py: 185 },
  { room: 'east', xs: [410, 520, 630], py: 145 },
  { room: 'far', xs: [730, 840, 950], py: 145 },
]

const FRONT_WALLS: ReadonlyArray<Scene> = [
  ...Array.flatMap(FRONT_ROWS, ({ room, xs, py }) =>
    Array.map(xs, (px, at) => ({
      name: `front-${room}-${at}`,
      query: () => `${OPEN_BREAK}&px=${px}&py=${py}`,
    })),
  ),
  { name: 'side-door-west', query: () => `${OPEN_BREAK}&px=40&py=40` },
  { name: 'side-door-east', query: () => `${OPEN_BREAK}&px=320&py=180` },
]

// NOTE: where each low front wall meets a tall wall, the same twelve in
// every house (src/render/iso/space.ts isFrontWallAt): both ends of the
// kitchen's front wall (rows 0 and 1, columns 1 to 18), of the dining
// room's and the west slot's (row 21), and of the east and far slots'
// (row 17), each two and a half tiles from its corner, in the room behind
// it.
const CORNERS: ReadonlyArray<Readonly<{ name: string; spot: string }>> = [
  { name: 'kitchen-w', spot: 'px=30&py=-25' },
  { name: 'kitchen-e', spot: 'px=165&py=-25' },
  { name: 'dining-w', spot: 'px=35&py=185' },
  { name: 'dining-e', spot: 'px=325&py=185' },
  { name: 'west-w', spot: 'px=-285&py=185' },
  { name: 'west-e', spot: 'px=-45&py=185' },
  { name: 'east-w', spot: 'px=395&py=145' },
  { name: 'east-e', spot: 'px=645&py=145' },
  { name: 'far-w', spot: 'px=715&py=145' },
  { name: 'far-e', spot: 'px=965&py=145' },
]

// NOTE: the library's secret shelf, two tiles of the wall it shares with
// the room it is entered from (src/world/library/secretShelf.ts): at
// columns 35 and 36 in houses 0 and 5 (the library east), 67 and 68 in 1
// and 4 (far), -1 and 0 in 2 and 3 (west), and the library's side of it,
// from inside the library and from the room next door, shut and swung.
const SHELF_SPOTS: ReadonlyArray<Readonly<{ library: string; near: string }>> =
  [
    { library: 'px=400&py=160', near: 'px=320&py=160' },
    { library: 'px=720&py=160', near: 'px=640&py=160' },
    { library: 'px=-40&py=200', near: 'px=40&py=200' },
    { library: 'px=-40&py=200', near: 'px=40&py=200' },
    { library: 'px=720&py=160', near: 'px=640&py=160' },
    { library: 'px=400&py=160', near: 'px=320&py=160' },
  ]

const SHUT_BREAK = `${LEARNED_ALL}&wave=3&break=open&openexits=Kitchen,West,East,Far`

const shelfScene = (
  name: string,
  isOpen: boolean,
  side: 'library' | 'near',
): Scene => ({
  name,
  query: house =>
    `${isOpen ? OPEN_BREAK : SHUT_BREAK}&${Option.match(
      Array.get(SHELF_SPOTS, house),
      { onNone: () => 'px=400&py=160', onSome: spots => spots[side] },
    )}`,
})

// NOTE: each room's north wall, the face over its floor, near it and from
// across the room: the kitchen's (row -14), the dining room's (rows 0 and
// 1, low under the kitchen and tall east of it), the west slot's (rows 4
// and 5) and the east and far slots' (rows 0 and 1), and the dining room's
// kitchen door with every exit shut, boarded.
const NORTH_WALLS: ReadonlyArray<Readonly<{ name: string; spot: string }>> = [
  { name: 'kitchen-near', spot: 'px=100&py=-110' },
  { name: 'kitchen-far', spot: 'px=100&py=-20' },
  { name: 'dining-near', spot: 'px=270&py=40' },
  { name: 'dining-far', spot: 'px=270&py=170' },
  { name: 'dining-door', spot: 'px=70&py=40' },
  { name: 'west-near', spot: 'px=-150&py=80' },
  { name: 'west-far', spot: 'px=-150&py=190' },
  { name: 'east-near', spot: 'px=500&py=40' },
  { name: 'east-far', spot: 'px=500&py=150' },
  { name: 'far-near', spot: 'px=830&py=40' },
  { name: 'far-far', spot: 'px=830&py=150' },
]

// NOTE: every room's top wall in the first house (the parlour west, the
// library east, the cellar far), the player three tiles south of it so the
// whole wall stands near the top of the screen: along the wall, and at the
// doorway in it (from doorwaysOf: the kitchen's at x 130, the dining room's
// at 70, the parlour's at -100, the library's at 510, the cellar's at 740),
// the cellar's bulb lit so its wall is out of the dark.
// Shot with `HOUSES=0`.
const ROOM_TOPS: ReadonlyArray<Readonly<{ name: string; spot: string }>> = [
  { name: 'parlour-wall', spot: 'px=-220&py=90' },
  { name: 'parlour-door', spot: 'px=-100&py=90' },
  { name: 'dining-wall', spot: 'px=200&py=50' },
  { name: 'dining-door', spot: 'px=70&py=50' },
  { name: 'kitchen-wall', spot: 'px=60&py=-100' },
  { name: 'kitchen-door', spot: 'px=130&py=-100' },
  { name: 'library-wall', spot: 'px=610&py=50' },
  { name: 'library-door', spot: 'px=510&py=50' },
  { name: 'cellar-wall', spot: 'px=850&py=50&tool=Bulb&firedms=200' },
  { name: 'cellar-door', spot: 'px=740&py=50&tool=Bulb&firedms=200' },
  // NOTE: the wall at the screen's very top edge, the player six and a
  // half tiles south of it as in the owner's phone shot, where the lens
  // sees it most edge on.
  { name: 'parlour-edge', spot: 'px=-140&py=125' },
  { name: 'dining-edge', spot: 'px=180&py=85' },
  { name: 'dining-edge-east', spot: 'px=300&py=85' },
  { name: 'kitchen-edge', spot: 'px=110&py=-65' },
  { name: 'library-edge', spot: 'px=540&py=85' },
  { name: 'cellar-edge', spot: 'px=780&py=85&tool=Bulb&firedms=200' },
]

const ALL_SHUT = `${LEARNED_ALL}&wave=3&break=open`

const SCENES: ReadonlyArray<Scene> = [
  ...Array.map(SEAMS, ({ name, query }) => ({ name, query: () => query })),
  {
    name: 'library-rose',
    query: house =>
      `${OPEN_BREAK}&${Array.get(ROSE_SPOTS, house).pipe(Option.getOrElse(() => 'px=592&py=60'))}`,
  },
  // NOTE: the chandelier's winch on the dining room's west wall, the plan's
  // `j` at column 1 and row 10, with its rope up to the ceiling's pulley.
  { name: 'dining-winch', query: () => `${OPEN_BREAK}&px=50&py=120` },
  ...FRONT_WALLS,
  ...Array.map(CORNERS, ({ name, spot }) => ({
    name: `corner-${name}`,
    query: () => `${OPEN_BREAK}&${spot}`,
  })),
  shelfScene('shelf-shut', false, 'library'),
  shelfScene('shelf-shut-near', false, 'near'),
  shelfScene('shelf-open', true, 'library'),
  shelfScene('shelf-open-near', true, 'near'),
  ...Array.map(NORTH_WALLS, ({ name, spot }) => ({
    name: `north-${name}`,
    query: () => `${OPEN_BREAK}&${spot}`,
  })),
  { name: 'north-dining-shut', query: () => `${ALL_SHUT}&px=70&py=40` },
  ...Array.map(ROOM_TOPS, ({ name, spot }) => ({
    name: `top-${name}`,
    query: () => `${OPEN_BREAK}&${spot}`,
  })),
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const picked = yield* listFromEnv('HOUSES')
    const houses = Option.match(picked, {
      onNone: () => Array.range(0, 5),
      onSome: Array.map(Number),
    })
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'nohud', 'tick=20'])
    for (const viewport of viewports) {
      for (const house of houses) {
        for (const scene of SCENES) {
          if (!(yield* isPickedScene(scene.name))) {
            continue
          }
          const page = yield* pages.open(
            viewport,
            harnessQuery(
              `${scene.query(house)}&house=${house}`,
              deviceQuery(viewport),
            ),
          )
          yield* settleAnimations(page)
          yield* shot(
            page,
            `walls-${tag}-${viewport.name}-h${house}-${scene.name}`,
          )
          pages.release(page)
        }
      }
    }
  }),
)
