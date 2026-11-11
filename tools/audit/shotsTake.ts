// The take pass: the player at an opened display case and at the fridge's
// prize on offer, with the take tag and its prompt beside the prize, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `take-<TAG>-<viewport>-<scene>.png`. The tag must never
// cover the prize.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsTake.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
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
import { BREAK, LEARNED } from './scenes'

type Scene = Readonly<{ name: string; query: string }>

const CASE_BREAK = `${LEARNED},displayCase&wave=3&break=open&kills=Runner:3&caseopen`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'case-glass', query: `${CASE_BREAK}&px=44&py=150` },
  { name: 'case-trophy', query: `${CASE_BREAK}&px=316&py=150` },
  {
    name: 'fridge',
    query: `${BREAK}&px=180&py=-102&fridge=offering&prize=Freeze&fridgeMs=5000`,
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=8'])
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
        yield* shot(page, `take-${tag}-${viewport.name}-${scene.name}`)
        pages.release(page)
      }
    }
    yield* pages.close
  }),
)
