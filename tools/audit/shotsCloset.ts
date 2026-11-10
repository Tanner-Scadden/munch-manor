// The earned looks pass: every shirt color by every print on both bodies and
// every gun skin on every gun (drawn from the game's own pixel maps, big),
// then the Look tab's Outfit and Gear rows with worn, owned, for sale, and
// locked options and with NEW badges, the home hero with a skinned gun and
// the NEW pips, a run with a skinned gun, the co-op lobby and arena in the
// new looks, and the end cards that gift a print and a gun skin, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `s50-<TAG>-<viewport>-<scene>.png`, `s50-<TAG>-looks-<body>.png`,
// and `s50-<TAG>-skins.png`. It exits with 1 when a Look tab row runs past
// its panel, an option is under 40 px, or a pick does not try on and the BUY
// pill does not buy.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsCloset.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Array, Effect, String } from 'effect'
import type { Browser, Page } from 'playwright-core'

import { type Appearance, defaultAppearance } from '@game/app/model'
import { playerPalette, playerPixels } from '@game/art/appearance'
import { pixelIconUrl } from '@game/art/icons'
import { gunPictureOf } from '@game/art/sprites/guns'
import { GunSkin, Print, ShirtColor } from '@game/shared/playerData'
import { WeaponKind } from '@game/world/schema/worldSchema'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  openLobby,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'
import { attempt } from './page'

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey'

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
    name: 'look-hero-hat',
    query: `profile=look&looksection=Gear&${MIXED}&hat=Fez&calling=Handyman`,
    isLook: true,
  },
  {
    name: 'look-preview',
    query: `profile=look&looksection=Gear&${MIXED}&hat=Fez&calling=Handyman`,
    isLook: true,
    open: '.look-option[data-look-option="Hat.Colander"]',
  },
  {
    name: 'look-preview-short',
    query: `profile=look&looksection=Gear&rank=600&bones=30&spent=0&bought=Fez&hat=Fez`,
    isLook: true,
    open: '.look-option[data-look-option="Hat.Colander"]',
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
    query: `${LEARNED}&rank=1800&fresh`,
    open: '#lobby-hero',
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
  `${SHEET_STYLE}<h3>${body}</h3><div class="head">${Array.join(
    Array.map(
      Print.literals,
      print => `<span style="width:${8 * scale}px">${print}</span>`,
    ),
    '',
  )}</div>${Array.join(
    Array.map(
      ShirtColor.literals,
      shirtColor =>
        `<div class="row"><span class="label">${shirtColor}</span>${Array.join(
          Array.map(Print.literals, print =>
            patch({ ...defaultAppearance, body, shirtColor, print }, scale),
          ),
          '',
        )}</div>`,
    ),
    '',
  )}`

const skinsHtml = (scale: number) =>
  `${SHEET_STYLE}<style>.gun { display: inline-block; width: ${11 * scale}px; height: ${6 * scale}px; background: center / contain no-repeat; image-rendering: pixelated; } .row { align-items: center; gap: 14px; margin-bottom: 10px; }</style><div class="head" style="gap:14px">${Array.join(
    Array.map(
      WeaponKind.literals,
      kind => `<span style="width:${11 * scale}px">${kind}</span>`,
    ),
    '',
  )}</div>${Array.join(
    Array.map(
      GunSkin.literals,
      skin =>
        `<div class="row"><span class="label">${skin}</span>${Array.join(
          Array.map(WeaponKind.literals, kind => {
            const { rows, palette } = gunPictureOf(kind, skin)
            return `<span class="gun" style='background-image:${pixelIconUrl(rows, palette)}'></span>`
          }),
          '',
        )}</div>`,
    ),
    '',
  )}`

const shootSheets = (browser: Browser, tag: string) =>
  Effect.gen(function* () {
    for (const body of BODIES) {
      const page = yield* attempt(() =>
        browser.newPage({
          viewport: { width: 640, height: 1180 },
        }),
      )
      yield* attempt(() => page.setContent(looksHtml(body, 8)))
      yield* shot(page, `s50-${tag}-looks-${String.toLowerCase(body)}`)
      yield* attempt(() => page.close())
    }
    const skins = yield* attempt(() =>
      browser.newPage({
        viewport: { width: 1000, height: 520 },
      }),
    )
    yield* attempt(() => skins.setContent(skinsHtml(8)))
    yield* shot(skins, `s50-${tag}-skins`)
    yield* attempt(() => skins.close())
  })

// CHECKS

const checkLook = (page: Page, where: string) =>
  Effect.gen(function* () {
    const found = yield* attempt(() =>
      page.evaluate(() => {
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
          options: globalThis.Array.from(
            document.querySelectorAll('.look-option'),
            option => rectOf(option),
          ),
          width: innerWidth,
          height: innerHeight,
        }
      }),
    )
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
  })

// NOTE: tries on the first look for sale, which spends nothing and shows the
// BUY pill (shot as look-tryon), then buys it by the pill.
const checkBuying = (page: Page, where: string, tryOnShot: string) =>
  Effect.gen(function* () {
    const sale = page.locator('.look-option[data-standing="ForSale"]').first()
    if ((yield* attempt(() => sale.count())) === 0) {
      return
    }
    const bones = page.locator('.profile-rank .rank-bones-count')
    const before = yield* attempt(() => bones.innerText())
    yield* attempt(() => sale.click())
    yield* settleAnimations(page)
    const pill = page.locator('.look-buy')
    if (
      (yield* attempt(() => pill.count())) === 0 ||
      (yield* attempt(() => bones.innerText())) !== before ||
      (yield* attempt(() => sale.getAttribute('aria-checked'))) === 'true'
    ) {
      problems.push(
        `${where}: a pick on a look for sale did not only try it on`,
      )
      return
    }
    yield* shot(page, tryOnShot)
    yield* attempt(() => pill.click())
    yield* settleAnimations(page)
    const after = yield* attempt(() => bones.innerText())
    const bought = page.locator('.look-option[data-cue="Bought"]').first()
    const isWorn =
      (yield* attempt(() => bought.getAttribute('aria-checked'))) === 'true'
    if (
      Number(after) >= Number(before) ||
      !isWorn ||
      (yield* attempt(() => page.locator('.look-buy').count())) !== 0
    ) {
      problems.push(
        `${where}: the BUY pill left ${before} Bones as ${after} and the option ${isWorn ? 'worn' : 'not worn'}`,
      )
    }
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    if (yield* isPickedScene('sheets')) {
      yield* shootSheets(browser, tag)
    }
    const pages = scenePages(browser, ['nodev'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const where = `${viewport.name} ${scene.name}`
        for (const tick of scene.ticks ?? [undefined]) {
          const page = yield* pages.open(
            viewport,
            harnessQuery(
              scene.query,
              tick === undefined ? '' : `tick=${tick}`,
              deviceQuery(viewport),
            ),
          )
          yield* settleAnimations(page)
          if (scene.open !== undefined) {
            const { open } = scene
            if (String.startsWith('#lobby-')(open)) {
              yield* openLobby(page)
            }
            yield* attempt(() => page.locator(open).click())
            yield* settleAnimations(page)
          }
          if (scene.isLook === true) {
            yield* checkLook(page, where)
          }
          yield* shot(
            page,
            `s50-${tag}-${viewport.name}-${scene.name}${tick === undefined ? '' : `-${tick}`}`,
          )
          if (scene.name === 'look-gear') {
            yield* checkBuying(
              page,
              where,
              `s50-${tag}-${viewport.name}-look-tryon`,
            )
            yield* shot(page, `s50-${tag}-${viewport.name}-look-bought`)
          }
          pages.release(page)
        }
      }
    }
    yield* pages.close
    yield* finish(
      problems,
      'The Look tab fits, buys, and every skin and print shows.',
    )
  }),
)
