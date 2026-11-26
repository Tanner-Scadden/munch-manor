import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
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

const NEW = 'learned=move,fire,startWave,pickup'
const RETURNING = `${NEW},dareCard`
const FIRST_BREAK = 'wave=1&break=open&breakMs=3000'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'writing', query: `${NEW}&${FIRST_BREAK}&pocket=1100` },
  { name: 'written', query: `${NEW}&${FIRST_BREAK}&pocket=2400` },
  { name: 'waiting', query: `${NEW}&${FIRST_BREAK}&pocket=6000` },
  { name: 'folding', query: `${NEW}&${FIRST_BREAK}&pocketfold=300` },
  { name: 'landing', query: `${NEW}&${FIRST_BREAK}&pocketfold=640` },
  { name: 'returning', query: `${RETURNING}&${FIRST_BREAK}&pocket=2400` },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=2'])
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
        yield* shot(page, `dare-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
