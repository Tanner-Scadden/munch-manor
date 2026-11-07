// The phone zoom pass: the same mid-wave crowd, and the kitchen corner where
// the camera stops at the level's edge, on 360x780, 390x844, and 430x932
// phones held upright and on their sides, all with touch, and on a 1280x720
// desktop with a mouse, as `s46-<TAG>-<viewport>-<scene>.png`. For each it
// prints how many CSS pixels one world pixel takes and so how big a Groaner
// (8 by 10 world pixels) and the player (8 by 11) are on the screen. Exits
// with 1 when the world canvas is missing or the desktop is zoomed.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots46.ts
// ONLY picks scenes (`wave`, `kitchen`) and VIEWPORTS picks screens.
import { Array, Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_844,
  PHONE_932,
  UPRIGHT_390,
  UPRIGHT_430,
  deviceQuery,
  finish,
  isPickedScene,
  openBrowser,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  tagOr,
} from './lib'
import { attempt } from './page'

const VIEWPORTS = pickViewports([
  { name: 'p360', width: 360, height: 780, scale: 3, isPhone: true },
  { ...UPRIGHT_390, name: 'p390' },
  { ...UPRIGHT_430, name: 'p430' },
  { name: 'l780', width: 780, height: 360, scale: 3, isPhone: true },
  { ...PHONE_844, name: 'l844' },
  { ...PHONE_932, name: 'l932' },
  { ...DESKTOP_1280, name: 'd1280' },
])

const GROANER = { width: 8, height: 10 }
const PLAYER = { width: 8, height: 11 }

type Scene = Readonly<{ name: string; query: string }>

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wave',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&crowd=10&god&px=150&py=110&aim=250,90',
  },
  {
    name: 'kitchen',
    query: 'wave=4&seen=all&start=wave&kitchen&god&crowd=6&px=30&py=-160',
  },
]

const measure = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.game-canvas')
      if (canvas === null) {
        return undefined
      }
      const box = canvas.getBoundingClientRect()
      return {
        cssPerWorldPx: box.width / canvas.width,
        view: { width: canvas.width, height: canvas.height },
        layout:
          document.querySelector('.game-root')?.getAttribute('data-layout') ??
          '',
      }
    }),
  )

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* tagOr('after')
    const viewports = yield* VIEWPORTS
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=72'])
    const problems: Array<string> = []

    for (const viewport of viewports) {
      const scenes = yield* Effect.filter(SCENES, ({ name }) =>
        isPickedScene(name),
      )
      for (const scene of scenes) {
        const page = yield* pages.open(
          viewport,
          Array.join(
            Array.filter([scene.query, deviceQuery(viewport)], Boolean),
            '&',
          ),
        )
        yield* settleAnimations(page)
        yield* shot(page, `s46-${tag}-${viewport.name}-${scene.name}`)
        const size = yield* measure(page)
        const where = `${viewport.name} ${scene.name}`
        if (size === undefined) {
          problems.push(`${where}: no world canvas`)
        } else {
          const px = (side: number) => Math.round(side * size.cssPerWorldPx)
          yield* Console.log(
            `${where} (${size.layout}): view ${size.view.width}x${size.view.height}, ${size.cssPerWorldPx.toFixed(3)} css px a world px, Groaner ${px(GROANER.width)}x${px(GROANER.height)}, player ${px(PLAYER.width)}x${px(PLAYER.height)}`,
          )
          if (!viewport.isPhone && size.view.width !== 320) {
            problems.push(`${where}: the desktop shows ${size.view.width} wide`)
          }
        }
        pages.release(page)
      }
    }

    yield* pages.close

    yield* finish(problems, 'measured')
  }),
)
