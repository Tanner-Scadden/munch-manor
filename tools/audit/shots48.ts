// The teammate bots pass: the single player lobby with its + BOT tiles, with
// one bot and with three, a run with three bots mid-wave, and the end card
// with bots, on a 1280x720 desktop, an 844x390 phone on its side, and a
// 390x844 phone held upright, as `s48-<TAG>-<viewport>-<scene>.png`. It exits
// with 1 when a + BOT tile or an x is under 48 px on a phone, or the seats
// run past the screen.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots48.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_390,
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  openLobby,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  wait,
} from './lib'
import { attempt } from './page'

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'desktop' },
  { ...PHONE_844, name: 'phone-side' },
  { ...UPRIGHT_390, name: 'phone-up' },
])

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey'
const LOBBY = `${LEARNED}&rank=4000&calling=Handyman`

type Scene = Readonly<{ name: string; query: string; bots?: number }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'lobby-empty', query: LOBBY, bots: 0 },
  { name: 'lobby-1-bot', query: `${LOBBY}&lobbybots=1`, bots: 0 },
  { name: 'lobby-3-bots', query: `${LOBBY}&lobbybots=3`, bots: 0 },
  {
    name: 'play-3-bots',
    query: `wave=3&start=wave&bots=3&crowd=8&seen=all&${LEARNED}&tick=240`,
  },
  {
    name: 'end-3-bots',
    query: `wave=6&phase=gameover&stats&bots=3&${LEARNED}&tick=400`,
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* VIEWPORTS
    const browser = yield* openBrowser
    const problems: Array<string> = []

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
        if (scene.bots !== undefined) {
          yield* openLobby(page)
          for (let added = 0; added < scene.bots; added += 1) {
            yield* attempt(() => page.keyboard.press('KeyB'))
            yield* attempt(() =>
              page
                .locator('.lobby-seat-bot')
                .nth(added)
                .waitFor({ state: 'visible' }),
            )
          }
          yield* wait(500)
          yield* settleAnimations(page)
          const found = yield* attempt(() =>
            page.evaluate(() => {
              const sizes = globalThis.Array.from(
                document.querySelectorAll('.lobby-add-bot, .lobby-drop-bot'),
                element => {
                  const box = element.getBoundingClientRect()
                  return { width: box.width, height: box.height }
                },
              )
              const seats = document
                .querySelector('.lobby-seats')
                ?.getBoundingClientRect()
              return {
                sizes,
                bottom: seats?.bottom ?? 0,
                right: seats?.right ?? 0,
                width: innerWidth,
                height: innerHeight,
              }
            }),
          )
          const where = `${viewport.name} ${scene.name}`
          if (found.bottom > found.height || found.right > found.width) {
            problems.push(`${where}: the seats run past the screen`)
          }
          for (const size of found.sizes) {
            if (viewport.isPhone && (size.width < 47.5 || size.height < 47.5)) {
              problems.push(`${where}: a bot button is under 48 px`)
            }
          }
        }
        yield* shot(page, `s48-${tag}-${viewport.name}-${scene.name}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(
      problems,
      'The + BOT tiles and the bots fit, and every button is big enough.',
    )
  }),
)
