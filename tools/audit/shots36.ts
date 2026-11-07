// The kitchen pass: the parlour break with the boarded kitchen door's
// price tag, the in-world prompt once the player is in reach, the hold's
// ring filling, a press short of the price, the boards smashing open after
// a hold, the same hold mid-wave, the kitchen mid-wave with an oven
// belching and zombies slipping in soup, and a view up the kitchen with the
// parlour below, on a 1280x720 desktop, an 844x390 phone on its side, and a
// 390x844 phone held upright, as `s36-<TAG>-<viewport>-<scene>.png`. It
// checks that a hold opens the kitchen and a hold short of the price does
// not, and exits with 1 on any miss.
//   TAG=after bun run heavy -- bun tools/audit/shots36.ts
// ONLY picks scenes, such as `ONLY=prompt,ring`, and VIEWPORTS picks screens.
import { Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'
import { type AuditFailed, attempt } from './page'

type Scene = Readonly<{
  name: string
  query: string
  act?: (
    page: Page,
    problems: Array<string>,
    label: string,
  ) => Effect.Effect<void, AuditFailed>
}>

// NOTE: every scene but the smash plays its frames at once with `tick=N`
// (N frames of 1/60 s) and holds there, so each picture is the same on every
// run.
const BREAK = 'wave=3&seen=all&money=85&gun=smg'

// NOTE: the smash plays on live frames, since a held frame would hide the
// boards flying and the wallet counting down, and the shot waits for that
// much game time, not wall time: the hold, then a moment of debris.
const HOLD_MS = 500
const SMASH_MS = 120
const WAIT_TIMEOUT_MS = 5000
const afterGameMs = (page: Page, ms: number) =>
  Effect.gen(function* () {
    const start = yield* attempt(() =>
      page.evaluate(() => window.__model.elapsedMs),
    )
    yield* attempt(() =>
      page.waitForFunction(end => window.__model.elapsedMs >= end, start + ms, {
        polling: 'raf',
        timeout: WAIT_TIMEOUT_MS,
      }),
    )
  })

const isKitchenOpen = (page: Page) =>
  attempt(() =>
    page.evaluate(() => window.__model.level.openExits.includes('Kitchen')),
  )

const AT_BOARDS = 'px=70&py=27'
const MID_WAVE = 'wave=4&seen=all&start=wave&elapsed=6000&money=85&gun=smg'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'door',
    query: `${BREAK}&px=70&py=44&tick=42`,
  },
  {
    name: 'prompt',
    query: `${BREAK}&${AT_BOARDS}&tick=24`,
  },
  {
    name: 'ring',
    query: `${BREAK}&${AT_BOARDS}&hold&tick=17`,
  },
  {
    name: 'short',
    query: `wave=3&seen=all&money=40&gun=smg&${AT_BOARDS}&hold&tick=7`,
    act: (page, problems, label) =>
      Effect.gen(function* () {
        if (yield* isKitchenOpen(page)) {
          problems.push(
            `${label}: a hold short of the price opened the kitchen`,
          )
        }
      }),
  },
  {
    name: 'smash',
    query: `${BREAK}&${AT_BOARDS}&hold`,
    act: (page, problems, label) =>
      Effect.gen(function* () {
        yield* afterGameMs(page, HOLD_MS + SMASH_MS)
        if (!(yield* isKitchenOpen(page))) {
          problems.push(`${label}: holding at the boards left the kitchen shut`)
        }
      }),
  },
  {
    name: 'midwave',
    query: `${MID_WAVE}&${AT_BOARDS}&hold&tick=20`,
  },
  {
    name: 'kitchen',
    query:
      'wave=4&seen=all&start=wave&elapsed=9000&kitchen&gun=smg&god&px=96&py=-46&ovens=belch&ovenMs=600000&slip&aim=70,-100&tick=15',
  },
  {
    name: 'wide',
    query: 'wave=5&seen=all&kitchen&money=40&px=70&py=-8&tick=42',
  },
  {
    name: 'preview',
    query: 'wave=5&seen=all&kitchen&money=40&px=150&py=120&tick=42',
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    const problems: Array<string> = []
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        const label = `${viewport.name} ${scene.name}`
        yield* settleAnimations(page)
        if (scene.act !== undefined) {
          yield* scene.act(page, problems, label)
          yield* settleAnimations(page)
        }
        yield* shot(page, `s36-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The kitchen pass found no problems.')
  }),
)
