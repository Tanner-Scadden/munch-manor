// The guided tutorial pass: each step of the tour a new player gets in the
// break before wave 2 (walk to Rattles, buy a free Plank Pile, place it in a
// doorway, done) and of the kitchen tour before wave 3 (the free boards, the
// free pull, take it or leave it, done), on a 1280x720 desktop, an 844x390
// phone on its side, and a 390x844 phone held
// upright, as `s42-<TAG>-<viewport>-<scene>.png`. It checks that the
// tracker shows on every step, that the Plank Pile is FREE, and that the
// tracker's skip button is big enough to tap, and exits with 1 on a miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots42.ts
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

const NEW_PLAYER = 'learned=move,fire,startWave,pickup&seen=all'
const FIRST_BREAK = `wave=2&break=open&breakMs=3000&money=12&${NEW_PLAYER}`

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page, problems: Array<string>, label: string) => Promise<void>
}>

const hasTracker = async (
  page: Page,
  problems: Array<string>,
  label: string,
) => {
  if ((await page.locator('.quest-tracker').count()) === 0) {
    problems.push(`${label}: no tracker`)
  }
}

// NOTE: chapter 2, the kitchen tour: a new save in the break before wave 3,
// past the first break but not the timed breaks.
const KITCHEN_BREAK =
  'wave=3&prep=15000&money=5&seen=all&learned=move,fire,startWave,shop,swap,pickup,openBreak'

const hasFreeTag = async (
  page: Page,
  problems: Array<string>,
  label: string,
) => {
  await hasTracker(page, problems, label)
  const current = await page.evaluate(() => ({
    kitchenTour: { _tag: window.__model.kitchenTour._tag },
    wallet: { balance: focusOf(window.__model).wallet.balance },
  }))
  if (current.kitchenTour._tag !== 'Running') {
    problems.push(`${label}: the kitchen tour is ${current.kitchenTour._tag}`)
  }
  if (current.wallet.balance !== 5) {
    problems.push(`${label}: the wallet moved to ${current.wallet.balance}`)
  }
}

const SCENES: ReadonlyArray<Scene> = [
  { name: 'go', query: `${FIRST_BREAK}&tick=2`, act: hasTracker },
  {
    name: 'buy',
    query: `${FIRST_BREAK}&px=270&py=142&tick=4`,
    act: async (page, problems, label) => {
      await hasTracker(page, problems, label)
      const tab = page.getByRole('tab', { name: /^Traps/ }).first()
      await tab.click()
      await settleAnimations(page)
      const price = await page
        .locator('#shop-item-Barricade .shop-tag')
        .textContent()
      if (price?.trim() !== 'FREE') {
        problems.push(`${label}: the Plank Pile is "${price}", not FREE`)
      }
    },
  },
  {
    name: 'place',
    query: `${FIRST_BREAK}&quest=running&traphint=Barricade&barricades=1&px=200&py=60&tick=2`,
    act: async (page, problems, label) => {
      await hasTracker(page, problems, label)
      const skip = await page.locator('.quest-skip').boundingBox()
      if (skip === null || skip.width < 48 || skip.height < 48) {
        problems.push(`${label}: the skip button is too small to tap`)
      }
    },
  },
  {
    name: 'kboards',
    query: `${KITCHEN_BREAK}&px=70&py=26&tick=2`,
    act: hasFreeTag,
  },
  {
    name: 'kfridge',
    query: `${KITCHEN_BREAK}&kitchen&px=180&py=-102&tick=2`,
    act: hasFreeTag,
  },
  {
    name: 'kchoose',
    query: `${KITCHEN_BREAK}&kitchen&px=180&py=-102&hold&tick=130`,
    act: hasTracker,
  },
  {
    name: 'kdone',
    query: `${KITCHEN_BREAK}&kitchen&quest=kitchendone&tick=2`,
    act: hasTracker,
  },
  {
    name: 'done',
    query: `wave=2&break=open&breakMs=3000&quest=done&${NEW_PLAYER}&tick=2`,
    act: hasTracker,
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
    const label = `${viewport.name} ${scene.name}`
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    await settleAnimations(page)
    if (scene.act !== undefined) {
      await scene.act(page, problems, label)
    }
    await shot(page, `s42-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The guided first break pass found no problems.')
