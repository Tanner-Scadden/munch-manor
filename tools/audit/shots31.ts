import { focusOf } from '@game/party'

// The gun cluster pass: the guns at the bottom middle with the icons beside
// them, in a wave, with a low magazine, in a break with traps, and in a break
// with traps and a low magazine, on four landscape phones with touch and on a
// 1280x720 desktop with a keyboard, as `s31-<TAG>-<viewport>-<scene>.png`.
// For every visible button it checks that the center and four points just
// inside its edges hit that button, that it is at least 48 px on a phone, and
// that it covers no doorway, the stall, the player, or another button. Exits
// with 1 on any problem.
//   TAG=after bun shots31.ts
// ONLY picks scenes, such as `ONLY=wave,break`.
import {
  ANDROID_915,
  DESKTOP_1280,
  PHONE_667,
  PHONE_844,
  PHONE_932,
  TAG,
  type Viewport,
  deviceQuery,
  finish,
  gotoScene,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  settleAnimations,
  shot,
  useHarness,
} from './lib'

const VIEWPORTS: ReadonlyArray<Viewport> = [
  PHONE_667,
  PHONE_844,
  PHONE_932,
  ANDROID_915,
  DESKTOP_1280,
]

type Scene = Readonly<{ name: string; query: string }>

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wave',
    query: 'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&px=150&py=110',
  },
  {
    name: 'lowammo',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9&px=150&py=110',
  },
  {
    name: 'break',
    query:
      'wave=3&seen=all&gun=smg&money=120&barricades=1&turrets=1&px=200&py=100',
  },
  {
    name: 'lowbreak',
    query:
      'wave=3&seen=all&gun=smg&loaded=9&money=120&barricades=1&turrets=1&px=200&py=100',
  },
  {
    name: 'firstbreak',
    query: 'wave=2&seen=all&money=45&barricades=1&break=open&px=200&py=40',
  },
]

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const AREAS: ReadonlyArray<Readonly<{ name: string; box: Box }>> = [
  { name: 'north door', box: { x: 210, y: 0, width: 20, height: 20 } },
  { name: 'west door', box: { x: 0, y: 80, width: 10, height: 20 } },
  { name: 'east door', box: { x: 310, y: 80, width: 10, height: 20 } },
  { name: 'south door', box: { x: 80, y: 170, width: 20, height: 10 } },
  { name: 'stall', box: { x: 250, y: 135, width: 40, height: 37 } },
]

const EDGE_INSET = 2
const MIN_SIDE = 48

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height

const problems: Array<string> = []
await useHarness()
const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await openPage(browser, viewport)
    await gotoScene(page, harnessUrl(scene.query, deviceQuery(viewport)))
    await settleAnimations(page)
    const report = await page.evaluate(inset => {
      const stage = document.querySelector('.game-stage')
      if (stage === null) {
        throw new Error('No .game-stage on the page')
      }
      const rect = stage.getBoundingClientRect()
      const model = window.__model
      const buttons = Array.from(document.querySelectorAll('button'))
        .filter(button => {
          const box = button.getBoundingClientRect()
          const style = getComputedStyle(button)
          return (
            box.width > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            button.closest('dialog') === null
          )
        })
        .map(button => {
          const box = button.getBoundingClientRect()
          const cx = box.x + box.width / 2
          const cy = box.y + box.height / 2
          const points = [
            ['center', cx, cy],
            ['left', box.left + inset, cy],
            ['right', box.right - inset, cy],
            ['top', cx, box.top + inset],
            ['bottom', cx, box.bottom - inset],
          ] as const
          const misses = points
            .filter(([, x, y]) => {
              const hit = document.elementFromPoint(x, y)
              return hit === null || !button.contains(hit)
            })
            .map(([name]) => name)
          return {
            label:
              button.getAttribute('aria-label') ?? button.textContent.trim(),
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            misses,
          }
        })
      return {
        stage: { x: rect.x, y: rect.y, scale: rect.width / 320 },
        player: { x: focusOf(model).player.x, y: focusOf(model).player.y },
        buttons,
      }
    }, EDGE_INSET)
    const { stage } = report
    const toClient = (box: Box): Box => ({
      x: stage.x + box.x * stage.scale,
      y: stage.y + box.y * stage.scale,
      width: box.width * stage.scale,
      height: box.height * stage.scale,
    })
    const areas = [
      ...AREAS,
      {
        name: 'player',
        box: {
          x: report.player.x - 5,
          y: report.player.y - 8,
          width: 10,
          height: 14,
        },
      },
    ]
    const where = `${viewport.name} ${scene.name}`
    const lines = [
      ...report.buttons.flatMap(button =>
        areas
          .filter(area => overlaps(button, toClient(area.box)))
          .map(area => `"${button.label}" covers the ${area.name}`),
      ),
      ...report.buttons.flatMap((button, index) =>
        report.buttons
          .slice(index + 1)
          .filter(other => overlaps(button, other))
          .map(other => `"${button.label}" overlaps "${other.label}"`),
      ),
      ...report.buttons.flatMap(button =>
        button.misses.map(name => `"${button.label}": the ${name} misses it`),
      ),
      ...(viewport.isPhone
        ? report.buttons
            .filter(
              button => button.width < MIN_SIDE || button.height < MIN_SIDE,
            )
            .map(
              button =>
                `"${button.label}" is ${Math.round(button.width)}x${Math.round(button.height)}`,
            )
        : []),
    ]
    console.log(
      `${where}: ${report.buttons.map(b => `"${b.label}" ${Math.round(b.width)}x${Math.round(b.height)}`).join(' ')}`,
    )
    for (const line of lines) {
      console.log(`  ! ${line}`)
      problems.push(`${where} ${line}`)
    }
    await shot(page, `s31-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()

finish(
  problems,
  'Every button hits itself and keeps clear of the doors and the stall.',
)
