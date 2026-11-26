import { Config, Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import { inspectNarrow } from './inPage/shotsNarrow'
import {
  type Act,
  auditTag,
  deviceQuery,
  finish,
  fromHand,
  harnessQuery,
  inOrder,
  isPickedScene,
  openBrowser,
  openLobby,
  pickViewports,
  press,
  scenePages,
  settleAnimations,
  wait,
} from './lib'
import { attempt } from './page'

const VIEWPORTS = pickViewports([
  { name: 'p360', width: 360, height: 780, scale: 3, isPhone: true },
  { name: 'l780', width: 780, height: 360, scale: 3, isPhone: true },
])

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'
const SHOP = 'wave=5&money=180&gun=smg&tier=1&px=270&py=142'
const MIN_LOOK_TAP = 44

type Scene = Readonly<{
  name: string
  query: string
  act?: Act
  isLook?: boolean
}>

const tapTab =
  (name: RegExp): Act =>
  page =>
    Effect.gen(function* () {
      const tab = page.getByRole('tab', { name }).first()
      const count = yield* attempt(() => tab.count())
      const box = count === 0 ? null : yield* attempt(() => tab.boundingBox())
      if (box !== null) {
        yield* attempt(() =>
          page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2),
        )
      }
      yield* settleAnimations(page)
    })

const lobby: Act = page =>
  Effect.gen(function* () {
    yield* openLobby(page)
    yield* wait(500)
    yield* settleAnimations(page)
  })

const PROFILE = `${LEARNED}&rank=2400&bones=120`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'shop-guns', query: SHOP },
  { name: 'shop-traps', query: SHOP, act: tapTab(/^Traps,/) },
  { name: 'shop-health', query: SHOP, act: tapTab(/^Health,/) },
  { name: 'shop-fridge', query: SHOP, act: tapTab(/^Fridge,/) },
  { name: 'shop-house', query: SHOP, act: tapTab(/^House,/) },
  { name: 'home', query: LEARNED },
  { name: 'home-rank', query: `${LEARNED}&rank=1850` },
  {
    name: 'lobby',
    query: `${LEARNED}&rank=4200&calling=Handyman&mods=10`,
    act: lobby,
  },
  {
    name: 'lobby-bot',
    query: `${LEARNED}&rank=4200&calling=Handyman&lobbybots=1&mods=15`,
    act: lobby,
  },
  { name: 'coop-host', query: 'coop=host&mods=10' },
  { name: 'coop-guest', query: 'coop=guest&mods=9' },
  {
    name: 'look-body',
    query: `${PROFILE}&profile=look&looksection=Body`,
    isLook: true,
  },
  {
    name: 'look-hair',
    query: `${PROFILE}&profile=look&looksection=Hair`,
    isLook: true,
  },
  {
    name: 'look-outfit',
    query: `${PROFILE}&profile=look&looksection=Outfit`,
    isLook: true,
  },
  {
    name: 'look-gear',
    query: `${PROFILE}&profile=look&looksection=Gear`,
    isLook: true,
  },
  { name: 'name', query: `${PROFILE}&profile=name` },
  {
    name: 'account',
    query: `${PROFILE}&profile=account&sync=synced&devices=2`,
  },
  { name: 'settings', query: `${PROFILE}&profile=settings` },
  {
    name: 'munch-list',
    query: 'kills=Shambler:40,Runner:12',
    act: fromHand(/munchopedia/i),
  },
  {
    name: 'munch-shop',
    query: 'kills=Shambler:40,Runner:12',
    act: inOrder(fromHand(/munchopedia/i), press(/^shop,/i)),
  },
  {
    name: 'end-solo',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=162&rankgain=129&mods=14&tick=400`,
  },
  {
    name: 'end-crew',
    query: `wave=10&phase=escaped&stats&party=3&${LEARNED}&rank=2400&rankgain=204&mods=9&tick=400`,
  },
]

type Report = Readonly<{
  past: ReadonlyArray<string>
  sideways: ReadonlyArray<string>
  small: ReadonlyArray<string>
  pageScrolls: boolean
}>

const inspect = (page: Page, minTap: number) =>
  attempt((): Promise<Report> => page.evaluate(inspectNarrow, minTap))

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* VIEWPORTS
    const shots = yield* Config.String('NARROW_SHOTS').pipe(
      Config.withDefault('/tmp/narrow-shots'),
    )
    const browser = yield* openBrowser
    const problems: Array<string> = []
    const pages = scenePages(browser, ['nodev', 'tick=72'])
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
        yield* settleAnimations(page)
        const where = `${viewport.name} ${scene.name}`
        const report = yield* inspect(
          page,
          scene.isLook === true ? MIN_LOOK_TAP : 0,
        )
        for (const item of report.past) {
          problems.push(`${where}: past the edge: ${item}`)
        }
        for (const item of report.sideways) {
          problems.push(`${where}: scrolls sideways: ${item}`)
        }
        for (const item of report.small) {
          problems.push(`${where}: under ${MIN_LOOK_TAP} px tall: ${item}`)
        }
        if (report.pageScrolls) {
          problems.push(`${where}: the page scrolls`)
        }
        yield* attempt(() =>
          page.screenshot({
            path: `${shots}/narrow-${tag}-${viewport.name}-${scene.name}.png`,
            animations: 'disabled',
          }),
        )
        yield* Console.log(`shot ${where}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The narrow phone pass found no problems.')
  }),
)
