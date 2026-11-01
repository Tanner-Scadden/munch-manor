// The earned looks pass: every shirt color by every print on both bodies and
// every gun skin on every gun (drawn from the game's own pixel maps, big),
// then the Look tab's Outfit and Gear rows with worn, owned, for sale, and
// locked options and with NEW badges, the home hero with a skinned gun and
// the NEW pips, a run with a skinned gun, the co-op lobby and arena in the
// new looks, and the end cards that gift a print and a gun skin, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `s50-<TAG>-<viewport>-<scene>.png`, `s50-<TAG>-looks-<body>.png`,
// and `s50-<TAG>-skins.png`. It exits with 1 when a Look tab row runs past
// its panel, an option is under 40 px, or a pick does not buy.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsCloset.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Array } from 'effect'
import type { Page } from 'playwright-core'

import { playerPalette, playerPixels } from '@game/appearance'
import { pixelIconUrl } from '@game/icons'
import { type Appearance, defaultAppearance } from '@game/model'
import { GunSkin, Print, ShirtColor } from '@game/playerData'
import { gunPictureOf } from '@game/sprites/guns'
import { WeaponKind } from '@game/worldSchema'

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

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'

// NOTE: rank 4 (the points for it) holds two hat gifts; 140 Bones earned
// and 50 spent leave 90, enough for a hat, a color, a print, or a skin.
const MIXED =
  'rank=600&bones=140&spent=50&bought=Fez,shirt:Midnight,print:Skull'

// NOTE: the points that make rank 16: the Gold shirt opens, with every hat.
const RANK_16 = 4125

type Scene = Readonly<{
  name: string
  query: string
  isLook?: boolean
  open?: string
  ticks?: ReadonlyArray<number>
}>

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'look-gear',
    query: `profile=look&looksection=Gear&${MIXED}&hat=Fez`,
    isLook: true,
  },
  {
    name: 'look-gear-skin',
    query: `profile=look&looksection=Gear&rank=5100&bones=400&spent=0&bought=Fez,skin:Candy&hat=PirateHat&skin=Candy`,
    isLook: true,
  },
  {
    name: 'look-outfit',
    query: `profile=look&looksection=Outfit&${MIXED}&look=,,,,Midnight,,Skull`,
    isLook: true,
  },
  {
    name: 'look-outfit-fresh',
    query: `profile=look&looksection=Outfit&rank=${RANK_16}&bones=200&fresh`,
    isLook: true,
  },
  {
    name: 'look-gear-fresh',
    query: `profile=look&looksection=Gear&rank=${RANK_16}&bones=200&fresh`,
    isLook: true,
  },
  {
    name: 'look-outfit-gold',
    query: `profile=look&looksection=Outfit&rank=5100&bones=200&look=,,,,Gold,,Polka`,
    isLook: true,
  },
  {
    name: 'picker-fresh',
    query: 'rank=1800&fresh',
    open: '#home-calling',
  },
  { name: 'home-fresh', query: `rank=${RANK_16}&fresh` },
  { name: 'home-skin', query: 'rank=5100&skin=Gold&look=,,,,Glow,,Checker' },
  {
    name: 'play-skin',
    query: `wave=3&start=wave&crowd=6&seen=all&${LEARNED}&rank=5100&skin=Neon&look=,,,,Coral,,Flames&tick=60`,
  },
  {
    name: 'play-skin-gold',
    query: `wave=3&start=wave&crowd=6&seen=all&${LEARNED}&rank=5100&skin=Gold&look=,,,,Gold,,Skull&tick=60`,
  },
  { name: 'lobby-looks', query: 'coop=host&rank=5100' },
  { name: 'arena-looks', query: 'coop=arena&rank=5100' },
  {
    name: 'end-gifts',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=5100&rankgain=600`,
    ticks: [330, 420, 520, 640],
  },
]

const problems: Array<string> = []

// THE SHEETS

const BODIES = ['Broad', 'Slim'] as const

const patch = (look: Appearance, scale: number) => {
  const rows = playerPixels(look).idle[0]
  return `<span class="frame" style='width:${8 * scale}px;height:${rows.length * scale}px;background-image:${pixelIconUrl(rows, playerPalette(look))}'></span>`
}

const SHEET_STYLE = `<style>
body { background: #3a1e26; margin: 8px; font: 12px monospace; color: #f4f1de; }
.row { display: flex; align-items: flex-end; gap: 6px; margin-bottom: 4px; }
.frame { display: inline-block; background: center bottom / contain no-repeat; image-rendering: pixelated; }
.label { width: 74px; }
.head { display: flex; gap: 6px; margin: 6px 0 2px 80px; }
h3 { margin: 10px 0 2px; }
</style>`

const looksHtml = (body: (typeof BODIES)[number], scale: number) =>
  `${SHEET_STYLE}<h3>${body}</h3><div class="head">${Array.map(Print.literals, print => `<span style="width:${8 * scale}px">${print}</span>`).join('')}</div>${Array.map(
    ShirtColor.literals,
    shirtColor =>
      `<div class="row"><span class="label">${shirtColor}</span>${Array.map(
        Print.literals,
        print =>
          patch({ ...defaultAppearance, body, shirtColor, print }, scale),
      ).join('')}</div>`,
  ).join('')}`

const skinsHtml = (scale: number) =>
  `${SHEET_STYLE}<style>.gun { display: inline-block; width: ${11 * scale}px; height: ${6 * scale}px; background: center / contain no-repeat; image-rendering: pixelated; } .row { align-items: center; gap: 14px; margin-bottom: 10px; }</style><div class="head" style="gap:14px">${Array.map(WeaponKind.literals, kind => `<span style="width:${11 * scale}px">${kind}</span>`).join('')}</div>${Array.map(
    GunSkin.literals,
    skin =>
      `<div class="row"><span class="label">${skin}</span>${Array.map(
        WeaponKind.literals,
        kind => {
          const { rows, palette } = gunPictureOf(kind, skin)
          return `<span class="gun" style='background-image:${pixelIconUrl(rows, palette)}'></span>`
        },
      ).join('')}</div>`,
  ).join('')}`

const shootSheets = async (browser: Awaited<ReturnType<typeof launch>>) => {
  for (const body of BODIES) {
    const page = await browser.newPage({
      viewport: { width: 640, height: 1180 },
    })
    await page.setContent(looksHtml(body, 8))
    await shot(page, `s50-${TAG}-looks-${body.toLowerCase()}`)
    await page.close()
  }
  const skins = await browser.newPage({
    viewport: { width: 1000, height: 520 },
  })
  await skins.setContent(skinsHtml(8))
  await shot(skins, `s50-${TAG}-skins`)
  await skins.close()
}

// CHECKS

const checkLook = async (page: Page, where: string) => {
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
      options: [...document.querySelectorAll('.look-option')].map(option =>
        rectOf(option),
      ),
      width: innerWidth,
      height: innerHeight,
    }
  })
  if (found.panel === null || found.page === null) {
    problems.push(`${where}: no Look tab open`)
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
    problems.push(`${where}: the Look tab scrolls by ${found.scrollBy} px`)
  }
  for (const option of found.options) {
    if (option === null) {
      continue
    }
    if (
      option.left < pageBox.left - 1 ||
      option.right > pageBox.right + 1 ||
      option.bottom > pageBox.bottom + 1 ||
      option.top < pageBox.top - 1
    ) {
      problems.push(`${where}: an option runs past the page`)
    }
    if (
      option.right - option.left < 39.5 ||
      option.bottom - option.top < 39.5
    ) {
      problems.push(
        `${where}: an option is ${Math.round(option.right - option.left)} by ${Math.round(option.bottom - option.top)}, under 40 px`,
      )
    }
  }
}

// NOTE: buys the first look for sale that the Bones cover, by a pick.
const checkBuying = async (page: Page, where: string) => {
  const sale = page.locator('.look-option[data-standing="ForSale"]').first()
  if ((await sale.count()) === 0) {
    return
  }
  const before = await page
    .locator('.profile-rank .rank-bones-count')
    .innerText()
  await sale.click()
  await settleAnimations(page)
  const after = await page
    .locator('.profile-rank .rank-bones-count')
    .innerText()
  const bought = page.locator('.look-option[data-cue="Bought"]').first()
  const isWorn = (await bought.getAttribute('aria-checked')) === 'true'
  if (Number(after) >= Number(before) || !isWorn) {
    problems.push(
      `${where}: a pick on a look for sale left ${before} Bones as ${after} and the option ${isWorn ? 'worn' : 'not worn'}`,
    )
  }
}

const browser = await launch()
if (isPickedScene('sheets')) {
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
      if (scene.open !== undefined) {
        await page.locator(scene.open).click()
        await settleAnimations(page)
      }
      if (scene.isLook === true) {
        await checkLook(page, where)
      }
      await shot(
        page,
        `s50-${TAG}-${viewport.name}-${scene.name}${tick === undefined ? '' : `-${tick}`}`,
      )
      if (scene.name === 'look-gear') {
        await checkBuying(page, where)
        await shot(page, `s50-${TAG}-${viewport.name}-look-bought`)
      }
      pages.release(page)
    }
  }
}
await pages.close()
await browser.close()
finish(problems, 'The Look tab fits, buys, and every skin and print shows.')
