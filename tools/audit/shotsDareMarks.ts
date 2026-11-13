// The dare ladder pass: the single player lobby with marks opened (the pick
// at none, and at mark 6 with every modifier tile on and locked), the co-op
// lobby as the host at mark 5, the solo end card of an escape at mark 6,
// and the Proof Shelf with each difficulty's badge on its row, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `dare-marks-<viewport>-<scene>.png` in DARE_MARK_SHOTS
// (default /tmp/dare-mark-shots). It exits with 1 when a lobby shows no
// mark pick, a held tile is not locked on, or the shelf shows no badge.
//   bun run heavy -- --shared bun tools/audit/shotsDareMarks.ts
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
  openLobby,
  scenePages,
  settleAnimations,
  shotViewports,
  wait,
} from './lib'
import { attempt } from './page'

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'
const LOBBY = `${LEARNED}&rank=4200&calling=Handyman&difficulty=Easy&marks=8`

// NOTE: what a scene must show: the lobby's pick, a count of tiles locked
// on, or the shelf's badges.
type Expect = Readonly<{ pick?: boolean; locked?: number; badges?: number }>

type Scene = Readonly<{
  name: string
  query: string
  inLobby?: boolean
  act?: Act
  expect: Expect
}>

const openShelf: Act = page =>
  Effect.andThen(
    clickFirst('#home-manor')(page),
    clickFirst('#hand-card-proof')(page),
  )

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'solo-none',
    query: LOBBY,
    inLobby: true,
    expect: { pick: true, locked: 0 },
  },
  {
    name: 'solo-mark6',
    query: `${LOBBY}&dmark=6`,
    inLobby: true,
    expect: { pick: true, locked: 4 },
  },
  {
    name: 'coop-host',
    query: 'coop=host&marks=8&dmark=5',
    expect: { pick: true, locked: 4 },
  },
  {
    name: 'end-escape',
    query: `wave=10&phase=escaped&stats&difficulty=Easy&${LEARNED}&rank=1900&rankgain=537&marks=8&dmark=6&tick=400`,
    expect: {},
  },
  {
    name: 'shelf',
    query: 'proof&marks=8',
    act: openShelf,
    expect: { badges: 2 },
  },
]

type Found = Readonly<{ picks: number; locked: number; badges: number }>

// NOTE: runs in the page, which has no Effect: plain DOM counts.
const readMarks = (page: Page) =>
  attempt((): Promise<Found> =>
    page.evaluate(() => ({
      picks: document.querySelectorAll('.dare-mark-pick').length,
      locked: document.querySelectorAll(".modifier-pick[data-locked='Yes']")
        .length,
      badges: document.querySelectorAll('.proof-row-dare-mark').length,
    })),
  )

const problems: Array<string> = []

const check = (where: string, expect: Expect, found: Found) => {
  if (expect.pick === true && found.picks === 0) {
    problems.push(`${where}: no dare mark pick`)
  }
  if (expect.locked !== undefined && found.locked !== expect.locked) {
    problems.push(
      `${where}: ${found.locked} tiles locked on, not ${expect.locked}`,
    )
  }
  if (expect.badges !== undefined && found.badges < expect.badges) {
    problems.push(`${where}: ${found.badges} shelf badges`)
  }
}

runHarnessAudit(
  Effect.gen(function* () {
    const shots = yield* Config.String('DARE_MARK_SHOTS').pipe(
      Config.withDefault('/tmp/dare-mark-shots'),
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
        const found = yield* readMarks(page)
        check(where, scene.expect, found)
        yield* attempt(() =>
          page.screenshot({
            path: `${shots}/dare-marks-${viewport.name}-${scene.name}.png`,
            animations: 'disabled',
          }),
        )
        yield* Console.log(`shot ${where}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'Every dare mark shows where it should.')
  }),
)
