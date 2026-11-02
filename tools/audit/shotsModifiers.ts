// The run modifiers pass: the single player lobby with none on, with some on,
// and with a bot and all four on (Friendly Fire is dim until a bot sits
// in the crew), the co-op lobby as the host and as a guest, the shop's
// HEALTH shelf under Glass, and the end cards that show the bonus (alone,
// and with a crew), on a 1280x720
// desktop, an 844x390 phone on its side, and a 390x844 phone held upright,
// as `modifiers-<viewport>-<scene>.png` in MODIFIER_SHOTS (default
// /tmp/modifier-shots). It exits with 1 when a modifier tile is under 48 px
// on a phone, the tiles or the lobby run past the screen, or the tiles
// cover a button.
//   bun run heavy -- --shared bun tools/audit/shotsModifiers.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  SHOT_VIEWPORTS,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
  openLobby,
  scenePages,
  settleAnimations,
  useHarness,
  wait,
} from './lib'

const SHOTS = process.env['MODIFIER_SHOTS'] ?? '/tmp/modifier-shots'

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const LOBBY = `${LEARNED}&rank=4200&calling=Handyman`

// NOTE: the lobby's mask: Friendly Fire 1, Big Crowd 2, Broke 4, Glass 8.
type Scene = Readonly<{
  name: string
  query: string
  inLobby?: boolean
  checksTiles?: boolean
  act?: (page: Page) => Promise<void>
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'solo-none', query: LOBBY, inLobby: true, checksTiles: true },
  {
    name: 'solo-some',
    query: `${LOBBY}&mods=10`,
    inLobby: true,
    checksTiles: true,
  },
  {
    name: 'solo-all',
    query: `${LOBBY}&lobbybots=1&mods=15`,
    inLobby: true,
    checksTiles: true,
  },
  { name: 'coop-host', query: 'coop=host&mods=10', checksTiles: true },
  { name: 'coop-guest', query: 'coop=guest&mods=9', checksTiles: true },
  {
    name: 'shop-glass',
    query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142&mods=8',
    act: openHealthTab,
  },
  {
    name: 'end-solo',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=162&rankgain=129&mods=14&tick=400`,
  },
  {
    name: 'end-solo-win',
    query: `wave=10&phase=victory&stats&difficulty=Hard&${LEARNED}&rank=1900&rankgain=537&mods=14&tick=400`,
  },
  {
    name: 'end-crew',
    query: `wave=10&phase=victory&stats&party=3&${LEARNED}&rank=2400&rankgain=204&mods=9&tick=400`,
  },
]

// NOTE: the Glass shop's HEALTH shelf, whose one item is marked done.
async function openHealthTab(page: Page): Promise<void> {
  await page
    .getByRole('tab', { name: /^Health,/ })
    .first()
    .click()
  await settleAnimations(page)
}

const MIN_TAP = 48

type Found = Readonly<{
  tiles: ReadonlyArray<
    Readonly<{ name: string; width: number; height: number }>
  >
  isClipped: boolean
  coversButton: string
  scrolls: boolean
}>

const checkTiles = (page: Page): Promise<Found> =>
  page.evaluate(() => {
    const group = document.querySelector('.modifier-group')
    const box = group?.getBoundingClientRect()
    const tiles = [...document.querySelectorAll('.modifier-pick')].map(tile => {
      const rect = tile.getBoundingClientRect()
      return {
        name: tile.getAttribute('aria-label') ?? '',
        width: rect.width,
        height: rect.height,
      }
    })
    const others = [...document.querySelectorAll('.coop button')].filter(
      button => !button.classList.contains('modifier-pick'),
    )
    const covers = others.find(button => {
      const rect = button.getBoundingClientRect()
      return (
        box !== undefined &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left < box.right - 1 &&
        rect.right > box.left + 1 &&
        rect.top < box.bottom - 1 &&
        rect.bottom > box.top + 1
      )
    })
    return {
      tiles,
      isClipped:
        box === undefined ||
        box.left < 0 ||
        box.top < 0 ||
        box.right > innerWidth + 0.5 ||
        box.bottom > innerHeight + 0.5,
      coversButton:
        covers?.getAttribute('aria-label') ?? covers?.textContent ?? '',
      scrolls:
        document.scrollingElement !== null &&
        (document.scrollingElement.scrollHeight > innerHeight + 1 ||
          document.scrollingElement.scrollWidth > innerWidth + 1),
    }
  })

const problems: Array<string> = []

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
for (const viewport of SHOT_VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    await settleAnimations(page)
    await scene.act?.(page)
    if (scene.inLobby === true) {
      await openLobby(page)
      await wait(500)
      await settleAnimations(page)
    }
    const where = `${viewport.name} ${scene.name}`
    if (scene.checksTiles === true) {
      const found = await checkTiles(page)
      if (found.tiles.length !== 4) {
        problems.push(`${where}: ${found.tiles.length} modifier tiles`)
      }
      for (const tile of found.tiles) {
        if (
          viewport.isPhone &&
          (tile.width < MIN_TAP || tile.height < MIN_TAP)
        ) {
          problems.push(
            `${where}: ${tile.name} is ${Math.round(tile.width)}x${Math.round(tile.height)}`,
          )
        }
      }
      if (found.isClipped) {
        problems.push(`${where}: the tiles run past the screen`)
      }
      if (found.coversButton !== '') {
        problems.push(`${where}: the tiles cover ${found.coversButton}`)
      }
      if (found.scrolls) {
        problems.push(`${where}: the page scrolls`)
      }
    }
    await page.screenshot({
      path: `${SHOTS}/modifiers-${viewport.name}-${scene.name}.png`,
      animations: 'disabled',
    })
    console.log(`shot ${where}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The modifier tiles fit, and every tile is big enough.')
