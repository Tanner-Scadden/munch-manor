// The Clang Pan in the melee slot pass: mid-wave with the Pan in hand (the
// HUD's melee slot showing its icon and dent meter, both guns kept), and
// the fridge's TAKE preview for a Pan on offer with both gun slots full
// (the knife crossed out under the tag), on a 1280x720 desktop, an 844x390
// phone on its side, and a 390x844 phone held upright, as
// `s45-<TAG>-<viewport>-<scene>.png`. The queries run on older builds too,
// where the Pan took a gun slot, so TAG=before shots compare. With
// CHECK=1 it checks that the Pan sits in the melee slot, in hand, with
// both guns kept, and exits with 1 on a miss.
//   TAG=after CHECK=1 bun run heavy -- --shared bun tools/audit/shots45.ts
// ONLY picks scenes, such as `ONLY=take`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import { focusOf } from '@game/party'

import {
  SHOT_VIEWPORTS,
  TAG,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
  scenePages,
  settleAnimations,
  shot,
  useHarness,
} from './lib'
import { BREAK, IN_KITCHEN } from './scenes'

const IS_CHECKED = process.env['CHECK'] === '1'

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page, problems: Array<string>, label: string) => Promise<void>
}>

const AT_FRIDGE = 'px=180&py=-102'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'pan-slot',
    query: `${IN_KITCHEN}&gun=pan&tier=1&iced=pan&stick=60,0&tick=34`,
    act: async (page, problems, label) => {
      const player = await page.evaluate(() => ({
        melee: focusOf(window.__model).player.melee._tag,
        wield: focusOf(window.__model).player.wield,
      }))
      if (player.melee !== 'Pan' || player.wield !== 'Melee') {
        problems.push(`${label}: the Pan is not in hand in the melee slot`)
      }
    },
  },
  {
    name: 'take',
    query: `${BREAK}&${AT_FRIDGE}&fridge=offering&prize=Pan&fridgeMs=5000&tick=2`,
    act: async (page, problems, label) => {
      const arsenal = await page.evaluate(
        () => focusOf(window.__model).player.arsenal._tag,
      )
      if (arsenal === 'OneGun') {
        problems.push(`${label}: both gun slots should be full`)
      }
    },
  },
]

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
const problems: Array<string> = []
for (const viewport of SHOT_VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    const label = `${viewport.name} ${scene.name}`
    await settleAnimations(page)
    if (IS_CHECKED && scene.act !== undefined) {
      await scene.act(page, problems, label)
    }
    await shot(page, `s45-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The Clang Pan melee slot pass found no problems.')
