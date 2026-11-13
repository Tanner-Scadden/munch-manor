// The beat my run pass: a friend's dare on the home menu's card (BEAT MY
// RUN!, their stamp, hero, skull, mark, wave, things, and the napkin ring
// this player has not opened), the solo lobby it opens with its picks held,
// and the end card of a run against it, NOT YET from a Game Over and BEAT
// IT! from an escape, on a 1280x720 desktop, an 844x390 phone on its side,
// and a 390x844 phone held upright, as `beat-my-run-<viewport>-<scene>.png`
// in BEAT_SHOTS (default /tmp/beat-my-run-shots). It exits with 1 when the
// home shows no card, the lobby's picks are not held, or the card sits over
// another home button.
//   bun run heavy -- --shared bun tools/audit/shotsBeatMyRun.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Config, Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Act,
  clickFirst,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shotViewports,
  wait,
} from './lib'
import { attempt } from './page'

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'
const HOME = `${LEARNED}&rank=4200&calling=Handyman&difficulty=Normal&beat=offered`
const END = `${LEARNED}&rank=1900&rankgain=420&difficulty=Hard&mods=4&dmark=2&beat=taken&stats&tick=400`

// NOTE: what a scene must show: the home card, or the lobby held.
type Expect = Readonly<{ card?: boolean; held?: boolean }>

type Scene = Readonly<{
  name: string
  query: string
  act?: Act
  expect: Expect
}>

const takeDare: Act = page =>
  Effect.andThen(clickFirst('#home-beat')(page), wait(600))

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: HOME, expect: { card: true } },
  { name: 'lobby', query: HOME, act: takeDare, expect: { held: true } },
  { name: 'end-not-yet', query: `wave=4&phase=gameover&${END}`, expect: {} },
  { name: 'end-beat-it', query: `wave=10&phase=escaped&${END}`, expect: {} },
]

type Found = Readonly<{ card: boolean; held: boolean; overlaps: number }>

// NOTE: runs in the page, which has no Effect: plain DOM reads. An overlap
// is a home button whose box crosses the card's.
const readBeat = (page: Page) =>
  attempt((): Promise<Found> =>
    page.evaluate(() => {
      const card = document.querySelector('.beat-card')
      const box = card?.getBoundingClientRect()
      let overlaps = 0
      for (const other of document.querySelectorAll(
        '.home-menu button, .new-entry',
      )) {
        const at = other.getBoundingClientRect()
        if (
          box !== undefined &&
          card !== null &&
          !card.contains(other) &&
          at.width > 0 &&
          at.left < box.right &&
          at.right > box.left &&
          at.top < box.bottom &&
          at.bottom > box.top
        ) {
          overlaps += 1
        }
      }
      return {
        card: card !== null,
        held: document.querySelector(".lobby-picks[data-held='Yes']") !== null,
        overlaps,
      }
    }),
  )

const problems: Array<string> = []

const check = (where: string, expect: Expect, found: Found) => {
  if (expect.card === true && !found.card) {
    problems.push(`${where}: no BEAT MY RUN card`)
  }
  if (expect.card === true && found.overlaps > 0) {
    problems.push(`${where}: the card covers ${found.overlaps} home buttons`)
  }
  if (expect.held === true && !found.held) {
    problems.push(`${where}: the lobby's picks are not held`)
  }
}

runHarnessAudit(
  Effect.gen(function* () {
    const shots = yield* Config.String('BEAT_SHOTS').pipe(
      Config.withDefault('/tmp/beat-my-run-shots'),
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
          yield* settleAnimations(page)
        }
        const where = `${viewport.name} ${scene.name}`
        const found = yield* readBeat(page)
        check(where, scene.expect, found)
        yield* attempt(() =>
          page.screenshot({
            path: `${shots}/beat-my-run-${viewport.name}-${scene.name}.png`,
            animations: 'disabled',
          }),
        )
        yield* Console.log(`shot ${where}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'BEAT MY RUN shows where it should.')
  }),
)
