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
import { Config, Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Act,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  openLobby,
  scenePages,
  settleAnimations,
  shotViewports,
  wait,
} from './lib'
import { attempt } from './page'

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const LOBBY = `${LEARNED}&rank=4200&calling=Handyman`

// NOTE: the lobby's mask: Friendly Fire 1, Big Crowd 2, Broke 4, Glass 8.
type Scene = Readonly<{
  name: string
  query: string
  inLobby?: boolean
  checksTiles?: boolean
  act?: Act
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
function openHealthTab(page: Page) {
  return Effect.andThen(
    attempt(() =>
      page
        .getByRole('tab', { name: /^Health,/ })
        .first()
        .click(),
    ),
    settleAnimations(page),
  )
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

const checkTiles = (page: Page) =>
  attempt((): Promise<Found> =>
    page.evaluate(() => {
      const group = document.querySelector('.modifier-group')
      const box = group?.getBoundingClientRect()
      const tiles = globalThis.Array.from(
        document.querySelectorAll('.modifier-pick'),
        tile => {
          const rect = tile.getBoundingClientRect()
          return {
            name: tile.getAttribute('aria-label') ?? '',
            width: rect.width,
            height: rect.height,
          }
        },
      )
      // NOTE: this runs in the page, where Effect's modules are not loaded, so
      // it finds the first covered button with a plain loop.
      let covers: Element | undefined
      for (const button of document.querySelectorAll('.coop button')) {
        if (button.classList.contains('modifier-pick')) {
          continue
        }
        const rect = button.getBoundingClientRect()
        if (
          box !== undefined &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left < box.right - 1 &&
          rect.right > box.left + 1 &&
          rect.top < box.bottom - 1 &&
          rect.bottom > box.top + 1
        ) {
          covers = button
          break
        }
      }
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
    }),
  )

const problems: Array<string> = []

runHarnessAudit(
  Effect.gen(function* () {
    const shots = yield* Config.String('MODIFIER_SHOTS').pipe(
      Config.withDefault('/tmp/modifier-shots'),
    )
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        if (scene.act !== undefined) {
          yield* scene.act(page)
        }
        if (scene.inLobby === true) {
          yield* openLobby(page)
          yield* wait(500)
          yield* settleAnimations(page)
        }
        const where = `${viewport.name} ${scene.name}`
        if (scene.checksTiles === true) {
          const found = yield* checkTiles(page)
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
        yield* attempt(() =>
          page.screenshot({
            path: `${shots}/modifiers-${viewport.name}-${scene.name}.png`,
            animations: 'disabled',
          }),
        )
        yield* Console.log(`shot ${where}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(
      problems,
      'The modifier tiles fit, and every tile is big enough.',
    )
  }),
)
