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
import { type AuditFailed, attempt, evaluateAs, failWith } from './page'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const GAME = 'http://localhost:4173/'

export const launch = () =>
  chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

// VIEWPORTS

export type Viewport = Readonly<{
  name: string
  width: number
  height: number
  scale: number
  isPhone: boolean
}>

// NOTE: the screens the audit scripts shoot. A script that names a screen
// differently in its file names, or wants another pixel ratio, spreads one of
// these and overrides the field.
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
// NOTE: a 20:9 Android phone on its side, wider than the 388 pixel cap.
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

// THE PROGRAM

// NOTE: runs a script's program with a Scope (for `openBrowser`). A failure
// prints and exits with 1. `runAuditWith` also provides `layer`, such as
// `NodeServices.layer` for a script that reads files. The harness forms
// first build and serve the harness (see `harness` below), so `harnessUrl`
// points at it.
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

// THE BROWSER

// NOTE: Chrome, closed when the program's Scope closes.
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

// NOTE: closes the page's browser context.
export const closePage = (page: Page) => attempt(() => page.context().close())

// THE ENVIRONMENT

// NOTE: every harness script reads the same variables: TAG names the shot
// set, BASE points at another harness port, ONLY picks scenes by name, and
// VIEWPORTS picks screens by name.
export const tagOr = (fallback: string) =>
  Config.String('TAG').pipe(Config.withDefault(fallback))

// NOTE: the shot set most scripts write, `after` unless TAG names another.
export const auditTag = tagOr('after')

// NOTE: a variable that holds a list, such as `ONLY=a,b`.
const listFromEnv = (key: string) =>
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

// NOTE: the same three screens under the long names the find passes'
// shots wear (`desktop`, `phone-landscape`, `phone-portrait`).
export const longNamedViewports = pickViewports([
  { ...DESKTOP_1280, name: 'desktop' },
  { ...PHONE_844, name: 'phone-landscape' },
  { ...UPRIGHT_390, name: 'phone-portrait' },
])

// NOTE: a desktop, a phone on its side, and a phone held upright: the
// screens most shot scripts take.
export const shotViewports = Effect.gen(function* () {
  const picked = yield* listFromEnv('VIEWPORTS')
  const isP360Picked = Option.exists(picked, Array.contains('p360'))
  return yield* pickViewports([
    { ...DESKTOP_1280, name: 'd1280' },
    { ...PHONE_844, name: 'l844' },
    { ...UPRIGHT_390, name: 'p390' },
    // NOTE: a narrower, shorter upright phone (360 by 780), taken only when
    // asked for with VIEWPORTS=p360.
    ...(isP360Picked
      ? [{ ...UPRIGHT_360, width: 360, height: 780, name: 'p360' }]
      : []),
  ])
})

// CONCURRENCY

const DEFAULT_PARALLEL = 3

// NOTE: how many browser contexts a script drives at once, read from its own
// variable (such as TAPS_PARALLEL), 3 by default, at least 1.
export const parallelFrom = (key: string) =>
  Effect.gen(function* () {
    const text = yield* Config.String(key).pipe(
      Config.withDefault(`${DEFAULT_PARALLEL}`),
    )
    const value = Number(text)
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
  })

export type Log = (line: string) => void

// NOTE: runs `work` on every item, up to `limit` at once, each in its own
// browser context. Each item logs through its own `log`, and the lines are
// printed as a block in the items' order as soon as every earlier item is
// done, so the report reads the same as a run one after another. The
// results come back in the items' order too.
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

// THE HARNESS

// NOTE: tools/video starts the harness through lib.ts.
export { HARNESS, useHarness } from './harnessServer'

// NOTE: joins the query parts that are not empty, so a scene with no query
// and a device part make `?device=touch`, never `?&device=touch`.
export const harnessQuery = (...parts: ReadonlyArray<string>) =>
  Array.join(
    Array.filter(parts, part => part.length > 0),
    '&',
  )

export const harnessUrl = (...parts: ReadonlyArray<string>) =>
  `${harnessBaseUrl()}?${harnessQuery(...parts)}`

const READY_TIMEOUT_MS = 20_000

// NOTE: waits for the harness's ready signal: the scene rendered with every
// image decoded, and a frozen scene at its frame. A bad query fails here with
// the Schema error instead of timing out.
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

// NOTE: `sceneReady` for tools/video, which waits on a promise.
export const waitForReady = (page: Page): Promise<void> =>
  Effect.runPromise(sceneReady(page))

// NOTE: after a click or a key, waits until the page has rendered what it
// set off and every image it asked for has decoded. `whenSettled` is the
// promise tools/video waits on.
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

// NOTE: swaps the scene in place through `window.__loadScene`, without a
// reload, and waits for it to be ready.
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
  // NOTE: a page showing the scene: an idle page of this screen with the
  // scene switched in, or a new one when there is none or `fresh` is set.
  open: (
    viewport: Viewport,
    query: string,
    options?: Readonly<{ fresh?: boolean }>,
  ) => Effect.Effect<Page, AuditFailed | Config.ConfigError>
  // NOTE: hands the page back for the next scene on its screen.
  release: (page: Page) => void
  // NOTE: closes the page's context, for a page whose state should not be
  // reused, such as one with storage a scene depends on.
  discard: (page: Page) => Effect.Effect<void, AuditFailed>
  close: Effect.Effect<void, AuditFailed>
}>

// NOTE: one long-lived page per screen and worker. `pageQuery` holds the
// query parts that belong to the page, such as `nodev`, which every scene
// on it shares. `FRESH_PAGES=1` loads every scene in a new page, as before
// scenes were switched in place, to check that switching changes no
// picture.
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

// NOTE: prints the problems a check found and sets the exit code to 1, or
// prints the all clear.
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

// NOTE: CSS animations that end are shown at their end, and ones that loop
// at their start, so a shot never catches a button mid pop in.
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

// NOTE: the wall clock, for an audit that reports how long something took.
// An Effect program reads `Clock.currentTimeMillis` instead.
export const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis)

// NOTE: runs `poll`, then again every `everyMs`, until `isDone` holds of
// its result or `timeoutMs` has passed. Hands back the last result and how
// long the polling took, in whole milliseconds.
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

// NOTE: jumps every animation that ends, such as a button's pop in, to its
// end, so a size check never measures a button mid scale and never waits for
// one. A blink that loops forever is left running. A tap often starts its
// animation a frame or a Command later (a dialog opens once its ShowDialog
// Command has run), and an ending animation can set off a Message, so it lets
// the page settle around each pass, until no animation that ends is left.
const finishAnimations = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      let finished = 0
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().iterations !== Infinity) {
          try {
            animation.finish()
            finished++
          } catch {
            // NOTE: an animation that cannot finish, such as a paused one, stays.
          }
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

// PIXEL COMPARE

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

// NOTE: counts the pixels that differ between two PNG files in the page's
// own canvas, and draws a diff with the changed pixels in magenta over a dim
// copy of the second image.
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
      return yield* attempt(() =>
        page.evaluate(
          // NOTE: runs in the page, where an image decodes only by a promise.
          // @effect-diagnostics-next-line asyncFunction:off
          async ([first, second]) => {
            // NOTE: runs in the page, where an image decodes only by a promise.
            // @effect-diagnostics-next-line asyncFunction:off
            const load = async (src: string) => {
              const image = new Image()
              image.src = src
              await image.decode()
              return image
            }
            // NOTE: runs in the page, where an image decodes only by a promise.
            // @effect-diagnostics-next-line asyncFunction:off
            const pixels = async (src: string) => {
              const image = await load(src)
              const canvas = document.createElement('canvas')
              canvas.width = image.width
              canvas.height = image.height
              const context = canvas.getContext('2d')
              if (context === null) {
                throw new Error('No 2d context for the pixel compare')
              }
              context.drawImage(image, 0, 0)
              return {
                width: image.width,
                height: image.height,
                data: context.getImageData(0, 0, image.width, image.height),
              }
            }
            const a = await pixels(first)
            const b = await pixels(second)
            const diff = document.createElement('canvas')
            diff.width = a.width
            diff.height = a.height
            const diffContext = diff.getContext('2d')
            if (diffContext === null) {
              throw new Error('No 2d context for the pixel diff')
            }
            const out = diffContext.createImageData(a.width, a.height)
            let differing = 0
            let maxDelta = 0
            let left = Infinity
            let top = Infinity
            let right = -Infinity
            let bottom = -Infinity
            const before = a.data.data
            const after = b.data.data
            const at = (data: Uint8ClampedArray, index: number) =>
              data[index] ?? 0
            for (let i = 0; i < before.length; i += 4) {
              const delta = Math.max(
                Math.abs(at(before, i) - at(after, i)),
                Math.abs(at(before, i + 1) - at(after, i + 1)),
                Math.abs(at(before, i + 2) - at(after, i + 2)),
              )
              const gray = Math.round(
                (at(after, i) + at(after, i + 1) + at(after, i + 2)) / 12,
              )
              out.data[i] = delta > 0 ? 255 : gray
              out.data[i + 1] = delta > 0 ? 0 : gray
              out.data[i + 2] = delta > 0 ? 255 : gray
              out.data[i + 3] = 255
              if (delta > 0) {
                differing++
                const pixel = i / 4
                const x = pixel % a.width
                const y = Math.floor(pixel / a.width)
                left = Math.min(left, x)
                top = Math.min(top, y)
                right = Math.max(right, x)
                bottom = Math.max(bottom, y)
              }
              maxDelta = Math.max(maxDelta, delta)
            }
            diffContext.putImageData(out, 0, 0)
            return {
              differing,
              total: a.data.data.length / 4,
              maxDelta,
              box: differing > 0 ? { left, top, right, bottom } : null,
              diffUrl: differing > 0 ? diff.toDataURL('image/png') : null,
            }
          },
          urls,
        ),
      )
    }),
)

// NOTE: the fields of the harness's Model that `schema` names, decoded
// (see `evaluateAs` in page.ts).
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
      const c = document.querySelector('.game-canvas')
      if (c === null) {
        throw new Error('No .game-canvas on the page')
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

// NOTE: the player and the zombies, as much of the Model as aiming needs.
// NOTE: the lead seat's player, single player's only one.
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

// NOTE: taps a button on a phone and clicks it on a desktop.
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

// NOTE: opens How to play from home: MORE, then its card in the hand.
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

// NOTE: waits for a dialog to open, and goes on after 10 s if none does.
export const waitForDialog = (page: Page) =>
  attempt(() =>
    page
      .locator('dialog[open]')
      .first()
      .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS }),
  ).pipe(Effect.ignore)

// NOTE: the lobby PLAY opens for a scene whose player has learned to move
// and fire (`learned=move,fire`; a new player's PLAY starts the tutorial).
const LOBBY = '.coop[data-screen="Solo"]'

export const waitForLobby = (page: Page) =>
  attempt(() =>
    page.locator(LOBBY).waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS }),
  ).pipe(Effect.ignore)

// NOTE: clicks PLAY and waits for the lobby.
export const openLobby = (page: Page) =>
  Effect.andThen(
    attempt(() => page.click('#home-play')),
    waitForLobby(page),
  )

// NOTE: waits for the game's loading splash to go, the game up.
export const awaitGame = (page: Page) =>
  attempt(() =>
    page.waitForFunction(() => document.getElementById('splash') === null, {
      timeout: 45_000,
    }),
  )

// NOTE: how many elements match `selector` on the page.
export const countOf: {
  (selector: string): (page: Page) => Effect.Effect<number, AuditFailed>
  (page: Page, selector: string): Effect.Effect<number, AuditFailed>
} = Function.dual(
  2,
  (page: Page, selector: string): Effect.Effect<number, AuditFailed> =>
    attempt(() => page.locator(selector).count()),
)

export type Act = (page: Page) => Effect.Effect<void, AuditFailed>

// NOTE: a click on a visible button by its accessible name. On a phone the
// harness plays with touch, but a click lands the same Message.
export const press =
  (name: RegExp | string): Act =>
  page =>
    Effect.andThen(
      attempt(() => page.getByRole('button', { name }).first().click()),
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

// NOTE: the rooms passes' scenes (shotsRooms.ts, shotsFinds.ts): every
// lesson learned and every exit open, in a quiet open break of wave 3.
export const LEARNED_ALL =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,displayCase'
export const EVERY_EXIT_OPEN = 'openexits=Kitchen,West,East,Far,Secret'
export const OPEN_BREAK = `${LEARNED_ALL}&wave=3&break=open&${EVERY_EXIT_OPEN}`
