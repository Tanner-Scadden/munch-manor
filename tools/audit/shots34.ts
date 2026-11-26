import { Array, Config, Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import { readPortrait } from './inPage/shots34'
import {
  ANDROID_800,
  type Act,
  type Log,
  PHONE_667,
  PHONE_844,
  type ScenePages,
  UPRIGHT_360,
  UPRIGHT_375,
  UPRIGHT_390,
  UPRIGHT_430,
  type Viewport,
  auditTag,
  finish,
  forEachInOrder,
  isPickedScene,
  openBrowser,
  parallelFrom,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
} from './lib'
import { attempt } from './page'

const PICKABLE_VIEWPORTS: ReadonlyArray<Viewport> = [
  { ...UPRIGHT_390, name: 'p390' },
  { ...UPRIGHT_430, name: 'p430' },
  { ...UPRIGHT_360, name: 'p360' },
  { ...UPRIGHT_375, name: 'p375' },
  { ...PHONE_844, name: 'l844' },
  { ...PHONE_667, name: 'l667' },
  { ...ANDROID_800, name: 'l800' },
]

type Scene = Readonly<{
  name: string
  query: string
  act?: Act
}>

const clickButton =
  (name: RegExp): Act =>
  page =>
    Effect.andThen(
      attempt(() => page.getByRole('button', { name }).first().click()),
      attempt(() =>
        page.locator('dialog[open]').first().waitFor({ state: 'visible' }),
      ),
    )

const LOBBY_QUERY = 'learned=move,fire&rank=300&calling=Handyman'

const toLobby: Act = page =>
  Effect.andThen(
    attempt(() => page.getByRole('button', { name: /^play/i }).first().click()),
    attempt(() =>
      page.locator('.coop[data-screen="Solo"]').waitFor({ state: 'visible' }),
    ),
  )

const toLobbyHero: Act = page =>
  Effect.andThen(toLobby(page), clickButton(/^hero/i)(page))

const fromHand =
  (name: RegExp): Act =>
  page =>
    Effect.andThen(clickButton(/^more/i)(page), clickButton(name)(page))

const tapTab =
  (name: RegExp): Act =>
  page =>
    Effect.gen(function* () {
      const box = yield* attempt(() =>
        page.getByRole('tab', { name }).first().boundingBox(),
      )
      if (box !== null) {
        yield* attempt(() =>
          page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2),
        )
      }
      yield* settleAnimations(page)
    })

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wave',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&crowd=10&tough&px=180&py=135&aim=280,60',
  },
  {
    name: 'lowammo',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9&boosts=RapidFire,Damage,Speed,Pierce&px=60&py=130',
  },
  {
    name: 'break',
    query:
      'wave=3&seen=all&gun=smg&money=120&barricades=1&turrets=1&px=60&py=130',
  },
  {
    name: 'breakright',
    query: 'wave=7&seen=all&gun=smg&money=120&px=280&py=60',
  },
  {
    name: 'firstbreak',
    query: 'wave=2&seen=all&money=45&barricades=1&break=open&px=200&py=40',
  },
  { name: 'shop', query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142' },
  {
    name: 'shoptraps',
    query:
      'wave=5&money=180&gun=smg&tier=1&planks=West,North&plankhp=12&px=270&py=142',
    act: tapTab(/^Traps,/),
  },
  { name: 'home', query: '' },
  { name: 'home-rank', query: 'rank=1850' },
  {
    name: 'home-hint-gone',
    query: '',
    act: page =>
      Effect.gen(function* () {
        const hint = page.getByRole('button', { name: /turn sideways/i })
        if ((yield* attempt(() => hint.count())) > 0) {
          yield* attempt(() => hint.click())
        }
      }),
  },
  {
    name: 'bests',
    query: 'bests&kills=Shambler:40,Runner:12&newentries=Runner',
  },
  {
    name: 'home-corner',
    query: 'bests&kills=Shambler:40,Runner:12&fit=full&install&newer',
  },
  {
    name: 'home-guide',
    query: 'fit=home',
    act: clickButton(/add to home screen/i),
  },
  { name: 'greet', query: 'greet' },
  {
    name: 'boss',
    query:
      'wave=8&seen=all&start=wave&elapsed=9000&boss=stomp&windMs=500&bx=200&by=80&px=150&py=128',
  },
  {
    name: 'card',
    query: 'wave=2&start=wave&seen=Shambler&card=2000',
  },
  { name: 'pause', query: 'wave=3&seen=all&start=wave&phase=paused' },
  { name: 'gameover', query: 'wave=5&phase=gameover&stats' },
  { name: 'victory', query: 'wave=8&phase=escaped&stats' },
  { name: 'hand', query: 'support', act: clickButton(/^more/i) },
  { name: 'whatsnew', query: '', act: fromHand(/what's new/i) },
  {
    name: 'munchopedia',
    query: 'kills=Shambler:40,Runner:12',
    act: fromHand(/munchopedia/i),
  },
  { name: 'character', query: '', act: fromHand(/^character/i) },
  { name: 'howto', query: '', act: fromHand(/how to play/i) },
  { name: 'settings', query: '', act: clickButton(/settings/i) },
  {
    name: 'settings-rotate',
    query: 'rotate&fit=full',
    act: clickButton(/settings/i),
  },
  { name: 'difficulty', query: 'ask', act: clickButton(/^play/i) },
  { name: 'lobby', query: LOBBY_QUERY, act: toLobby },
  {
    name: 'lobby-hard',
    query: `${LOBBY_QUERY}&difficulty=Hard&nightmare=Unlocked`,
    act: toLobby,
  },
  { name: 'lobby-you', query: 'learned=move,fire', act: toLobby },
  { name: 'lobby-hero', query: LOBBY_QUERY, act: toLobbyHero },
]

const MIN_SIDE = 48

const checkScene = (
  pages: ScenePages,
  tag: string,
  viewport: Viewport,
  scene: Scene,
  log: Log,
) =>
  Effect.gen(function* () {
    const problems: Array<string> = []
    const page = yield* pages.open(viewport, scene.query)
    if (scene.act !== undefined) {
      yield* scene.act(page)
    }
    yield* settleAnimations(page)
    const report = yield* attempt(() => page.evaluate(readPortrait))
    yield* shot(page, `s34-${tag}-${viewport.name}-${scene.name}`)
    const where = `${viewport.name} ${scene.name}`
    log(
      `${where} (${report.layout}): ${report.buttons.length} buttons${report.pageScrolls ? ', PAGE SCROLLS' : ''}`,
    )
    if (report.pageScrolls) {
      problems.push(`${where}: the page scrolls`)
    }
    if (report.offScreen > 0) {
      problems.push(`${where}: ${report.offScreen} dialog parts off screen`)
    }
    for (const button of report.buttons) {
      if (button.width < MIN_SIDE || button.height < MIN_SIDE) {
        problems.push(
          `${where}: "${button.name}" is ${button.width}x${button.height}`,
        )
      }
      if (!button.isHit) {
        problems.push(`${where}: "${button.name}" is covered at its center`)
      }
      if (!button.isOnScreen) {
        problems.push(`${where}: "${button.name}" is off screen`)
      }
    }
    pages.release(page)
    return problems
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* pickViewports(PICKABLE_VIEWPORTS)
    const scenes = yield* Effect.filter(SCENES, scene =>
      isPickedScene(scene.name),
    )
    const units = Array.flatMap(viewports, viewport =>
      Array.map(scenes, scene => ({ viewport, scene })),
    )
    const browser = yield* openBrowser
    const quality = yield* Config.String('QUALITY').pipe(Config.withDefault(''))
    const pages = scenePages(browser, [
      'device=touch',
      'nodev',
      'tick=72',
      quality === '' ? '' : `quality=${quality}`,
    ])
    const parallel = yield* parallelFrom('SHOTS_PARALLEL')
    const problems = yield* forEachInOrder(
      units,
      parallel,
      ({ viewport, scene }, log) =>
        checkScene(pages, tag, viewport, scene, log),
    )
    yield* pages.close
    yield* finish(Array.flatten(problems), 'no problems')
  }),
)
