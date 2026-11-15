// The walls where the rooms meet, and the zombies' doorways, in 3D
// (src/render/iso/house.ts): each of the six houses the seed can roll
// (`house=0` to `5`, src/world/level/plan.ts ARRANGEMENTS), every exit open,
// the player at each seam (the kitchen over the dining room, the west slot,
// the east slot, the far slot) and at each spawn doorway, in a quiet break
// and as a wave's first zombies walk in, as
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
