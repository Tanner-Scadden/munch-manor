import { Console, Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import { readDialogButtons } from './inPage/shots50'
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
  press,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'
import { attempt } from './page'

type Scene = Readonly<{
  name: string
  query: string
  act?: Act
}>

const SHOP = 'wave=5&money=180&gun=smg&tier=1&px=270&py=142'
const MIN_SIDE = 48

const GUIDE = press('Shop guide')

const SCENES: ReadonlyArray<Scene> = [
  { name: 'help', query: SHOP },
  { name: 'guns', query: SHOP, act: GUIDE },
  {
    name: 'traps',
    query: SHOP,
    act: inOrder(GUIDE, press('Traps')),
  },
  {
    name: 'health',
    query: SHOP,
    act: inOrder(GUIDE, press('Health')),
  },
  {
    name: 'fridge',
    query: SHOP,
    act: inOrder(GUIDE, press('Fridge')),
  },
  {
    name: 'fridge-pulled',
    query: `${SHOP}&prizes=Cooker,Freeze`,
    act: inOrder(GUIDE, press('Fridge')),
  },
  {
    name: 'house',
    query: SHOP,
    act: inOrder(GUIDE, press('House')),
  },
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
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=72'])
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
        if (scene.act !== undefined) {
          yield* scene.act(page)
        }
        yield* settleAnimations(page)
        const label = `${viewport.name} ${scene.name}`
        const report = yield* attempt(() => page.evaluate(readDialogButtons))
        if (viewport.isPhone) {
          for (const button of report.buttons) {
            if (button.width < MIN_SIDE || button.height < MIN_SIDE) {
              problems.push(
                `${label}: "${button.name}" is ${button.width}x${button.height}`,
              )
            }
          }
        }
        if (report.pageScrolls) {
          problems.push(`${label}: the page scrolls`)
        }
        yield* shot(page, `s50-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}: ${report.buttons.length} buttons`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The shop guide pass found no problems.')
  }),
)
