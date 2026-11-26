import { Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Viewport,
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  openBrowser,
  openHowToPlay,
  pressButton,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'
import type { AuditFailed } from './page'

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page, viewport: Viewport) => Effect.Effect<void, AuditFailed>
}>

const replayTutorial = (page: Page, viewport: Viewport) =>
  Effect.andThen(
    openHowToPlay(page, viewport),
    pressButton(page, viewport, /^Play tutorial$/),
  )

const NEW = 'learned=move,fire,startWave,pickup,rattles'
const FIRST_BREAK = 'wave=2&break=open&breakMs=3000&seen=all&quest=running'
const SEEN =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'
const LATER_BREAK = 'wave=3&break=open&kills=Runner:3'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'qkey', query: `${NEW}&${FIRST_BREAK}` },
  { name: 'qlock', query: `${NEW},dareKey&${FIRST_BREAK}&money=1` },
  {
    name: 'qcase',
    query: `${NEW},dareKey&${FIRST_BREAK}&openexits=Kitchen`,
  },
  { name: 'qcard', query: `${NEW},dareKey&${FIRST_BREAK}&quest=card` },
  { name: 'qstart', query: `${NEW},dareKey&${FIRST_BREAK}&quest=start` },
  { name: 'casecard', query: `${SEEN}&${LATER_BREAK}&px=40&py=150` },
  {
    name: 'glass',
    query: `${SEEN},displayCase&${LATER_BREAK}&px=44&py=150`,
  },
  {
    name: 'break3',
    query: `${SEEN},displayCase&wave=4&break=open&money=6&darefound=1`,
  },
  {
    name: 'padptr',
    query: `${SEEN},displayCase&wave=4&break=open&money=9&darefound=1&px=40&py=150`,
  },
  {
    name: 'howto',
    query: SEEN,
    act: (page, viewport) => openHowToPlay(page, viewport),
  },
  { name: 'replay', query: SEEN, act: replayTutorial },
  {
    name: 'pause',
    query: `${SEEN},displayCase&wave=3&start=wave&phase=paused`,
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=40'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        if (scene.act !== undefined) {
          yield* scene.act(page, viewport)
        }
        yield* settleAnimations(page)
        yield* shot(page, `np-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
