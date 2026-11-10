import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Order,
  Path,
  String,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { Page } from 'playwright-core'

// The update chip, in two parts, as `s26-<TAG>-...png`.
//
// PART=layout (the default) puts a newer build in the harness Model and
// shoots the title, the iPhone tip, Game Over, Victory, both breaks, pause,
// and a wave (which must show no chip) on 667x375, 844x390, and 1280x720. It
// prints the chip's box and any button or panel it overlaps.
//   TAG=after bun shots26.ts
//
// PART=e2e drives the real production build end to end. It builds with
// BUILD_ID=e2e-one, serves dist on 4186 with vite preview, opens the game,
// rebuilds with BUILD_ID=e2e-two while the page stays open, fires
// visibilitychange, waits for the chip, taps it, and checks the reloaded
// page runs the new build. Run it from tools/audit:
//   PART=e2e bun shots26.ts
import * as NodeServices from '@effect/platform-node/NodeServices'

import { runHarnessAuditWith } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_667,
  PHONE_844,
  type Viewport,
  auditTag,
  closePage,
  countOf,
  deviceQuery,
  gotoScene,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  settleAnimations,
  shot,
  wait,
} from './lib'
import { attempt, failWith } from './page'

const VIEWPORTS: ReadonlyArray<Viewport> = [PHONE_667, PHONE_844, DESKTOP_1280]

type Scene = Readonly<{ name: string; query: string; hasChip: boolean }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'title', query: '', hasChip: true },
  { name: 'title-iphone', query: 'fit=home', hasChip: true },
  { name: 'title-android', query: 'fit=full&install&bests', hasChip: true },
  { name: 'unwrap', query: 'unwrap', hasChip: true },
  { name: 'greet', query: 'greet', hasChip: true },
  {
    name: 'gameover',
    query: 'wave=4&phase=gameover&stats&tick=72',
    hasChip: false,
  },
  {
    name: 'victory',
    query: 'wave=8&phase=escaped&stats&tick=72',
    hasChip: false,
  },
  {
    name: 'break1',
    query: 'wave=2&seen=all&money=45&barricades=1&break=open&px=200&py=100',
    hasChip: false,
  },
  {
    name: 'break2',
    query:
      'wave=3&seen=all&gun=smg&money=120&barricades=1&turrets=1&px=200&py=100',
    hasChip: false,
  },
  {
    name: 'paused',
    query: 'wave=3&seen=all&start=wave&gun=smg&phase=paused&elapsed=6000',
    hasChip: false,
  },
  {
    name: 'wave',
    query: 'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&px=150&py=110',
    hasChip: false,
  },
]

const chipReport = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      type Box = { x: number; y: number; width: number; height: number }
      const toBox = (element: Element): Box => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      }
      const overlaps = (a: Box, b: Box) =>
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      const chip = document.querySelector('.home-gift')
      if (chip === null) {
        return { chip: undefined, overlaps: [] }
      }
      const chipBox = toBox(chip)
      const overlapping: Array<string> = []
      for (const element of globalThis.Array.from(
        document.querySelectorAll(
          'button, .pause-help, .mode-choice, .preparation-controls',
        ),
      )) {
        if (element === chip || element.closest('dialog') !== null) {
          continue
        }
        const box = toBox(element)
        const style = getComputedStyle(element)
        const isShown =
          box.width > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        if (isShown && overlaps(chipBox, box)) {
          overlapping.push(
            element.getAttribute('aria-label') ?? element.className,
          )
        }
      }
      return {
        chip: { label: chip.textContent, ...chipBox },
        overlaps: overlapping,
      }
    }),
  )

const layout = (tag: string) =>
  Effect.gen(function* () {
    const browser = yield* openBrowser
    for (const viewport of VIEWPORTS) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* openPage(browser, viewport)
        yield* gotoScene(
          page,
          harnessUrl(scene.query, 'newer=next', deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        const report = yield* chipReport(page)
        const isRight = (report.chip !== undefined) === scene.hasChip
        yield* Console.log(
          `${viewport.name} ${scene.name}: ${
            report.chip === undefined
              ? 'no chip'
              : `chip at ${Math.round(report.chip.x)},${Math.round(report.chip.y)} ${Math.round(report.chip.width)}x${Math.round(report.chip.height)}`
          }${isRight ? '' : ' WRONG'}${
            report.overlaps.length > 0
              ? ` OVERLAPS ${Array.join(report.overlaps, ', ')}`
              : ''
          }`,
        )
        yield* shot(page, `s26-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  })

const PREVIEW_PORT = 4186
const PREVIEW = `http://localhost:${PREVIEW_PORT}/`

const rootDir = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(import.meta.dir, '../..')
})

const build = (id: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem
    const root = yield* rootDir
    const code = yield* spawner.exitCode(
      ChildProcess.make('bun', ['run', 'build'], {
        cwd: root,
        env: { BUILD_ID: id },
        extendEnv: true,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    )
    if (code !== 0) {
      return yield* failWith(`the build of ${id} exited with ${code}`)
    }
    const version = yield* fs.readFileString(`${root}/dist/version.json`)
    const versionFile = String.trim(version)
    const grepped = yield* spawner.string(
      ChildProcess.make('grep', ['-rl', id, 'dist/assets'], { cwd: root }),
    )
    const bundled = String.trim(grepped)
    yield* Console.log(
      `built ${id}: version.json ${versionFile}, id in ${bundled}`,
    )
  })

const serve = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const root = yield* rootDir
  return yield* spawner.spawn(
    ChildProcess.make(
      'bunx',
      [
        'vite',
        'preview',
        '--port',
        globalThis.String(PREVIEW_PORT),
        '--strictPort',
      ],
      { cwd: root, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
    ),
  )
})

const runningBuild = (page: Page) =>
  attempt(() =>
    page.evaluate(() =>
      globalThis.Array.from(
        document.querySelectorAll('script[src]'),
        script => script.getAttribute('src') ?? '',
      ),
    ),
  ).pipe(Effect.map(scripts => Array.join(scripts, ' ')))

const e2e = (tag: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* rootDir
    yield* build('e2e-one')
    const server = yield* serve
    yield* Effect.addFinalizer(() => server.kill().pipe(Effect.ignore))
    yield* wait(2500)
    const browser = yield* openBrowser
    const page = yield* openPage(browser, PHONE_667)
    const versionRequests: Array<string> = []
    page.on('request', request => {
      if (String.includes('version.json')(request.url())) {
        versionRequests.push(request.url())
      }
    })
    yield* attempt(() => page.goto(PREVIEW))
    yield* wait(2500)
    const firstBuild = yield* runningBuild(page)
    yield* Console.log(`first load runs ${firstBuild}`)
    const chipsBefore = yield* countOf(page, '.home-gift')
    yield* Console.log(`chip before the rebuild: ${chipsBefore}`)
    yield* shot(page, `s26-${tag}-e2e-before`)

    yield* build('e2e-two')
    yield* attempt(() =>
      page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange')),
      ),
    )
    yield* attempt(() => page.locator('.home-gift').waitFor({ timeout: 5000 }))
    const chipText = yield* attempt(() =>
      page.locator('.home-gift').textContent(),
    )
    yield* Console.log(`chip after visibilitychange: ${chipText}`)
    yield* Console.log(
      `version.json requests: ${Array.join(versionRequests, ', ')}`,
    )
    yield* shot(page, `s26-${tag}-e2e-chip`)

    yield* attempt(() =>
      Promise.all([
        page.waitForEvent('load'),
        page.locator('.home-gift').tap(),
      ]),
    )
    yield* wait(2500)
    const reloadedBundle = yield* runningBuild(page)
    const assets = yield* fs.readDirectory(`${root}/dist/assets`)
    const servedBundle = Array.filter(Array.sort(assets, Order.String), name =>
      String.endsWith('.js')(name),
    )
    yield* Console.log(`reloaded page runs ${reloadedBundle}`)
    yield* Console.log(`dist now holds ${Array.join(servedBundle, ' ')}`)
    yield* Console.log(
      `reloaded into the new build: ${Array.some(servedBundle, name => String.includes(name)(reloadedBundle))}`,
    )
    const chipsAfter = yield* countOf(page, '.home-gift')
    yield* Console.log(`chip after the reload: ${chipsAfter}`)
    const isGreeted = yield* attempt(() =>
      page.locator('dialog[open] .greeting-panel').waitFor({ timeout: 5000 }),
    ).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    yield* Console.log(`greeted after the reload: ${isGreeted}`)
    yield* Console.log(`address after the reload: ${page.url()}`)
    yield* wait(1600)
    yield* shot(page, `s26-${tag}-e2e-after`)
    yield* attempt(() => page.keyboard.press('Escape'))
    yield* wait(400)
    const greetingsAfterEscape = yield* countOf(
      page,
      'dialog[open] .greeting-panel',
    )
    yield* Console.log(`greeting after Escape: ${greetingsAfterEscape}`)
    yield* attempt(() => page.reload())
    yield* wait(2500)
    const greetingsAfterReload = yield* countOf(
      page,
      'dialog[open] .greeting-panel',
    )
    yield* Console.log(`greeting after another reload: ${greetingsAfterReload}`)
  })

// NOTE: the harness is served for both parts, though only `layout` shoots
// it.
runHarnessAuditWith(
  Effect.gen(function* () {
    const part = yield* Config.String('PART').pipe(Config.withDefault('layout'))
    const tag = yield* auditTag
    yield* part === 'e2e' ? e2e(tag) : layout(tag)
  }),
  NodeServices.layer,
)
