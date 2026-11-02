// The untimed breaks pass: a solo break with no clock (Normal) with READY
// and then with the nudge, and a co-op break with the other player READY
// and then with the nudge, on 1280x720, 844x390, and 390x844, as
// `s49-<TAG>-<viewport>-<scene>.png`. It exits with 1 when a phone's READY is
// under 48 px, the button is covered at its center, or the nudge moves it.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots49.ts
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
import { LEARNED } from './scenes'

type Scene = Readonly<{ name: string; query: string; twin?: string }>

const SOLO = `wave=4&seen=all&break=open&breakMs=20000&money=60&difficulty=Normal&${LEARNED}`
const CREW = `wave=4&seen=all&break=open&breakMs=20000&money=60&party=2&difficulty=Normal&${LEARNED}`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'solo-break', query: SOLO },
  { name: 'solo-nudge', query: `${SOLO}&idle=16000`, twin: 'solo-break' },
  { name: 'coop-break', query: `${CREW}&mates=ready` },
  {
    name: 'coop-nudge',
    query: `${CREW}&mates=ready&idle=4000`,
    twin: 'coop-break',
  },
]

type Box = Readonly<{
  x: number
  y: number
  width: number
  height: number
  isHit: boolean
  nudge: string
}>

const boxes = new Map<string, Box>()
const problems: Array<string> = []

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
for (const viewport of SHOT_VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const label = `${viewport.name} ${scene.name}`
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    await settleAnimations(page)
    const found = await page.evaluate(() => {
      const button = document.querySelector(
        '.start-wave-pill, .start-wave-button',
      )
      if (button === null) {
        return null
      }
      const rect = button.getBoundingClientRect()
      const top = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        isHit: top !== null && button.contains(top),
        nudge: button.getAttribute('data-nudge') ?? '',
      }
    })
    if (found === null) {
      problems.push(`${label}: no READY button`)
    } else {
      boxes.set(`${viewport.name} ${scene.name}`, found)
      if (viewport.isPhone && found.height < 47.5) {
        problems.push(`${label}: READY is under 48 px tall`)
      }
      if (!found.isHit) {
        problems.push(`${label}: READY is covered at its center`)
      }
      const wantsNudge = scene.name.endsWith('nudge')
      if (found.nudge !== (wantsNudge ? 'true' : 'false')) {
        problems.push(`${label}: data-nudge is ${found.nudge}`)
      }
      const twin = boxes.get(`${viewport.name} ${scene.twin ?? ''}`)
      if (
        twin !== undefined &&
        (twin.x !== found.x ||
          twin.y !== found.y ||
          twin.width !== found.width ||
          twin.height !== found.height)
      ) {
        problems.push(`${label}: the nudge moved READY`)
      }
    }
    await shot(page, `s49-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'READY is big, uncovered, and holds still when it nudges.')
