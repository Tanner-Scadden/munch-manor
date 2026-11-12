// The hands-on actions pass (src/render/actionPose.ts): each action a
// player's body does, stepped tick by tick with the harness's director
// (harness/director.ts) and cropped close round the player, so a strip of
// its frames shows the motion: CPR on a downed teammate and the fist pump,
// rummaging the parlour's trunk, the library's hollow book, hauling the
// dumbwaiter, cranking the gramophone, shoving the stacks, pushing the
// shelf, the barrels, pulling the bulb's chain, stirring the soup pot, a
// hold at the fridge, a swap's toss, a reload, and a trap set down. On a
// 1280x720 desktop, as `actions-<TAG>-<scene>-<frame>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsActions.ts
// ONLY picks scenes.
import { Array, Effect, Schema, String } from 'effect'
import type { Page } from 'playwright-core'

import { encodeJson } from '../json'
import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  LEARNED_ALL,
  OPEN_BREAK,
  SHOTS_DIR,
  auditTag,
  closePage,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  sceneReady,
  settled,
} from './lib'
import { attempt, evaluateAs } from './page'

const VIEWPORT = { ...DESKTOP_1280, name: 'd1280' }
// NOTE: the page draws a game pixel as 4 of its own at 1280x720, and the
// crop is 64 by 48 game pixels round the player's feet.
const PAGE_SCALE = 4
const CROP_WIDTH = 64
const CROP_HEIGHT = 48

const OPEN = 'openexits=Kitchen,West,East,Far,Secret'
const WAVE = `${LEARNED_ALL}&wave=3&start=wave&elapsed=6000&${OPEN}&god`

type Tap = Readonly<{ at: number; key: string }>

type Revive = Readonly<{
  down: number
  reviver: number
  at: number
  walkAt: number
  bleedMs: number
  spot: readonly [number, number]
}>

type Scene = Readonly<{
  name: string
  query: string
  // NOTE: the ticks each frame is shot on, and the seat followed.
  ticks: ReadonlyArray<number>
  slot?: number
  taps?: ReadonlyArray<Tap>
  coop?: Readonly<{
    seed: number
    preroll: number
    god: boolean
    revive: Revive
  }>
}>

const every = (from: number, to: number, by: number): ReadonlyArray<number> =>
  Array.makeBy(Math.floor((to - from) / by) + 1, index => from + index * by)

const toolScene = (id: string, x: number, y: number): Scene => ({
  name: `tool-${id}`,
  query: `${WAVE}&tool=${id}&px=${x}&py=${y}`,
  ticks: every(4, 76, 6),
})

const findScene = (name: string, room: string): Scene => ({
  name: `find-${name}`,
  query: `${OPEN_BREAK}&findroom=${room}&findwork=0.05`,
  ticks: every(4, 136, 6),
})

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'cpr',
    query: `coop=host&seed=7&seen=all&${LEARNED_ALL}`,
    ticks: every(300, 520, 8),
    slot: 1,
    coop: {
      seed: 7,
      preroll: 5640,
      god: true,
      revive: {
        down: 0,
        reviver: 1,
        at: 240,
        walkAt: 256,
        bleedMs: 9000,
        spot: [160, 104],
      },
    },
  },
  findScene('parlour', 'Parlour'),
  findScene('library', 'Library'),
  findScene('kitchen', 'Kitchen'),
  toolScene('Gramophone', -215, 105),
  toolScene('NorthStack', 535, 75),
  toolScene('Shelf', 355, 140),
  toolScene('Barrels', 855, 105),
  toolScene('Bulb', 845, 75),
  toolScene('SoupPot', 75, -95),
  {
    name: 'fridge-hold',
    query: `wave=3&seen=all&kitchen&money=200&gun=smg&prep=14000&px=180&py=-100&hold&fridgeseed=2&seed=3&${LEARNED_ALL}`,
    ticks: every(2, 44, 3),
  },
  {
    name: 'swap',
    query: `${WAVE}&gun=smg&px=100&py=100`,
    ticks: every(8, 30, 2),
    taps: [{ at: 10, key: 'KeyQ' }],
  },
  {
    name: 'reload',
    query: `${WAVE}&gun=smg&loaded=5&px=100&py=100`,
    ticks: every(8, 140, 8),
    taps: [{ at: 10, key: 'KeyR' }],
  },
  {
    name: 'trap',
    query: `${WAVE}&barricades=2&px=100&py=100`,
    ticks: every(8, 40, 3),
    taps: [{ at: 10, key: 'KeyT' }],
  },
]

// NOTE: the harness decodes the plan with its own Schema
// (harness/director.ts); this one only writes it.
const PlanJson = Schema.Struct({
  segments: Schema.Array(Schema.Unknown),
  taps: Schema.Array(Schema.Struct({ at: Schema.Finite, key: Schema.String })),
  cards: Schema.Array(Schema.Unknown),
  coop: Schema.optionalKey(Schema.Unknown),
})

const planOf = (scene: Scene): string =>
  encodeJson(PlanJson)({
    segments: [],
    taps: scene.taps ?? [],
    cards: [],
    ...(scene.coop === undefined ? {} : { coop: scene.coop }),
  })

const Seats = Schema.Struct({
  seats: Schema.Array(
    Schema.Struct({ slot: Schema.Finite, x: Schema.Finite, y: Schema.Finite }),
  ),
})

const stepTo = (page: Page, target: number) =>
  Effect.gen(function* () {
    const now = yield* attempt(() => page.evaluate(() => window.__directedTick))
    if (now !== undefined && target > now) {
      yield* attempt(() =>
        page.evaluate(n => window.__director.step(n), target - now),
      )
      yield* attempt(() =>
        page.waitForFunction(
          expected => window.__directedTick === expected,
          target,
          { polling: 'raf', timeout: 60_000 },
        ),
      )
    }
    yield* settled(page)
  })

const shootScene = (page: Page, tag: string, scene: Scene) =>
  Effect.gen(function* () {
    yield* attempt(() =>
      page.goto(harnessUrl(scene.query, 'director', 'nodev', 'seed=7')),
    )
    yield* sceneReady(page)
    yield* attempt(() =>
      page.evaluate(json => window.__director.start(json), planOf(scene)),
    )
    yield* Effect.forEach(
      scene.ticks,
      (tick, index) =>
        Effect.gen(function* () {
          yield* stepTo(page, tick)
          const { seats } = yield* evaluateAs(page, Seats, () =>
            window.__director.seats(),
          )
          const seat = Array.findFirst(
            seats,
            ({ slot }) => slot === (scene.slot ?? 0),
          )
          const { x, y } = seat._tag === 'Some' ? seat.value : { x: 160, y: 90 }
          yield* attempt(() =>
            page.screenshot({
              path: `${SHOTS_DIR}/actions-${tag}-${scene.name}-${String.padStart(2, '0')(`${index}`)}.png`,
              animations: 'disabled',
              clip: {
                x: Math.max(0, (x - CROP_WIDTH / 2) * PAGE_SCALE),
                y: Math.max(0, (y - CROP_HEIGHT * 0.7) * PAGE_SCALE),
                width: CROP_WIDTH * PAGE_SCALE,
                height: CROP_HEIGHT * PAGE_SCALE,
              },
            }),
          )
        }),
      { discard: true },
    )
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const browser = yield* openBrowser
    yield* Effect.forEach(
      SCENES,
      scene =>
        Effect.gen(function* () {
          if (!(yield* isPickedScene(scene.name))) {
            return
          }
          const page = yield* openPage(browser, VIEWPORT)
          yield* shootScene(page, tag, scene)
          yield* closePage(page)
        }),
      { discard: true },
    )
  }),
)
