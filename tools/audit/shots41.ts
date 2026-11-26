import { Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Viewport,
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  openHowToPlay,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'
import { type AuditFailed, attempt } from './page'
import { FIGHTING, LEARNED } from './scenes'

type Scene = Readonly<{
  name: string
  query: string
  act?: (
    page: Page,
    viewport: Viewport,
    problems: Array<string>,
    label: string,
  ) => Effect.Effect<void, AuditFailed>
}>

const openCardLine =
  (card: string) =>
  (page: Page, viewport: Viewport, problems: Array<string>, label: string) =>
    Effect.gen(function* () {
      yield* openHowToPlay(page, viewport)
      const button = page.locator(`#help-card-${card}`)
      if ((yield* attempt(() => button.count())) === 0) {
        problems.push(`${label}: no ${card} card button`)
        return
      }
      yield* attempt(() => (viewport.isPhone ? button.tap() : button.focus()))
      yield* settleAnimations(page)
      const isShown = yield* attempt(() =>
        page.locator(`#help-card-${card}-line`).isVisible(),
      ).pipe(Effect.orElseSucceed(() => false))
      if (!isShown) {
        problems.push(`${label}: the ${card} card's line is not showing`)
      }
    })

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'firstbreak',
    query:
      'wave=2&break=open&breakMs=4000&learned=move,fire,startWave,swap,pickup,timedBreaks',
  },
  { name: 'break', query: `wave=3&prep=15000&${LEARNED}` },
  {
    name: 'traphint',
    query: `wave=3&prep=15000&traphint=Barricade&barricades=2&${LEARNED}`,
  },
  {
    name: 'shoptraps',
    query: `wave=3&prep=15000&money=80&px=270&py=142&${LEARNED}`,
    act: (page, viewport) => {
      const tab = page.getByRole('tab', { name: /^Traps/ }).first()
      return Effect.andThen(
        attempt(() => (viewport.isPhone ? tab.tap() : tab.click())),
        settleAnimations(page),
      )
    },
  },
  {
    name: 'howto',
    query: '',
    act: (page, viewport) => openHowToPlay(page, viewport),
  },
  { name: 'howto-charge', query: '', act: openCardLine('charge') },
  { name: 'pause', query: 'wave=3&seen=all&start=wave&phase=paused' },
  { name: 'ammo', query: `${FIGHTING}&gun=smg&loaded=30&tick=2` },
  { name: 'lastammo', query: `${FIGHTING}&gun=smg&loaded=4&tick=2` },
  {
    name: 'knife',
    query: `${FIGHTING}&first=shotgun&gun=smg&knife&aim=160,40&tick=6`,
  },
  { name: 'shopguns', query: `wave=5&money=180&px=270&py=142&${LEARNED}` },
  {
    name: 'shopowned',
    query: `wave=5&money=180&gun=smg&loaded=18&px=270&py=142&${LEARNED}`,
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
        const label = `${viewport.name} ${scene.name}`
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        if (scene.act !== undefined) {
          yield* scene.act(page, viewport, problems, label)
        }
        yield* shot(page, `s41-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The playtest clarity pass found no problems.')
  }),
)
