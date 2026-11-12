// A controller in a run, end to end in headless Chrome: a stand-in for
// `navigator.getGamepads` (the standard layout) drives the game's own
// gamepad Subscription. A resting pad changes nothing, the left stick
// walks, the right stick and trigger fire, Start pauses and resumes, and
// unplugging it mid-wave pauses. Screenshots of the pad firing and of its
// pause go to `pad-<TAG>-<viewport>-<step>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/pad.ts
import { Array, Effect, Schema } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  auditTag,
  closePage,
  finish,
  harnessUrl,
  modelAs,
  openBrowser,
  openPage,
  sceneReady,
  shot,
  wait,
} from './lib'
import { RT, START, padStandIn, pressPad, setPad } from './padStandIn'
import { attempt } from './page'

const SCENE =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles,displayCase&wave=4&start=wave&elapsed=6000&crowd=6&god&seen=all'

const RunView = Schema.Struct({
  lastDevice: Schema.String,
  phase: Schema.Struct({ _tag: Schema.String }),
  stats: Schema.Struct({ shotsFired: Schema.Finite }),
  seats: Schema.Array(
    Schema.Struct({ player: Schema.Struct({ x: Schema.Finite }) }),
  ),
})
type RunView = typeof RunView.Type

const playerX = (view: RunView): number =>
  Array.match(view.seats, {
    onEmpty: () => 0,
    onNonEmpty: ([first]) => first.player.x,
  })

const runView = (page: Page) => modelAs(page, RunView)

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const browser = yield* openBrowser
    const viewport = DESKTOP_1280
    const problems: Array<string> = []
    const check = (isFine: boolean, problem: string) => {
      if (!isFine) {
        problems.push(`${viewport.name}: ${problem}`)
      }
    }
    const page = yield* openPage(browser, viewport)
    yield* attempt(() => page.addInitScript(padStandIn))
    yield* attempt(() => page.goto(harnessUrl(SCENE, 'nodev')))
    yield* sceneReady(page)
    yield* wait(300)

    const resting = yield* runView(page)
    check(
      resting.lastDevice !== 'Gamepad',
      `a resting pad took the device (${resting.lastDevice})`,
    )

    yield* setPad({ page, axes: [1, 0, 0, 0] })
    yield* wait(500)
    const walked = yield* runView(page)
    check(
      walked.lastDevice === 'Gamepad',
      'the left stick did not take the device',
    )
    check(
      playerX(walked) > playerX(resting),
      `the left stick did not walk right (${playerX(resting)} to ${playerX(walked)})`,
    )

    yield* setPad({ page, axes: [0, 0, 0, -1], held: [RT] })
    yield* wait(400)
    const firing = yield* runView(page)
    check(
      firing.stats.shotsFired > walked.stats.shotsFired,
      'the right trigger fired nothing',
    )
    yield* shot(page, `pad-${tag}-${viewport.name}-firing`)
    yield* setPad({ page })
    yield* wait(150)

    yield* pressPad({ page, button: START })
    const paused = yield* runView(page)
    check(
      paused.phase._tag === 'Paused',
      `Start did not pause (${paused.phase._tag})`,
    )
    yield* shot(page, `pad-${tag}-${viewport.name}-paused`)

    yield* pressPad({ page, button: START })
    const resumed = yield* runView(page)
    check(
      resumed.phase._tag === 'Wave',
      `Start did not resume (${resumed.phase._tag})`,
    )

    yield* setPad({ page, axes: [1, 0, 0, 0] })
    yield* wait(150)
    yield* setPad({ page, isPlugged: false })
    yield* wait(300)
    const unplugged = yield* runView(page)
    check(
      unplugged.phase._tag === 'Paused',
      `unplugging mid-wave did not pause (${unplugged.phase._tag})`,
    )
    yield* shot(page, `pad-${tag}-${viewport.name}-unplugged`)

    const rumbles = yield* attempt(() =>
      page.evaluate(() => window.__rumbles ?? 0),
    )
    yield* Effect.log(`rumbles asked of the pad: ${rumbles}`)
    yield* closePage(page)
    yield* finish(
      problems,
      'The controller moves, fires, pauses, and pauses when unplugged.',
    )
  }),
)
