// The picked calling on the real build (not the harness): a save with a
// rank and a calling is put in localStorage, which the game imports on its
// first load, and the home menu, the Profile's Look tab, and a started run
// are shot, as `s49-<TAG>-<viewport>-<scene>.png`. The home hero, the look
// preview, and the player in play must all wear the calling's prop.
//   bun run build && bunx vite preview --port 4173 --strictPort
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsReal.ts
// CALLING picks the calling (Handyman by default).
import { Option, Schema } from 'effect'

import { initialModel } from '@game/model'
import { Calling } from '@game/playerData'
import { pointsForRank } from '@game/rank'
import { SAVE_KEY, encodeSave, saveOf } from '@game/save'

import {
  DESKTOP_1280,
  GAME,
  PHONE_844,
  TAG,
  UPRIGHT_390,
  finish,
  launch,
  openPage,
  shot,
  wait,
} from './lib'

const calling = Schema.decodeUnknownSync(Calling)(
  process.env['CALLING'] ?? 'Handyman',
)

const save = Option.getOrThrow(
  encodeSave({
    ...saveOf(initialModel),
    calling,
    rank: {
      earnedPoints: pointsForRank(16),
      earnedBones: 0,
      veteranPoints: 0,
      veteranBones: 0,
      isVeteranGranted: true,
      spentBones: 0,
    },
  }),
)

const browser = await launch()
const problems: Array<string> = []
for (const viewport of [
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
]) {
  const page = await openPage(browser, viewport)
  await page.addInitScript(
    ([key, json]) => {
      localStorage.setItem(key ?? '', json ?? '')
    },
    [SAVE_KEY, save],
  )
  await page.goto(GAME)
  try {
    await page.waitForSelector('#home-play', { timeout: 20000 })
  } catch {
    problems.push(`${viewport.name}: the home menu never showed PLAY`)
  }
  await wait(1500)
  await shot(page, `s49-${TAG}-${viewport.name}-home`)
  if (!viewport.isPhone) {
    await page.keyboard.press('KeyC')
    await page.locator('.look-tab').waitFor({ state: 'visible' })
    await wait(1500)
    await shot(page, `s49-${TAG}-${viewport.name}-look`)
  }
  await page.context().close()
}
await browser.close()
finish(problems, 'The real build shows the picked calling.')
