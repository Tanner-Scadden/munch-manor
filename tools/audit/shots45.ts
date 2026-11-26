import { Config, Console, Effect } from 'effect'
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
import { BREAK, IN_KITCHEN } from './scenes'

type Scene = Readonly<{
  name: string
  query: string
  act?: (
    page: Page,
    problems: Array<string>,
    label: string,
  ) => Effect.Effect<void, AuditFailed>
}>

const AT_FRIDGE = 'px=180&py=-102'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'pan-slot',
    query: `${IN_KITCHEN}&gun=pan&tier=1&iced=pan&stick=60,0&tick=34`,
    act: (page, problems, label) =>
      Effect.gen(function* () {
        const player = yield* attempt(() =>
          page.evaluate(() => ({
            melee: window.__model.seats[0].player.melee._tag,
            wield: window.__model.seats[0].player.wield,
          })),
        )
        if (player.melee !== 'Pan' || player.wield !== 'Melee') {
          problems.push(`${label}: the Pan is not in hand in the melee slot`)
        }
      }),
  },
  {
    name: 'take',
    query: `${BREAK}&${AT_FRIDGE}&fridge=offering&prize=Pan&fridgeMs=5000&tick=2`,
    act: (page, problems, label) =>
      Effect.gen(function* () {
        const arsenal = yield* attempt(() =>
          page.evaluate(() => window.__model.seats[0].player.arsenal._tag),
        )
        if (arsenal === 'OneGun') {
          problems.push(`${label}: both gun slots should be full`)
        }
      }),
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const isChecked =
      (yield* Config.String('CHECK').pipe(Config.withDefault(''))) === '1'
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
        if (isChecked && scene.act !== undefined) {
          yield* scene.act(page, problems, label)
        }
        yield* shot(page, `s45-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The Clang Pan melee slot pass found no problems.')
  }),
)
