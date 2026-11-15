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

type Scene = Readonly<{ name: string; query: string }>

const WAVE = `${LEARNED_ALL}&wave=5&start=wave&elapsed=6000&god&crowd=12&${EVERY_EXIT_OPEN}`

// NOTE: the seams by where they stand on the plan (in game pixels, a tile
// is 10): the dining room is columns 0 to 35 and rows 0 to 21, the kitchen
// above it, the west slot at columns -32 to -1 from row 4, the east slot at
// 36 to 67 and the far slot at 68 to 99, both from row 0.
const SCENES: ReadonlyArray<Scene> = [
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
              `${scene.query}&house=${house}`,
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
