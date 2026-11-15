// The rooms rework pass (docs/ESCAPE_PLAN.md, layer 19): each room's new
// shape in a quiet break with every exit open, the player in its middle
// (the dining room, the parlour's dance floor, the library's stacks and
// its nook, the cellar's lanes, the kitchen), and the dining room's
// chandelier winch mid-wave: taut over the hung chandelier, slack and
// waiting to be worked the first time once it is down, and being worked,
// its crank turning and its gold ring filling. On a 1280x720 desktop, an 844x390
// phone on its side, and a 390x844 phone held upright, as
// `rooms-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsRooms.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  EVERY_EXIT_OPEN,
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

const WAVE = `${LEARNED_ALL}&wave=3&start=wave&elapsed=0&${EVERY_EXIT_OPEN}`
const FALLEN = `${WAVE}&fallen`

// NOTE: the first house (src/world/level/plan.ts, ARRANGEMENTS): the
// parlour west of the dining room, the library east, and the cellar beyond.
const SCENES: ReadonlyArray<Scene> = [
  { name: 'dining', query: `${OPEN_BREAK}&px=180&py=150` },
  { name: 'parlour', query: `${OPEN_BREAK}&px=-160&py=130` },
  { name: 'library-stacks', query: `${OPEN_BREAK}&px=425&py=120` },
  { name: 'library-nook', query: `${OPEN_BREAK}&px=600&py=150` },
  { name: 'cellar', query: `${OPEN_BREAK}&px=840&py=130` },
  { name: 'kitchen', query: `${OPEN_BREAK}&px=100&py=-60` },
  { name: 'cleat-hung', query: `${WAVE}&px=70&py=105` },
  { name: 'cleat-hint', query: `${FALLEN}&px=70&py=105` },
  { name: 'cleat-worked', query: `${FALLEN}&cleat=0.5&px=26&py=105` },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=20'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        yield* shot(page, `rooms-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
