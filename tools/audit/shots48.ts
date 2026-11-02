// The teammate bots pass: the single player lobby with its + BOT tiles, with
// one bot and with three, a run with three bots mid-wave, and the end card
// with bots, on a 1280x720 desktop, an 844x390 phone on its side, and a
// 390x844 phone held upright, as `s48-<TAG>-<viewport>-<scene>.png`. It exits
// with 1 when a + BOT tile or an x is under 48 px on a phone, or the seats
// run past the screen.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots48.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import {
  DESKTOP_1280,
  PHONE_844,
  TAG,
  UPRIGHT_390,
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
  wait,
} from './lib'

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'desktop' },
  { ...PHONE_844, name: 'phone-side' },
  { ...UPRIGHT_390, name: 'phone-up' },
])

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
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

const problems: Array<string> = []

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
    if (scene.bots !== undefined) {
      await openLobby(page)
      for (let added = 0; added < scene.bots; added += 1) {
        await page.keyboard.press('KeyB')
        await page
          .locator('.lobby-seat-bot')
          .nth(added)
          .waitFor({ state: 'visible' })
      }
      await wait(500)
      await settleAnimations(page)
      const found = await page.evaluate(() => {
        const sizes = [
          ...document.querySelectorAll('.lobby-add-bot, .lobby-drop-bot'),
        ].map(element => {
          const box = element.getBoundingClientRect()
          return { width: box.width, height: box.height }
        })
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
      })
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
    await shot(page, `s48-${TAG}-${viewport.name}-${scene.name}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(
  problems,
  'The + BOT tiles and the bots fit, and every button is big enough.',
)
