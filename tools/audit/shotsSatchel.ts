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

const RUN = 'learned=move,fire,startWave,pickup,dareCard,dareTour&quest=done'
const WAVE = `${RUN}&wave=3&openexits=Kitchen,West`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'none', query: `${WAVE}&dareopen=2000` },
  { name: 'two', query: `${WAVE}&darefound=2&satchel=2&dareopen=2000` },
  { name: 'dropping', query: `${WAVE}&darefound=2&satchel=1&dareopen=500` },
  { name: 'all', query: `${WAVE}&darefound=6&satchel=6&dareopen=2000` },
  {
    name: 'newthings',
    query: `${WAVE}&newthings&difficulty=Hard&darefound=2&satchel=2&dareopen=2000`,
  },
  {
    name: 'triple',
    query: `${WAVE}&difficulty=Hard&darefound=1&satchel=1&dareopen=2000`,
  },
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
        yield* shot(page, `satchel-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
