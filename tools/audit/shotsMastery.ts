// The hero and gun mastery pass: every hero in every prop style (YOU with
// its medal) and every mastery gun in its Gilded and Diamond skins, drawn
// from the game's own pixel maps, big; then the Profile's MASTERY tab with
// the tracks at every stage, and a run wearing a style with a Gilded
// pistol, on a 1280x720 desktop, an 844x390 phone on its side, and a
// 390x844 phone held upright, as `s51-<TAG>-props.png`,
// `s51-<TAG>-skins.png`, and `s51-<TAG>-<viewport>-<scene>.png`. It exits
// with 1 when the MASTERY tab runs past its panel or a swatch is under
// 22 px.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsMastery.ts
// ONLY picks scenes (`sheets` for the two sheets), and VIEWPORTS picks
// screens.
import { Array, Effect } from 'effect'
import type { Browser, Page } from 'playwright-core'

import { type Appearance, defaultAppearance } from '@game/app/model'
import { playerPalette, playerPixels } from '@game/art/appearance'
import { pixelIconUrl } from '@game/art/icons'
import { gunPictureOf } from '@game/art/sprites/guns'
import { MASTERY_GUNS } from '@game/domain/mastery'
import { MasterySkin } from '@game/shared/masteryData'
import { PropStyle } from '@game/shared/playerData'
import { CALLINGS } from '@game/world/heroes/calling'

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
import { attempt } from './page'

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'

type Scene = Readonly<{ name: string; query: string; isTab?: boolean }>

// NOTE: 1,500 points to the last hero and 2,600 kills to the last gun, each
// before a share less, so the rows stand at every level and skin.
const TRACKS = 'heropoints=1500&gunmastery=2600'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'mastery-tab',
    query: `profile=mastery&${TRACKS}&calling=Handyman&propstyle=Night`,
    isTab: true,
  },
  {
    name: 'mastery-tab-fresh',
    query: 'profile=mastery',
    isTab: true,
  },
  {
    name: 'play-gold-prop',
    query: `wave=3&start=wave&crowd=6&seen=all&${LEARNED}&rank=1800&calling=Handyman&heropoints=8000&gunmastery=1100&propstyle=Gold&tick=60`,
  },
  {
    name: 'play-you-medal',
    query: `wave=3&start=wave&crowd=6&seen=all&${LEARNED}&heropoints=8000&propstyle=Ember&tick=60`,
  },
]

const problems: Array<string> = []

// THE SHEETS

const SCALE = 8

const SHEET_STYLE = `<style>
body { background: #3a1e26; margin: 8px; font: 12px monospace; color: #f4f1de; }
.row { display: flex; align-items: flex-end; gap: 14px; margin-bottom: 8px; }
.label { width: 90px; }
.frame { display: inline-block; width: ${8 * SCALE}px; height: ${13 * SCALE}px; background: center bottom / contain no-repeat; image-rendering: pixelated; }
.gun { display: inline-block; width: ${11 * SCALE}px; height: ${6 * SCALE}px; background: center / contain no-repeat; image-rendering: pixelated; }
</style>`

const figure = (look: Appearance, calling: (typeof CALLINGS)[number]) =>
  `<span class="frame" style='background-image:${pixelIconUrl(playerPixels(look, calling).idle[0], playerPalette(look))}'></span>`

const propsHtml = `${SHEET_STYLE}${Array.join(
  Array.map(
    CALLINGS,
    calling =>
      `<div class="row"><span class="label">${calling}</span>${Array.join(
        Array.map(PropStyle.literals, propStyle =>
          figure({ ...defaultAppearance, propStyle }, calling),
        ),
        '',
      )}</div>`,
  ),
  '',
)}`

const skinsHtml = `${SHEET_STYLE}${Array.join(
  Array.map(
    ['Stock', ...MasterySkin.literals] as const,
    skin =>
      `<div class="row" style="align-items:center"><span class="label">${skin}</span>${Array.join(
        Array.map(MASTERY_GUNS, kind => {
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
    const sheets = [
      { name: 'props', html: propsHtml, width: 560, height: 820 },
      { name: 'skins', html: skinsHtml, width: 1100, height: 260 },
    ]
    for (const sheet of sheets) {
      const page = yield* attempt(() =>
        browser.newPage({
          viewport: { width: sheet.width, height: sheet.height },
        }),
      )
      yield* attempt(() => page.setContent(sheet.html))
      yield* shot(page, `s51-${tag}-${sheet.name}`)
      yield* attempt(() => page.close())
    }
  })

// CHECKS

const checkTab = (page: Page, where: string) =>
  Effect.gen(function* () {
    const found = yield* attempt(() =>
      page.evaluate(() => {
        const rectOf = (element: Element | null) => {
          const box = element?.getBoundingClientRect()
          return box === undefined
            ? null
            : { left: box.left, right: box.right, width: box.width }
        }
        return {
          page: rectOf(document.querySelector('.profile-page')),
          rows: globalThis.Array.from(
            document.querySelectorAll('.mastery-row'),
            row => rectOf(row),
          ),
          swatches: globalThis.Array.from(
            document.querySelectorAll('button.mastery-swatch'),
            swatch => rectOf(swatch),
          ),
        }
      }),
    )
    if (found.page === null || found.rows.length === 0) {
      problems.push(`${where}: no MASTERY tab open`)
      return
    }
    const pageBox = found.page
    for (const row of found.rows) {
      if (
        row !== null &&
        (row.left < pageBox.left - 1 || row.right > pageBox.right + 1)
      ) {
        problems.push(`${where}: a row runs past the page`)
      }
    }
    for (const swatch of found.swatches) {
      if (swatch !== null && swatch.width < 21.5) {
        problems.push(
          `${where}: a swatch is ${Math.round(swatch.width)} px, under 22`,
        )
      }
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
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        if (scene.isTab === true) {
          yield* checkTab(page, where)
        }
        yield* shot(page, `s51-${tag}-${viewport.name}-${scene.name}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The MASTERY tab fits, and every style shows.')
  }),
)
