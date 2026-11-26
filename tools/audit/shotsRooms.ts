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
