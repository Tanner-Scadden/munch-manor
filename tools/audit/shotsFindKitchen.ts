// The "find the kitchen" pass: the boarded door up close with its light and
// steam, Rattles' bubble on screen and pinned at the edge, and the rooms
// counter in a break before and after the kitchen opens, on a 1280x720
// desktop, an 844x390 phone on its side, and a 390x844 phone held upright, as
// `sfk-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsFindKitchen.ts
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
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  useHarness,
  wait,
} from './lib'

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'desktop' },
  { ...PHONE_844, name: 'phone-landscape' },
  { ...UPRIGHT_390, name: 'phone-portrait' },
])

const LEARNED =
  'seen=all&learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const BREAK = `wave=3&prep=40000&money=90&${LEARNED}`

type Scene = Readonly<{ name: string; query: string; hold?: string }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'door-near', query: `${BREAK}&money=0&px=70&py=44&tick=450` },
  {
    name: 'door-padlock',
    query: `wave=2&prep=40000&${LEARNED}&px=70&py=44&tick=450`,
  },
  { name: 'bubble-in-view', query: `${BREAK}&px=100&py=90&tick=30` },
  { name: 'bubble-pinned', query: `${BREAK}&px=240&py=120&tick=30` },
  { name: 'counter-before', query: `${BREAK}&px=160&py=100&tick=30` },
  {
    name: 'counter-after',
    query: `${BREAK}&openexits=Kitchen&px=160&py=100&tick=30`,
  },
  {
    name: 'counter-sparkle',
    query: `${BREAK}&px=70&py=30&tick=10`,
    hold: 'KeyE',
  },
]

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
    if (scene.hold !== undefined) {
      await page.keyboard.down(scene.hold)
      await wait(1500)
      await page.keyboard.up(scene.hold)
      await wait(300)
    }
    await shot(page, `sfk-${TAG}-${viewport.name}-${scene.name}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish([], 'Shots taken.')
