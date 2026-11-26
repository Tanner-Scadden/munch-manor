import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  longNamedViewports,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
} from './lib'

const VIEWPORTS = longNamedViewports

const LEARNED =
  'seen=all&learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles,displayCase'
const OPEN = 'openexits=West,East,Far,Kitchen'
const BREAK = `wave=3&break=open&breakMs=8000&${LEARNED}&${OPEN}`

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  {
    name: 'easy-in-sight',
    query: `${BREAK}&difficulty=Easy&darenear=36&tick=360`,
  },
  {
    name: 'normal-in-sight',
    query: `${BREAK}&difficulty=Normal&darenear=36&tick=360`,
  },
  {
    name: 'hard-hidden',
    query: `${BREAK}&difficulty=Hard&darenear=36&tick=360`,
  },
  {
    name: 'hint-in-view',
    query: `${BREAK}&difficulty=Normal&darefound=2&darenear=36&tick=30`,
  },
  {
    name: 'hint-off-view',
    query: `${BREAK}&difficulty=Normal&darefound=2&tick=30`,
  },
  {
    name: 'easy-edge',
    query: `${BREAK}&difficulty=Easy&tick=360`,
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* VIEWPORTS
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
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
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish([], 'Shots taken.')
  }),
)
