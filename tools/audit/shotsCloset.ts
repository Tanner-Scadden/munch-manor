// The Bones closet pass: every hat on both bodies and every hair style
// (drawn from the player's own pixel maps at 8 pixels a pixel, plus a 1x and
// 3x strip), the Profile's Closet tab with worn, owned, for sale, and locked
// hats, the home hero in a hat, a run with a hatted player, the co-op lobby
// with hatted players, and the end cards that gift a hat, on a 1280x720
// desktop, an 844x390 phone on its side, and a 390x844 phone held upright, as
// `s49-<TAG>-<viewport>-<scene>.png` and `s49-<TAG>-hats.png`. It exits with
// 1 when the closet scrolls, a card runs past its panel, the tabs run into
// the rank plate, a phone card is under 48 px, or a tap does not buy.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsCloset.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Array } from 'effect'
import type { Page } from 'playwright-core'

import { closetRows, playerPalette, playerPixels } from '@game/appearance'
import { CLOSET_HATS } from '@game/closet'
import { pixelIconUrl } from '@game/icons'
import { type Appearance, defaultAppearance } from '@game/model'
import { HairStyle } from '@game/playerData'

import {
  SHOT_VIEWPORTS,
  TAG,
  type Viewport,
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

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'

// NOTE: rank 5 (600 points) holds the first three gifts; 140 Bones earned
// and 50 spent leave 90, enough for any hat for sale but the Pumpkin Head.
const MIXED = 'rank=600&bones=140&spent=50&bought=Fez&hat=Fez'

type Scene = Readonly<{
  name: string
  query: string
  isCloset?: boolean
  key?: string
  ticks?: ReadonlyArray<number>
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'closet-mixed', query: `profile=closet&${MIXED}`, isCloset: true },
  {
    name: 'closet-focus',
    query: `profile=closet&${MIXED}`,
    isCloset: true,
    key: 'ArrowRight',
  },
  {
    name: 'closet-fresh',
    query: 'profile=closet&rank=0&bones=0',
    isCloset: true,
  },
  {
    name: 'closet-all',
    query:
      'profile=closet&rank=4000&bones=800&spent=0&bought=Colander,Fez,BunnyEars,Plunger,Lampshade,PumpkinHead&hat=PumpkinHead',
    isCloset: true,
  },
  { name: 'look-hat', query: 'profile=look&rank=600&hat=BucketHat' },
  { name: 'home-hat', query: 'hat=WitchHat&rank=1500' },
  {
    name: 'home-hat-calling',
    query: 'hat=WitchHat&rank=4000&calling=LineCook',
  },
  {
    name: 'play-hat',
    query: `wave=3&start=wave&crowd=6&seen=all&${LEARNED}&hat=PirateHat&tick=60`,
  },
  {
    name: 'play-hat-tall',
    query: `wave=3&start=wave&crowd=6&seen=all&${LEARNED}&hat=WitchHat&tick=60`,
  },
  { name: 'lobby-hats', query: 'coop=host&hat=PropellerCap' },
  { name: 'arena-hats', query: 'coop=arena&hat=PropellerCap' },
  {
    name: 'end-hat',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=130&rankgain=60&hat=PartyHat`,
    ticks: [330, 420],
  },
  {
    name: 'end-several',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=1000&rankgain=1000`,
    ticks: [300, 380, 460, 540, 620, 700],
  },
]

const problems: Array<string> = []

// THE SHEET

const SCALE = 8
const BODIES = ['Broad', 'Slim'] as const

const cell = (look: Appearance) => {
  const rows = playerPixels(look).idle[0]
  return `<span class="frame" style='height:${rows.length * SCALE}px;background-image:${pixelIconUrl(rows, playerPalette(look))}'></span>`
}

const sheetHtml = () => `<style>
body { background: #3a1e26; margin: 8px; font: 12px monospace; color: #f4f1de; }
.row { display: flex; align-items: flex-end; gap: 10px; margin-bottom: 6px; }
.frame { display: inline-block; width: ${8 * SCALE}px; background: center bottom / contain no-repeat; image-rendering: pixelated; }
.label { width: 90px; }
.small { image-rendering: pixelated; }
</style>${Array.flatMap(BODIES, body =>
  Array.map(
    HairStyle.literals,
    hairStyle =>
      `<div class="row"><span class="label">${body} ${hairStyle}</span>${Array.map(
        CLOSET_HATS,
        hat => cell({ ...defaultAppearance, body, hairStyle, hat }),
      ).join('')}</div>`,
  ),
).join('')}`

const stripHtml = (scale: number) =>
  `<div class="row" style="background:#3a1e26;padding:8px;gap:${scale * 2}px">${Array.map(
    CLOSET_HATS,
    hat => {
      const rows = closetRows({ ...defaultAppearance, hat })
      return `<span class="small" style='display:inline-block;width:${8 * scale}px;height:${rows.length * scale}px;background:center bottom / contain no-repeat;background-image:${pixelIconUrl(rows, playerPalette({ ...defaultAppearance, hat }))}'></span>`
    },
  ).join('')}</div>`

const shootSheets = async (browser: Awaited<ReturnType<typeof launch>>) => {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 1800 },
  })
  await page.setContent(sheetHtml())
  await shot(page, `s49-${TAG}-hats`)
  await page.setViewportSize({ width: 700, height: 240 })
  await page.setContent(
    `<body style="margin:0;background:#3a1e26">${stripHtml(1)}${stripHtml(3)}</body>`,
  )
  await shot(page, `s49-${TAG}-hats-small`)
  await page.close()
}

// CHECKS

const checkCloset = async (page: Page, viewport: Viewport, where: string) => {
  const found = await page.evaluate(() => {
    const rectOf = (element: Element | null) => {
      const box = element?.getBoundingClientRect()
      return box === undefined
        ? null
        : {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          }
    }
    const pageElement = document.querySelector('.profile-page')
    return {
      panel: rectOf(document.querySelector('.profile')),
      page: rectOf(pageElement),
      isScrolling:
        pageElement !== null &&
        pageElement.scrollHeight > pageElement.clientHeight + 1,
      scrollBy:
        pageElement === null
          ? 0
          : pageElement.scrollHeight - pageElement.clientHeight,
      cards: [...document.querySelectorAll('.closet-card')].map(card =>
        rectOf(card),
      ),
      lastTab: rectOf(
        [...document.querySelectorAll('.profile-tab')].at(-1) ?? null,
      ),
      plate: rectOf(document.querySelector('.profile-rank')),
      width: innerWidth,
      height: innerHeight,
    }
  })
  if (found.panel === null || found.page === null) {
    problems.push(`${where}: no closet open`)
    return
  }
  const { panel, page: pageBox } = found
  if (
    panel.left < 0 ||
    panel.top < 0 ||
    panel.right > found.width ||
    panel.bottom > found.height
  ) {
    problems.push(`${where}: the panel is past the screen's edge`)
  }
  if (found.isScrolling) {
    problems.push(`${where}: the closet scrolls by ${found.scrollBy} px`)
  }
  for (const card of found.cards) {
    if (card === null) {
      continue
    }
    if (
      card.left < pageBox.left - 1 ||
      card.right > pageBox.right + 1 ||
      card.bottom > pageBox.bottom + 1 ||
      card.top < pageBox.top - 1
    ) {
      problems.push(`${where}: a card runs past the page`)
    }
    if (
      viewport.isPhone &&
      (card.right - card.left < 47.5 || card.bottom - card.top < 47.5)
    ) {
      problems.push(
        `${where}: a card is ${Math.round(card.right - card.left)} by ${Math.round(card.bottom - card.top)}, under 48 px`,
      )
    }
  }
  if (
    found.lastTab !== null &&
    found.plate !== null &&
    found.lastTab.bottom > found.plate.top - 2 &&
    found.lastTab.left < found.plate.right &&
    found.lastTab.right > found.plate.left
  ) {
    problems.push(`${where}: the tabs run into the rank plate`)
  }
}

// NOTE: buys the first hat for sale that the Bones cover, by a tap.
const checkBuying = async (page: Page, where: string) => {
  const sale = page.locator('.closet-card[data-standing="ForSale"]').first()
  if ((await sale.count()) === 0) {
    return
  }
  const before = await page
    .locator('.closet-bones .rank-bones-count')
    .innerText()
  await sale.click()
  await settleAnimations(page)
  const after = await page
    .locator('.closet-bones .rank-bones-count')
    .innerText()
  const standing = await page
    .locator('.closet-card[data-cue="Bought"]')
    .first()
    .getAttribute('data-standing')
  if (Number(after) >= Number(before) || standing !== 'Worn') {
    problems.push(
      `${where}: a tap on a hat for sale left ${before} Bones as ${after} and the card ${standing}`,
    )
  }
}

const browser = await launch()
if (isPickedScene('hats')) {
  await shootSheets(browser)
}
await useHarness()
const pages = scenePages(browser, ['nodev'])
for (const viewport of SHOT_VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const where = `${viewport.name} ${scene.name}`
    for (const tick of scene.ticks ?? [undefined]) {
      const page = await pages.open(
        viewport,
        harnessQuery(
          scene.query,
          tick === undefined ? '' : `tick=${tick}`,
          deviceQuery(viewport),
        ),
      )
      await settleAnimations(page)
      if (scene.key !== undefined) {
        await page.locator('.closet-card[data-standing="Worn"]').focus()
        await page.keyboard.press(scene.key)
        await settleAnimations(page)
      }
      if (scene.isCloset === true) {
        await checkCloset(page, viewport, where)
      }
      await shot(
        page,
        `s49-${TAG}-${viewport.name}-${scene.name}${tick === undefined ? '' : `-${tick}`}`,
      )
      if (scene.name === 'closet-mixed') {
        await checkBuying(page, where)
        await shot(page, `s49-${TAG}-${viewport.name}-closet-bought`)
      }
      pages.release(page)
    }
  }
}
await pages.close()
await browser.close()
finish(problems, 'The closet fits, buys, and every hat sits on the head.')
