// Where the dark meets an open room, in 3D (src/render/iso/look.ts): the
// player at each room's west and east edge in each of the six houses the
// seed can roll (`house=0` to `5`, src/world/level/plan.ts ARRANGEMENTS),
// in a quiet break with every exit open (the cellar dark, its bulb out),
// and beside a room still shut, as `dark-<TAG>-<viewport>-h<house>-<scene>.png`.
// The dark of a shut room, the outside, and the dark cellar ends on whole
// tiles and walls, never as a curve across the open room beside it.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsDark.ts
// ONLY picks scenes, HOUSES picks houses (`HOUSES=0,3`), and VIEWPORTS
// picks screens.
import { Array, Config, Effect, Option, String } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  LEARNED_ALL,
  OPEN_BREAK,
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'

type Scene = Readonly<{ name: string; query: string }>

const breakWith = (exits: string): string =>
  `${LEARNED_ALL}&wave=3&break=open&openexits=${exits}`

// NOTE: the rooms by where they stand on the plan, in game pixels (a tile
// is 10): the dining room x 0 to 360 and y 0 to 220, the kitchen above it
// (y -150 to 0), the west slot x -320 to 0 (y 40 to 220), the east slot
// x 360 to 680 and the far slot x 680 to 1000 (both y 0 to 180). The player
// stands a couple of tiles in from each edge.
const SCENES: ReadonlyArray<Scene> = [
  { name: 'west-w', query: `${OPEN_BREAK}&px=-300&py=130` },
  { name: 'west-e', query: `${OPEN_BREAK}&px=-20&py=130` },
  { name: 'dining-w', query: `${OPEN_BREAK}&px=20&py=110` },
  { name: 'dining-e', query: `${OPEN_BREAK}&px=340&py=110` },
  { name: 'kitchen-w', query: `${OPEN_BREAK}&px=20&py=-75` },
  { name: 'kitchen-e', query: `${OPEN_BREAK}&px=300&py=-75` },
  { name: 'east-w', query: `${OPEN_BREAK}&px=380&py=90` },
  { name: 'east-e', query: `${OPEN_BREAK}&px=660&py=90` },
  { name: 'far-w', query: `${OPEN_BREAK}&px=700&py=90` },
  { name: 'far-e', query: `${OPEN_BREAK}&px=980&py=90` },
  // NOTE: beside a room still shut: the far slot, the east slot, and the
  // west slot behind their boards.
  {
    name: 'shut-far',
    query: `${breakWith('Kitchen,West,East')}&px=660&py=90`,
  },
  { name: 'shut-east', query: `${breakWith('Kitchen,West')}&px=340&py=110` },
  { name: 'shut-west', query: `${breakWith('Kitchen,East')}&px=20&py=130` },
]

const housesPicked = Config.String('HOUSES').pipe(
  Config.map(String.split(',')),
  Config.option,
)

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const picked = yield* housesPicked
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
              `${scene.query}&house=${house}`,
              deviceQuery(viewport),
            ),
          )
          yield* settleAnimations(page)
          yield* shot(
            page,
            `dark-${tag}-${viewport.name}-h${house}-${scene.name}`,
          )
          pages.release(page)
        }
      }
    }
  }),
)
