import { Clock, Duration, Effect, Schedule, Schema } from 'effect'
import { type Browser, type Page, chromium } from 'playwright-core'

import { Vector } from '@game/entitySchema'

import { builtHarness, serveDir } from './harnessServer'
import { evaluateAs } from './page'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const GAME = 'http://localhost:4173/'
export const HARNESS = 'http://localhost:4174/'

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

export const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    ...(viewport.isPhone ? { isMobile: true, hasTouch: true } : {}),
  })
  return context.newPage()
}

export const desktop = (browser: Browser) => openPage(browser, DESKTOP_1280)

export const mobile = (browser: Browser, landscape = false) =>
  openPage(browser, landscape ? PHONE_844 : UPRIGHT_390)

// THE ENVIRONMENT

// NOTE: every harness script reads the same variables: TAG names the shot
// set, BASE points at another harness port, ONLY picks scenes by name, and
// VIEWPORTS picks screens by name.
export const tagOr = (fallback: string) => process.env['TAG'] ?? fallback

// NOTE: the shot set most scripts write, `after` unless TAG names another.
export const TAG = tagOr('after')
const BASE = process.env['BASE'] ?? HARNESS

const listFromEnv = (key: string) => process.env[key]?.split(',')
const ONLY = listFromEnv('ONLY')
const PICKED_VIEWPORTS = listFromEnv('VIEWPORTS')

export const isPickedScene = (name: string) =>
  ONLY === undefined || ONLY.includes(name)

export const pickViewports = (
  viewports: ReadonlyArray<Viewport>,
): ReadonlyArray<Viewport> =>
  viewports.filter(
    viewport =>
      PICKED_VIEWPORTS === undefined ||
      PICKED_VIEWPORTS.includes(viewport.name),
  )

// NOTE: a desktop, a phone on its side, and a phone held upright: the
// screens most shot scripts take.
export const SHOT_VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
])

// CONCURRENCY

const DEFAULT_PARALLEL = 3

// NOTE: how many browser contexts a script drives at once, read from its own
// variable (such as TAPS_PARALLEL), 3 by default, at least 1.
export const parallelFrom = (key: string): number => {
  const value = Number(process.env[key] ?? DEFAULT_PARALLEL)
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

export type Log = (line: string) => void

// NOTE: runs `work` on every item, up to `limit` at once, each in its own
// browser context. Each item logs through its own `log`, and the lines are
// printed as a block in the items' order as soon as every earlier item is
// done, so the report reads the same as a run one after another. The
// results come back in the items' order too.
export const forEachInOrder = async <A, B>(
  items: ReadonlyArray<A>,
  limit: number,
  work: (item: A, log: Log) => Promise<B>,
): Promise<ReadonlyArray<B>> => {
  const lines: Array<Array<string>> = items.map(() => [])
  const results: Array<B> = []
  const done: Array<boolean> = items.map(() => false)
  let printed = 0
  const flush = () => {
    while (printed < items.length && done[printed] === true) {
      for (const line of lines[printed] ?? []) {
        console.log(line)
      }
      printed++
    }
  }
  let next = 0
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      const item = items[index]
      const itemLines = lines[index]
      if (item === undefined || itemLines === undefined) {
        return
      }
      results[index] = await work(item, line => {
        itemLines.push(line)
      })
      done[index] = true
      flush()
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}

// THE HARNESS

// NOTE: where the harness runs. `BASE` names a server you started, and
// `HARNESS_DEV=1` uses the dev server on 4174 for live editing. Otherwise
// `useHarness` builds the harness once per content hash (see
// `harnessServer.ts`) and serves it on a free port of this script's own.
let harnessBase = BASE

export const useHarness = async (): Promise<string> => {
  if (process.env['BASE'] !== undefined || process.env['HARNESS_DEV'] === '1') {
    harnessBase = BASE
    return harnessBase
  }
  const server = serveDir(await builtHarness())
  server.unref()
  harnessBase = `http://127.0.0.1:${server.port}/`
  return harnessBase
}

// NOTE: joins the query parts that are not empty, so a scene with no query
// and a device part make `?device=touch`, never `?&device=touch`.
export const harnessQuery = (...parts: ReadonlyArray<string>) =>
  parts.filter(part => part.length > 0).join('&')

export const harnessUrl = (...parts: ReadonlyArray<string>) =>
  `${harnessBase}?${harnessQuery(...parts)}`

const READY_TIMEOUT_MS = 20_000

// NOTE: waits for the harness's ready signal: the scene rendered with every
// image decoded, and a frozen scene at its frame. A bad query fails here with
// the Schema error instead of timing out.
export const waitForReady = async (page: Page) => {
  await page.waitForFunction(
    () =>
      window.__harnessReady === true ||
      window.__sceneError !== undefined ||
      document.querySelector('.harness-error') !== null,
    null,
    { timeout: READY_TIMEOUT_MS, polling: 'raf' },
  )
  const problem = await page.evaluate(
    () =>
      window.__sceneError ??
      document.querySelector('.harness-error')?.textContent ??
      undefined,
  )
  if (problem !== undefined) {
    throw new Error(problem)
  }
}

// NOTE: after a click or a key, waits until the page has rendered what it
// set off and every image it asked for has decoded.
export const whenSettled = (page: Page) =>
  page.evaluate(() => window.__whenSettled())

export const gotoScene = async (page: Page, url: string) => {
  await page.goto(url)
  await waitForReady(page)
}

// NOTE: swaps the scene in place through `window.__loadScene`, without a
// reload, and waits for it to be ready.
export const loadScene = async (page: Page, query: string) => {
  await page.evaluate(sceneQuery => window.__loadScene(sceneQuery), query)
  await waitForReady(page)
}

// NOTE: `FRESH_PAGES=1` loads every scene in a new page, as before scenes
// were switched in place, to check that switching changes no picture.
const isAlwaysFresh = process.env['FRESH_PAGES'] === '1'

export type ScenePages = Readonly<{
  // NOTE: a page showing the scene: an idle page of this screen with the
  // scene switched in, or a new one when there is none or `fresh` is set.
  open: (
    viewport: Viewport,
    query: string,
    options?: Readonly<{ fresh?: boolean }>,
  ) => Promise<Page>
  // NOTE: hands the page back for the next scene on its screen.
  release: (page: Page) => void
  // NOTE: closes the page's context, for a page whose state should not be
  // reused, such as one with storage a scene depends on.
  discard: (page: Page) => Promise<void>
  close: () => Promise<void>
}>

// NOTE: one long-lived page per screen and worker. `pageQuery` holds the
// query parts that belong to the page, such as `nodev`, which every scene
// on it shares.
export const scenePages = (
  browser: Browser,
  pageQuery: ReadonlyArray<string> = [],
): ScenePages => {
  const idle = new Map<string, Array<Page>>()
  const viewportOf = new Map<Page, Viewport>()
  const idleFor = (viewport: Viewport) => {
    const pages = idle.get(viewport.name) ?? []
    idle.set(viewport.name, pages)
    return pages
  }
  const discard = async (page: Page) => {
    viewportOf.delete(page)
    await page.context().close()
  }
  return {
    open: async (viewport, query, options) => {
      const reusable = idleFor(viewport).pop()
      if (reusable !== undefined && options?.fresh !== true && !isAlwaysFresh) {
        await loadScene(reusable, harnessQuery(query, ...pageQuery))
        return reusable
      }
      if (reusable !== undefined) {
        await discard(reusable)
      }
      const page = await openPage(browser, viewport)
      viewportOf.set(page, viewport)
      await gotoScene(page, harnessUrl(query, ...pageQuery))
      return page
    },
    release: page => {
      const viewport = viewportOf.get(page)
      if (viewport !== undefined) {
        idleFor(viewport).push(page)
      }
    },
    discard,
    close: async () => {
      await Promise.all([...viewportOf.keys()].map(discard))
      idle.clear()
    },
  }
}

export const deviceQuery = (viewport: Viewport) =>
  viewport.isPhone ? 'device=touch' : ''

// NOTE: prints the problems a check found and exits with 1, or prints the
// all clear.
export const finish = (problems: ReadonlyArray<string>, allClear: string) => {
  if (problems.length > 0) {
    console.log(`\n${problems.length} problems:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`\n${allClear}`)
}

export const SHOTS_DIR = `${import.meta.dir}/shots`

// NOTE: CSS animations that end are shown at their end, and ones that loop
// at their start, so a shot never catches a button mid pop in.
export const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${SHOTS_DIR}/${name}.png`,
    animations: 'disabled',
  })

export const wait = (ms: number): Promise<void> =>
  Effect.runPromise(Effect.sleep(Duration.millis(ms)))

// NOTE: the wall clock, for an audit that reports how long something took.
export const nowMs = (): number => Effect.runSync(Clock.currentTimeMillis)

// NOTE: runs `attempt`, then again every `everyMs`, until `isDone` holds of
// its result or `timeoutMs` has passed. Hands back the last result and how
// long the polling took, in whole milliseconds.
export const pollUntil = <A>(
  attempt: () => Promise<A>,
  isDone: (result: A) => boolean,
  everyMs: number,
  timeoutMs: number,
): Promise<Readonly<{ last: A; elapsedMs: number }>> =>
  Effect.runPromise(
    Effect.promise(attempt).pipe(
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
const finishAnimations = (page: Page): Promise<number> =>
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
  })

const SETTLE_PASSES = 4

export const settleAnimations = async (page: Page) => {
  await whenSettled(page)
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    if ((await finishAnimations(page)) === 0) {
      return
    }
    await whenSettled(page)
  }
}

// PIXEL COMPARE

const pngDataUrl = async (path: string) =>
  `data:image/png;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64')}`

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
export const comparePngs = async (
  page: Page,
  beforePath: string,
  afterPath: string,
): Promise<PixelDiff> =>
  page.evaluate(
    async ([first, second]) => {
      const load = async (src: string) => {
        const image = new Image()
        image.src = src
        await image.decode()
        return image
      }
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
      const at = (data: Uint8ClampedArray, index: number) => data[index] ?? 0
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
    [await pngDataUrl(beforePath), await pngDataUrl(afterPath)] as const,
  )

// NOTE: the fields of the harness's Model that `schema` names, decoded
// (see `evaluateAs` in page.ts).
export const modelAs = <S extends Schema.ConstraintDecoder<unknown>>(
  page: Page,
  schema: S,
): Promise<S['Type']> => evaluateAs(page, schema, () => window.__model)

export const canvasRect = (page: Page) =>
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
  })

export const toClient = (
  rect: { left: number; top: number; scale: number },
  x: number,
  y: number,
) => ({
  x: rect.left + x * rect.scale,
  y: rect.top + y * rect.scale,
})

// NOTE: the player and the zombies, as much of the Model as aiming needs.
export const AimView = Schema.Struct({
  player: Vector,
  zombies: Schema.Array(
    Schema.Struct({
      x: Schema.Number,
      y: Schema.Number,
      state: Schema.Struct({ _tag: Schema.String }),
    }),
  ),
})
export type AimView = typeof AimView.Type
type AimZombie = AimView['zombies'][number]

export const nearestZombie = (m: AimView): AimZombie | undefined => {
  const distance = (z: Vector) =>
    Math.hypot(z.x - m.player.x, z.y - m.player.y)
  return m.zombies
    .filter(z => z.state._tag !== 'Dying')
    .reduce<AimZombie | undefined>(
      (best, z) =>
        best === undefined || distance(z) < distance(best) ? z : best,
      undefined,
    )
}

// NOTE: taps a button on a phone and clicks it on a desktop.
export const pressButton = async (
  page: Page,
  viewport: Viewport,
  name: RegExp,
) => {
  const button = page.getByRole('button', { name }).first()
  await (viewport.isPhone ? button.tap() : button.click())
}

const OPEN_TIMEOUT_MS = 10_000

// NOTE: waits for a dialog to open, and goes on after 10 s if none does.
export const waitForDialog = (page: Page) =>
  page
    .locator('dialog[open]')
    .first()
    .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
    .catch(() => undefined)

// NOTE: waits for the game's loading splash to go, the game up.
export const awaitGame = (page: Page) =>
  page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 45_000,
  })
