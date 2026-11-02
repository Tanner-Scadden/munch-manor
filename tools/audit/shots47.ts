// The callings pass: the calling pill on the home menu, the picker with
// locked and unlocked callings, the Profile's Look preview holding each
// calling's gun, each calling's prop on the player in play,
// and the end card that unlocks a calling, on a 1280x720 desktop, an 844x390
// phone on its side, and a 390x844 phone held upright, as
// `s47-<TAG>-<viewport>-<scene>.png`. It exits with 1 on a card past the
// picker's edge, the picker past the screen, or a phone card under 48 px.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots47.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_844,
  TAG,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
  openLobby,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  useHarness,
} from './lib'

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
])

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const CALLINGS = ['Handyman', 'TrackStar', 'PennyPincher', 'LineCook']

type Scene = Readonly<{
  name: string
  query: string
  open?: string
  isPicker?: boolean
  // NOTE: selectors clicked in order once the picker is open.
  clicks?: ReadonlyArray<string>
  // NOTE: a shot after each click, named `<scene>-<n>`.
  isFlow?: boolean
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home-you', query: '' },
  { name: 'home-handyman', query: 'rank=300&calling=Handyman' },
  { name: 'home-linecook', query: 'rank=4000&calling=LineCook' },
  {
    name: 'picker-rank1',
    query: LEARNED,
    open: '#lobby-hero',
    isPicker: true,
  },
  {
    name: 'picker-rank3',
    query: `${LEARNED}&rank=300&calling=Handyman`,
    open: '#lobby-hero',
    isPicker: true,
  },
  {
    name: 'picker-rank7',
    query: `${LEARNED}&rank=1000&calling=TrackStar`,
    open: '#lobby-hero',
    isPicker: true,
  },
  {
    name: 'picker-all',
    query: `${LEARNED}&rank=4000&calling=LineCook`,
    open: '#lobby-hero',
    isPicker: true,
  },
  // NOTE: heroes are bought with Bones: locked below the rank, for sale at
  // it with a price, tried on with a BUY pill, and owned once bought.
  {
    name: 'buy-forsale',
    query: `${LEARNED}&rank=1000&bones=220`,
    open: '#lobby-hero',
    isPicker: true,
  },
  {
    name: 'buy-trying',
    query: `${LEARNED}&rank=1000&bones=220`,
    open: '#lobby-hero',
    isPicker: true,
    clicks: ["[data-calling='TrackStar']"],
  },
  {
    name: 'buy-short',
    query: `${LEARNED}&rank=1000&bones=40`,
    open: '#lobby-hero',
    isPicker: true,
    clicks: ["[data-calling='TrackStar']"],
  },
  {
    name: 'buy-owned',
    query: `${LEARNED}&rank=1000&bones=220&bought=hero:Handyman`,
    open: '#lobby-hero',
    isPicker: true,
    clicks: ["[data-calling='TrackStar']"],
  },
  {
    name: 'flow',
    query: `${LEARNED}&rank=1000&bones=220`,
    open: '#lobby-hero',
    clicks: ["[data-calling='TrackStar']", '.calling-buy'],
    isFlow: true,
  },
  { name: 'profile-you', query: 'profile=look' },
  {
    name: 'profile-linecook',
    query: 'rank=4000&calling=LineCook&profile=look',
  },
  ...CALLINGS.map(calling => ({
    name: `play-${calling.toLowerCase()}`,
    query: `wave=3&start=wave&crowd=6&seen=all&${LEARNED}&calling=${calling}&tick=60`,
  })),
  {
    name: 'end-unlock',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=240&rankgain=60&tick=400`,
  },
  {
    name: 'end-unlock-mid',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=240&rankgain=60&tick=260`,
  },
]

const problems: Array<string> = []

const checkPicker = async (page: Page, viewport: Viewport, where: string) => {
  const found = await page.evaluate(() => {
    const box = document
      .querySelector('.panel-dialog[open] .panel')
      ?.getBoundingClientRect()
    const cards = [...document.querySelectorAll('.calling-card')].map(card => {
      const rect = card.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }
    })
    return {
      box:
        box !== undefined
          ? {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            }
          : null,
      cards,
      width: innerWidth,
      height: innerHeight,
    }
  })
  if (found.box === null) {
    problems.push(`${where}: no picker open`)
    return
  }
  const { box } = found
  if (
    box.left < 0 ||
    box.top < 0 ||
    box.right > found.width ||
    box.bottom > found.height
  ) {
    problems.push(`${where}: the picker is past the screen's edge`)
  }
  for (const card of found.cards) {
    if (
      card.left < box.left - 1 ||
      card.right > box.right + 1 ||
      card.bottom > box.bottom + 1
    ) {
      problems.push(`${where}: a card runs past the picker`)
    }
    if (
      viewport.isPhone &&
      (card.right - card.left < 47.5 || card.bottom - card.top < 47.5)
    ) {
      problems.push(`${where}: a card is under 48 px`)
    }
  }
}

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    await settleAnimations(page)
    if (scene.open !== undefined) {
      await openLobby(page)
      await page.click(scene.open)
      await page.locator('dialog[open]').first().waitFor({ state: 'visible' })
      await settleAnimations(page)
      for (const selector of scene.clicks ?? []) {
        await page.click(selector)
        await settleAnimations(page)
        if (scene.isFlow === true) {
          await shot(
            page,
            `s47-${TAG}-${viewport.name}-${scene.name}-${selector.includes('buy') ? 'bought' : 'trying'}`,
          )
        }
      }
    }
    const where = `${viewport.name} ${scene.name}`
    if (scene.isPicker === true) {
      await checkPicker(page, viewport, where)
    }
    await shot(page, `s47-${TAG}-${viewport.name}-${scene.name}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(
  problems,
  'The hero card and the picker fit, and every card is big enough.',
)
