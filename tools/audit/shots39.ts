// The Mystery Leftovers pass: the fridge in the open kitchen with its price
// tag lit and the hold's ring part filled, the reveal (its spin, and each
// prize landed: Cooker, Pan, Brain Freeze, Sandwich, Dud), a weapon on
// offer with its TAKE tag and the gun it would replace, the take's flight
// and the slot's pulse, the fridge chained shut after a slam,
// the Pressure Cooker charging with lids in the air and one bursting, the
// Clang Pan mid-swing with zombies reeling, Brain Freeze spraying with
// zombies frozen and chilled, and the pause screen's control cards, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `s39-<TAG>-<viewport>-<scene>.png`. It checks that a hold at
// the fridge pulls it and that the control cards fit without scrolling, and
// exits with 1 on any miss.
//   TAG=after bun run heavy -- bun tools/audit/shots39.ts
// ONLY picks scenes, such as `ONLY=tag,pull`, and VIEWPORTS picks screens.
import { Array, Console, Effect, Record } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  SHOTS_DIR,
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'
import { type AuditFailed, attempt } from './page'
import { BREAK, IN_KITCHEN, LEARNED } from './scenes'

type Scene = Readonly<{
  name: string
  query: string
  // NOTE: a control card's frames take turns through a looping animation,
  // which a shot with animations off holds at a hidden frame, so the pause
  // shot lets them run.
  isAnimated?: boolean
  act?: (
    page: Page,
    problems: Array<string>,
    label: string,
  ) => Effect.Effect<void, AuditFailed>
}>

// NOTE: every scene plays its frames at once with `tick=N` (N frames of
// 1/60 s) and holds there, so each picture is the same on every run. The
// fridge stands in the kitchen's north-east corner, tiles 17 and 18 of rows
// -13 and -12, so (180, -102) is just in reach below its door. The weapon
// scenes stand at (40, -12), on the open floor at the kitchen's foot.
const AT_FRIDGE = 'px=180&py=-102'

// NOTE: the fridge seed that draws each prize on a first pull, for a player
// holding the Chatterbox. The hold pays on tick 30, so tick 45 is a quarter
// of a second into the reveal's spin, tick 85 shows the prize landed, and
// tick 130 the weapon on offer (the key still held, so it is not taken).
const PRIZE_SEEDS = {
  cooker: 7,
  pan: 1,
  freeze: 2,
  sandwich: 30,
  dud: 4,
} as const

const expectDoor =
  (tag: 'Open' | 'Offering' | 'Shut') =>
  (page: Page, problems: Array<string>, label: string) =>
    Effect.gen(function* () {
      const door = yield* attempt(() =>
        page.evaluate(() => window.__model.fridge.door._tag),
      )
      if (door !== tag) {
        problems.push(`${label}: the fridge door is ${door}, not ${tag}`)
      }
    })

const PULL_SCENES: ReadonlyArray<Scene> = Array.map(
  Record.toEntries(PRIZE_SEEDS),
  ([prize, seed]) => ({
    name: `pull-${prize}`,
    query: `${BREAK}&${AT_FRIDGE}&hold&fridgeseed=${seed}&tick=85`,
    act: expectDoor('Open'),
  }),
)

// NOTE: runs in the page, which has no Effect: plain loops, so no native
// Array method is left for the Effect rules to flag.
const readFit = () => {
  const cards = document.querySelectorAll('.help-card')
  let scrolls = 0
  for (const element of [
    document.scrollingElement,
    ...document.querySelectorAll('*'),
  ]) {
    if (element instanceof HTMLElement) {
      const overflow = getComputedStyle(element).overflowY
      if (
        element.scrollHeight > element.clientHeight + 1 &&
        (overflow === 'auto' || overflow === 'scroll')
      ) {
        scrolls++
      }
    }
  }
  let off = 0
  for (const card of cards) {
    const box = card.getBoundingClientRect()
    if (
      box.left < 0 ||
      box.top < 0 ||
      box.right > window.innerWidth ||
      box.bottom > window.innerHeight
    ) {
      off++
    }
  }
  return { count: cards.length, scrolls, off }
}

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'tag',
    query: `${BREAK}&${AT_FRIDGE}&hold&tick=17`,
  },
  // NOTE: standing still with no key held: the ring fills at half the
  // key's speed, so tick 40 shows it about two thirds round.
  {
    name: 'stand-fridge',
    query: `${BREAK}&${AT_FRIDGE}&tick=40`,
    act: expectDoor('Shut'),
  },
  {
    name: 'stand-boards',
    query: `wave=3&seen=all&money=200&gun=smg&prep=14000&${LEARNED}&px=70&py=26&tick=40`,
  },
  {
    name: 'spin',
    query: `${BREAK}&${AT_FRIDGE}&hold&fridgeseed=${PRIZE_SEEDS.freeze}&tick=45`,
    act: expectDoor('Open'),
  },
  ...PULL_SCENES,
  {
    name: 'offer',
    query: `${BREAK}&${AT_FRIDGE}&hold&fridgeseed=${PRIZE_SEEDS.cooker}&tick=130`,
    act: expectDoor('Offering'),
  },
  {
    name: 'take',
    query: `${BREAK}&${AT_FRIDGE}&fridge=offering&prize=Freeze&fridgeMs=5000&hold&tick=40`,
    act: expectDoor('Shut'),
  },
  {
    name: 'take-slot',
    query: `${BREAK}&${AT_FRIDGE}&fridge=offering&prize=Freeze&fridgeMs=5000&hold&tick=60`,
    act: expectDoor('Shut'),
  },
  {
    name: 'slammed',
    query: `${BREAK}&px=160&py=-96&fridge=slammed&fridgeMs=20000&tick=24`,
  },
  {
    name: 'cooker',
    query: `${IN_KITCHEN}&gun=cooker&stick=60,-8&lobs&tick=40`,
  },
  {
    name: 'pan',
    query: `${IN_KITCHEN}&gun=pan&stick=60,0&iced=pan&tick=34`,
  },
  {
    name: 'freeze',
    query: `${IN_KITCHEN}&gun=freeze&stick=60,0&iced=freeze&tick=14`,
  },
  {
    name: 'pause',
    query: 'wave=3&start=wave&phase=paused&tick=24',
    isAnimated: true,
    act: (page, problems, label) =>
      Effect.gen(function* () {
        const fit = yield* attempt(() => page.evaluate(readFit))
        if (fit.count !== 10) {
          problems.push(`${label}: ${fit.count} control cards, not 10`)
        }
        if (fit.off > 0) {
          problems.push(`${label}: ${fit.off} control cards off screen`)
        }
        if (fit.scrolls > 0) {
          problems.push(`${label}: ${fit.scrolls} panels scroll`)
        }
      }),
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    const problems: Array<string> = []
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        const label = `${viewport.name} ${scene.name}`
        yield* settleAnimations(page)
        if (scene.act !== undefined) {
          yield* scene.act(page, problems, label)
        }
        const name = `s39-${tag}-${viewport.name}-${scene.name}`
        if (scene.isAnimated === true) {
          yield* attempt(() =>
            page.screenshot({ path: `${SHOTS_DIR}/${name}.png` }),
          )
        } else {
          yield* shot(page, name)
        }
        yield* Console.log(`shot ${label}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The Mystery Leftovers pass found no problems.')
  }),
)
