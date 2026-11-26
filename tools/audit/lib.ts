import {
  Array,
  Clock,
  Config,
  Console,
  Duration,
  Effect,
  Function,
  type Layer,
  Option,
  Schedule,
  Schema,
  type Scope,
  String,
} from 'effect'
import { type Browser, type Page, chromium } from 'playwright-core'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Vector } from '@game/world/schema/entitySchema'

import { harnessBaseUrl } from './harnessServer'
import { pixelDiffOf } from './inPage/lib'
import { type AuditFailed, attempt, evaluateAs, failWith } from './page'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const GAME = 'http://localhost:4173/'

const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--use-angle=metal',
]

export const launch = () =>
  chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', ...GPU_ARGS],
  })

export type Viewport = Readonly<{
  name: string
  width: number
  height: number
  scale: number
  isPhone: boolean
}>

export const DESKTOP_1280: Viewport = {
  name: 'd1280',
  width: 1280,
  height: 720,
  scale: 1,
  isPhone: false,
}
export const DESKTOP_1920: Viewport = {
  name: 'd1920',
  width: 1920,
  height: 1080,
  scale: 1,
  isPhone: false,
}
export const PHONE_667: Viewport = {
  name: 'p667',
  width: 667,
  height: 375,
  scale: 2,
  isPhone: true,
}
export const PHONE_844: Viewport = {
  name: 'p844',
  width: 844,
  height: 390,
  scale: 3,
  isPhone: true,
}
export const PHONE_932: Viewport = {
  name: 'p932',
  width: 932,
  height: 430,
  scale: 3,
  isPhone: true,
}
export const ANDROID_915: Viewport = {
  name: 'a915',
  width: 915,
  height: 412,
  scale: 2.625,
  isPhone: true,
}
export const ANDROID_800: Viewport = {
  name: 'a800',
  width: 800,
  height: 360,
  scale: 3,
  isPhone: true,
}
export const UPRIGHT_390: Viewport = {
  name: 'u390',
  width: 390,
  height: 844,
  scale: 3,
  isPhone: true,
}
export const UPRIGHT_430: Viewport = {
  name: 'u430',
  width: 430,
  height: 932,
  scale: 3,
  isPhone: true,
}
export const UPRIGHT_360: Viewport = {
  name: 'u360',
  width: 360,
  height: 800,
  scale: 3,
  isPhone: true,
}
export const UPRIGHT_375: Viewport = {
  name: 'u375',
  width: 375,
  height: 667,
  scale: 2,
  isPhone: true,
}

export const runAudit = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) => {
  NodeRuntime.runMain(program.pipe(Effect.scoped))
}

export const runAuditWith: {
  <R>(
    layer: Layer.Layer<R>,
  ): <A, E>(program: Effect.Effect<A, E, R | Scope.Scope>) => void
  <A, E, R>(
    program: Effect.Effect<A, E, R | Scope.Scope>,
    layer: Layer.Layer<R>,
  ): void
} = Function.dual(
  2,
  <A, E, R>(
    program: Effect.Effect<A, E, R | Scope.Scope>,
    layer: Layer.Layer<R>,
  ): void => {
    NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(layer)))
  },
)

export const openBrowser: Effect.Effect<Browser, AuditFailed, Scope.Scope> =
  Effect.acquireRelease(attempt(launch), browser =>
    attempt(() => browser.close()).pipe(Effect.ignore),
  )

export const openPage: {
  (viewport: Viewport): (browser: Browser) => Effect.Effect<Page, AuditFailed>
  (browser: Browser, viewport: Viewport): Effect.Effect<Page, AuditFailed>
} = Function.dual(
  2,
  (browser: Browser, viewport: Viewport): Effect.Effect<Page, AuditFailed> =>
    attempt(() =>
      browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.scale,
        ...(viewport.isPhone ? { isMobile: true, hasTouch: true } : {}),
      }),
    ).pipe(Effect.flatMap(context => attempt(() => context.newPage()))),
)

export const desktop = (browser: Browser) => openPage(browser, DESKTOP_1280)

export const closePage = (page: Page) => attempt(() => page.context().close())

export const tagOr = (fallback: string) =>
  Config.String('TAG').pipe(Config.withDefault(fallback))

export const auditTag = tagOr('after')

export const listFromEnv = (key: string) =>
  Config.String(key).pipe(Config.map(String.split(',')), Config.option)

const isListed = (
  list: Option.Option<ReadonlyArray<string>>,
  name: string,
): boolean =>
  Option.match(list, {
    onNone: () => true,
    onSome: names => Array.contains(names, name),
  })

export const isPickedScene = (name: string) =>
  Effect.gen(function* () {
    const only = yield* listFromEnv('ONLY')
    return isListed(only, name)
  })

export const pickViewports = (viewports: ReadonlyArray<Viewport>) =>
  Effect.gen(function* () {
    const picked = yield* listFromEnv('VIEWPORTS')
    return Array.filter(viewports, viewport => isListed(picked, viewport.name))
  })

export const longNamedViewports = pickViewports([
  { ...DESKTOP_1280, name: 'desktop' },
  { ...PHONE_844, name: 'phone-landscape' },
  { ...UPRIGHT_390, name: 'phone-portrait' },
])

const ON_REQUEST: ReadonlyArray<Viewport> = [
  { ...UPRIGHT_360, width: 360, height: 780, name: 'p360' },
  PHONE_667,
  ANDROID_800,
  UPRIGHT_360,
  UPRIGHT_430,
]

export const shotViewports = Effect.gen(function* () {
  const picked = yield* listFromEnv('VIEWPORTS')
  const defaults = yield* pickViewports([
    { ...DESKTOP_1280, name: 'd1280' },
    { ...PHONE_844, name: 'l844' },
    { ...UPRIGHT_390, name: 'p390' },
  ])
  return [
    ...defaults,
    ...Array.filter(ON_REQUEST, viewport =>
      Option.exists(picked, Array.contains(viewport.name)),
    ),
  ]
})

const DEFAULT_PARALLEL = 3

export const parallelFrom = (key: string) =>
  Effect.gen(function* () {
    const text = yield* Config.String(key).pipe(
      Config.withDefault(`${DEFAULT_PARALLEL}`),
    )
    const value = Number(text)
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
  })

export type Log = (line: string) => void

export const forEachInOrder: {
  <A, B, E, R>(
    limit: number,
    work: (item: A, log: Log) => Effect.Effect<B, E, R>,
  ): (items: ReadonlyArray<A>) => Effect.Effect<ReadonlyArray<B>, E, R>
  <A, B, E, R>(
    items: ReadonlyArray<A>,
    limit: number,
    work: (item: A, log: Log) => Effect.Effect<B, E, R>,
  ): Effect.Effect<ReadonlyArray<B>, E, R>
} = Function.dual(
  3,
  <A, B, E, R>(
    items: ReadonlyArray<A>,
    limit: number,
    work: (item: A, log: Log) => Effect.Effect<B, E, R>,
  ): Effect.Effect<ReadonlyArray<B>, E, R> => {
    const lines: Array<Array<string>> = Array.map(items, () => [])
    const done: Array<boolean> = Array.map(items, () => false)
    let printed = 0
    const flush = Effect.gen(function* () {
      while (printed < items.length && done[printed] === true) {
        for (const line of lines[printed] ?? []) {
          yield* Console.log(line)
        }
        printed++
      }
    })
    return Effect.forEach(
      items,
      (item, index) =>
        work(item, line => {
          lines[index]?.push(line)
        }).pipe(
          Effect.tap(() => {
            done[index] = true
            return flush
          }),
        ),
      { concurrency: Math.max(1, limit) },
    )
  },
)

export { HARNESS, useHarness } from './harnessServer'

export const harnessQuery = (...parts: ReadonlyArray<string>) =>
  Array.join(
    Array.filter(parts, part => part.length > 0),
    '&',
  )

export const harnessUrl = (...parts: ReadonlyArray<string>) =>
  `${harnessBaseUrl()}?${harnessQuery(...parts)}`

const READY_TIMEOUT_MS = 20_000

export const sceneReady = (page: Page) =>
  Effect.gen(function* () {
    yield* attempt(() =>
      page.waitForFunction(
        () =>
          window.__harnessReady === true ||
          window.__sceneError !== undefined ||
          document.querySelector('.harness-error') !== null,
        null,
        { timeout: READY_TIMEOUT_MS, polling: 'raf' },
      ),
    )
    const problem = yield* attempt(() =>
      page.evaluate(
        () =>
          window.__sceneError ??
          document.querySelector('.harness-error')?.textContent ??
          undefined,
      ),
    )
    if (problem !== undefined) {
      return yield* failWith(problem)
    }
  })

export const waitForReady = (page: Page): Promise<void> =>
  Effect.runPromise(sceneReady(page))

export const whenSettled = (page: Page) =>
  page.evaluate(() => window.__whenSettled())

export const settled = (page: Page) => attempt(() => whenSettled(page))

export const gotoScene: {
  (url: string): (page: Page) => Effect.Effect<void, AuditFailed>
  (page: Page, url: string): Effect.Effect<void, AuditFailed>
} = Function.dual(
  2,
  (page: Page, url: string): Effect.Effect<void, AuditFailed> =>
    Effect.andThen(
      attempt(() => page.goto(url)),
      sceneReady(page),
    ),
)

export const loadScene: {
  (query: string): (page: Page) => Effect.Effect<void, AuditFailed>
  (page: Page, query: string): Effect.Effect<void, AuditFailed>
} = Function.dual(
  2,
  (page: Page, query: string): Effect.Effect<void, AuditFailed> =>
    Effect.andThen(
      attempt(() =>
        page.evaluate(sceneQuery => window.__loadScene(sceneQuery), query),
      ),
      sceneReady(page),
    ),
)

export type ScenePages = Readonly<{
  open: (
    viewport: Viewport,
    query: string,
    options?: Readonly<{ fresh?: boolean }>,
  ) => Effect.Effect<Page, AuditFailed | Config.ConfigError>
  release: (page: Page) => void
  discard: (page: Page) => Effect.Effect<void, AuditFailed>
  close: Effect.Effect<void, AuditFailed>
}>

export const scenePages: {
  (pageQuery: ReadonlyArray<string>): (browser: Browser) => ScenePages
  (browser: Browser, pageQuery: ReadonlyArray<string>): ScenePages
} = Function.dual(
  2,
  (browser: Browser, pageQuery: ReadonlyArray<string>): ScenePages => {
    const idle = new Map<string, Array<Page>>()
    const viewportOf = new Map<Page, Viewport>()
    const idleFor = (viewport: Viewport) => {
      const pages = idle.get(viewport.name) ?? []
      idle.set(viewport.name, pages)
      return pages
    }
    const discard = (page: Page) =>
      Effect.suspend(() => {
        viewportOf.delete(page)
        return closePage(page)
      })
    return {
      open: (viewport, query, options) =>
        Effect.gen(function* () {
          const isAlwaysFresh =
            (yield* Config.String('FRESH_PAGES').pipe(
              Config.withDefault(''),
            )) === '1'
          const reusable = idleFor(viewport).pop()
          if (
            reusable !== undefined &&
            options?.fresh !== true &&
            !isAlwaysFresh
          ) {
            yield* loadScene(reusable, harnessQuery(query, ...pageQuery))
            return reusable
          }
          if (reusable !== undefined) {
            yield* discard(reusable)
          }
          const page = yield* openPage(browser, viewport)
          viewportOf.set(page, viewport)
          yield* gotoScene(page, harnessUrl(query, ...pageQuery))
          return page
        }),
      release: page => {
        const viewport = viewportOf.get(page)
        if (viewport !== undefined) {
          idleFor(viewport).push(page)
        }
      },
      discard,
      close: Effect.suspend(() =>
        Effect.forEach([...viewportOf.keys()], discard, {
          concurrency: 'unbounded',
          discard: true,
        }),
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            idle.clear()
          }),
        ),
      ),
    }
  },
)

export const deviceQuery = (viewport: Viewport) =>
  viewport.isPhone ? 'device=touch' : ''

export const finish: {
  (allClear: string): (problems: ReadonlyArray<string>) => Effect.Effect<void>
  (problems: ReadonlyArray<string>, allClear: string): Effect.Effect<void>
} = Function.dual(
  2,
  (problems: ReadonlyArray<string>, allClear: string): Effect.Effect<void> =>
    problems.length > 0
      ? Effect.andThen(
          Console.log(
            `\n${problems.length} problems:\n  ${Array.join(problems, '\n  ')}`,
          ),
          Effect.sync(() => {
            process.exitCode = 1
          }),
        )
      : Console.log(`\n${allClear}`),
)

export const SHOTS_DIR = `${import.meta.dir}/shots`

export const shot: {
  (name: string): (page: Page) => Effect.Effect<void, AuditFailed>
  (page: Page, name: string): Effect.Effect<void, AuditFailed>
} = Function.dual(
  2,
  (page: Page, name: string): Effect.Effect<void, AuditFailed> =>
    Effect.asVoid(
      attempt(() =>
        page.screenshot({
          path: `${SHOTS_DIR}/${name}.png`,
          animations: 'disabled',
        }),
      ),
    ),
)

export const wait = (ms: number) => Effect.sleep(Duration.millis(ms))

export const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis)

export const pollUntil: {
  <A>(
    isDone: (result: A) => boolean,
    everyMs: number,
    timeoutMs: number,
  ): <E, R>(
    poll: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Readonly<{ last: A; elapsedMs: number }>, E, R>
  <A, E, R>(
    poll: Effect.Effect<A, E, R>,
    isDone: (result: A) => boolean,
    everyMs: number,
    timeoutMs: number,
  ): Effect.Effect<Readonly<{ last: A; elapsedMs: number }>, E, R>
} = Function.dual(
  4,
  <A, E, R>(
    poll: Effect.Effect<A, E, R>,
    isDone: (result: A) => boolean,
    everyMs: number,
    timeoutMs: number,
  ): Effect.Effect<Readonly<{ last: A; elapsedMs: number }>, E, R> =>
    poll.pipe(
      Effect.repeat({
        until: isDone,
        schedule: Schedule.spaced(Duration.millis(everyMs)).pipe(
          Schedule.upTo({ duration: Duration.millis(timeoutMs) }),
        ),
      }),
      Effect.timed,
      Effect.map(([elapsed, last]) => ({
        last,
        elapsedMs: Math.round(Duration.toMillis(elapsed)),
      })),
    ),
)

const finishAnimations = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      let finished = 0
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().iterations !== Infinity) {
          try {
            animation.finish()
            finished++
          } catch {}
        }
      }
      return finished
    }),
  )

const SETTLE_PASSES = 4

export const settleAnimations = (page: Page) =>
  Effect.gen(function* () {
    yield* settled(page)
    for (let pass = 0; pass < SETTLE_PASSES; pass++) {
      if ((yield* finishAnimations(page)) === 0) {
        return
      }
      yield* settled(page)
    }
  })

const pngDataUrl = (path: string) =>
  attempt(() => Bun.file(path).arrayBuffer()).pipe(
    Effect.map(
      bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
    ),
  )

export type PixelDiff = Readonly<{
  differing: number
  total: number
  maxDelta: number
  box: Readonly<{
    left: number
    top: number
    right: number
    bottom: number
  }> | null
  diffUrl: string | null
}>

export const comparePngs: {
  (
    beforePath: string,
    afterPath: string,
  ): (page: Page) => Effect.Effect<PixelDiff, AuditFailed>
  (
    page: Page,
    beforePath: string,
    afterPath: string,
  ): Effect.Effect<PixelDiff, AuditFailed>
} = Function.dual(
  3,
  (
    page: Page,
    beforePath: string,
    afterPath: string,
  ): Effect.Effect<PixelDiff, AuditFailed> =>
    Effect.gen(function* () {
      const beforeUrl = yield* pngDataUrl(beforePath)
      const afterUrl = yield* pngDataUrl(afterPath)
      const urls = [beforeUrl, afterUrl] as const
      return yield* attempt(() => page.evaluate(pixelDiffOf, urls))
    }),
)

export const modelAs: {
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
  ): (page: Page) => Effect.Effect<S['Type'], AuditFailed | Schema.SchemaError>
  <S extends Schema.ConstraintDecoder<unknown>>(
    page: Page,
    schema: S,
  ): Effect.Effect<S['Type'], AuditFailed | Schema.SchemaError>
} = Function.dual(
  2,
  <S extends Schema.ConstraintDecoder<unknown>>(
    page: Page,
    schema: S,
  ): Effect.Effect<S['Type'], AuditFailed | Schema.SchemaError> =>
    evaluateAs(page, schema, () => window.__model),
)

export const canvasRect = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      const c = document.querySelector('.world-view')
      if (c === null) {
        throw new Error('No .world-view on the page')
      }
      const r = c.getBoundingClientRect()
      const scale = Math.min(r.width / 320, r.height / 180)
      const w = 320 * scale,
        h = 180 * scale
      return {
        left: r.left + (r.width - w) / 2,
        top: r.top + (r.height - h) / 2,
        scale,
      }
    }),
  )

type CanvasRect = Readonly<{ left: number; top: number; scale: number }>

export const toClient: {
  (
    x: number,
    y: number,
  ): (rect: CanvasRect) => Readonly<{ x: number; y: number }>
  (rect: CanvasRect, x: number, y: number): Readonly<{ x: number; y: number }>
} = Function.dual(
  3,
  (
    rect: CanvasRect,
    x: number,
    y: number,
  ): Readonly<{ x: number; y: number }> => ({
    x: rect.left + x * rect.scale,
    y: rect.top + y * rect.scale,
  }),
)

export const AimView = Schema.Struct({
  seats: Schema.NonEmptyArray(Schema.Struct({ player: Vector })),
  zombies: Schema.Array(
    Schema.Struct({
      x: Schema.Finite,
      y: Schema.Finite,
      state: Schema.Struct({ _tag: Schema.String }),
    }),
  ),
})
export type AimView = typeof AimView.Type
type AimZombie = AimView['zombies'][number]

export const nearestZombie = (m: AimView): AimZombie | undefined => {
  const player = m.seats[0].player
  const distance = (z: Vector) => Math.hypot(z.x - player.x, z.y - player.y)
  return Option.getOrUndefined(
    Array.reduce(
      Array.filter(m.zombies, z => z.state._tag !== 'Dying'),
      Option.none<AimZombie>(),
      (best, z) =>
        Option.isNone(best) || distance(z) < distance(best.value)
          ? Option.some(z)
          : best,
    ),
  )
}

export const pressButton: {
  (
    viewport: Viewport,
    name: RegExp,
  ): (page: Page) => Effect.Effect<void, AuditFailed>
  (
    page: Page,
    viewport: Viewport,
    name: RegExp,
  ): Effect.Effect<void, AuditFailed>
} = Function.dual(
  3,
  (
    page: Page,
    viewport: Viewport,
    name: RegExp,
  ): Effect.Effect<void, AuditFailed> => {
    const button = page.getByRole('button', { name }).first()
    return attempt(() => (viewport.isPhone ? button.tap() : button.click()))
  },
)

export const openHowToPlay: {
  (viewport: Viewport): (page: Page) => Effect.Effect<void, AuditFailed>
  (page: Page, viewport: Viewport): Effect.Effect<void, AuditFailed>
} = Function.dual(
  2,
  (page: Page, viewport: Viewport): Effect.Effect<void, AuditFailed> =>
    Effect.gen(function* () {
      yield* pressButton(page, viewport, /^More:/)
      yield* attempt(() =>
        page.locator('dialog[open]').first().waitFor({ state: 'visible' }),
      )
      yield* pressButton(page, viewport, /^How to play:/)
      yield* attempt(() =>
        page
          .locator('dialog[open] .panel')
          .first()
          .waitFor({ state: 'visible' }),
      )
    }),
)

const OPEN_TIMEOUT_MS = 10_000

export const waitForDialog = (page: Page) =>
  attempt(() =>
    page
      .locator('dialog[open]')
      .first()
      .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS }),
  ).pipe(Effect.ignore)

const LOBBY = '.coop[data-screen="Solo"]'

export const waitForLobby = (page: Page) =>
  attempt(() =>
    page.locator(LOBBY).waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS }),
  ).pipe(Effect.ignore)

export const openLobby = (page: Page) =>
  Effect.andThen(
    attempt(() => page.click('#home-play')),
    waitForLobby(page),
  )

export const awaitGame = (page: Page) =>
  attempt(() =>
    page.waitForFunction(() => document.getElementById('splash') === null, {
      timeout: 45_000,
    }),
  )

export const countOf: {
  (selector: string): (page: Page) => Effect.Effect<number, AuditFailed>
  (page: Page, selector: string): Effect.Effect<number, AuditFailed>
} = Function.dual(
  2,
  (page: Page, selector: string): Effect.Effect<number, AuditFailed> =>
    attempt(() => page.locator(selector).count()),
)

export type Act = (page: Page) => Effect.Effect<void, AuditFailed>

export const press =
  (name: RegExp | string): Act =>
  page =>
    Effect.andThen(
      attempt(() => page.getByRole('button', { name }).first().click()),
      settleAnimations(page),
    )

export const clickFirst =
  (selector: string): Act =>
  page =>
    Effect.andThen(
      attempt(() => page.locator(selector).first().click()),
      settleAnimations(page),
    )

export const inOrder =
  (...acts: ReadonlyArray<Act>): Act =>
  page =>
    Effect.forEach(acts, act => act(page), { discard: true })

export const fromHand = (name: RegExp) =>
  inOrder(press(/^more/i), page =>
    Effect.andThen(
      attempt(() =>
        page.locator('dialog[open]').first().waitFor({ state: 'visible' }),
      ),
      press(name)(page),
    ),
  )

export const LEARNED_ALL =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,displayCase'
export const EVERY_EXIT_OPEN = 'openexits=Kitchen,West,East,Far,Secret'
export const OPEN_BREAK = `${LEARNED_ALL}&wave=3&break=open&${EVERY_EXIT_OPEN}`
