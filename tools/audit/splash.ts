import {
  Array,
  Clock,
  Config,
  Console,
  Effect,
  FileSystem,
  Option,
  Record,
  Schema,
  String,
} from 'effect'
import type { BrowserContext } from 'playwright-core'

// Loads the production build in headless Chrome on a slow network and a slow
// CPU and times the loading splash: the first paint (which must be the
// splash, not a blank or unstyled page), when the game's canvas appears, when
// the game hides the splash, and when the splash leaves the page, on a first
// visit and on a returning player's repeat visit. It saves screenshots along
// the way as `splash-<TAG>-<profile>-<visit>-<moment>.png`.
// It also prints when each load step finished (the `load:<step>` marks from
// src/platform/splash.ts), each move of the progress bar, the main thread's long
// tasks, and with PROFILE=1 the functions that took the most CPU time before
// the splash hid, and with NETWORK=1 every request the page and its workers
// made, with when it started and finished. ONLY=<profile> runs one profile.
// Under the heavy guard it yields the guard's turn between profiles, so
// other jobs go in between instead of waiting for all three.
//   BASE=http://localhost:4173/ bun splash.ts
import * as NodeServices from '@effect/platform-node/NodeServices'

import { yieldTurnAsync } from '../heavy/turn'
import { encodeJson } from '../json'
import { GAME, nowMs, openBrowser, runAuditWith, wait } from './lib'
import { attempt, evaluateAs } from './page'

// NOTE: the variables this script reads (see the top of the file).
const Settings = Config.all({
  base: Config.String('BASE').pipe(Config.withDefault(GAME)),
  tag: Config.String('TAG').pipe(Config.withDefault('after')),
  only: Config.String('ONLY').pipe(Config.option),
  isProfiling: Config.String('PROFILE').pipe(
    Config.withDefault(''),
    Config.map(value => value === '1'),
  ),
  isNetworkShown: Config.String('NETWORK').pipe(
    Config.withDefault(''),
    Config.map(value => value === '1'),
  ),
})
type Settings = Config.Success<typeof Settings>

// NOTE: the first visit loads with the cache off and no save. The repeat
// visit closes that page and opens a new one in the same browser context
// with the cache on, so the assets come from the cache and the save from
// OPFS, as when a returning player opens the app again.
const VISITS = ['first', 'repeat'] as const

type Profile = Readonly<{
  name: string
  latencyMs: number
  downloadKbps: number
  cpuRate: number
}>

const PROFILES: ReadonlyArray<Profile> = [
  { name: 'fast', latencyMs: 0, downloadKbps: 0, cpuRate: 1 },
  { name: 'slow4g', latencyMs: 150, downloadKbps: 1600, cpuRate: 4 },
  { name: 'slow3g', latencyMs: 400, downloadKbps: 400, cpuRate: 6 },
]

const KBPS_TO_BYTES = 1000 / 8
const TOP_FUNCTIONS = 20

type ProfileNode = Readonly<{
  id: number
  callFrame: Readonly<{
    functionName: string
    url: string
    lineNumber: number
  }>
}>

type CpuProfile = Readonly<{
  nodes: ReadonlyArray<ProfileNode>
  samples?: ReadonlyArray<number>
  timeDeltas?: ReadonlyArray<number>
}>

const topSelfTime = (profile: CpuProfile): ReadonlyArray<string> => {
  const byId = new Map(Array.map(profile.nodes, node => [node.id, node]))
  const selfMs = new Map<string, number>()
  const timeDeltas = profile.timeDeltas ?? []
  Array.forEach(profile.samples ?? [], (id, index) => {
    const frame = byId.get(id)?.callFrame
    const name =
      frame === undefined
        ? '?'
        : `${frame.functionName || '(anonymous)'} ${String.split('/')(frame.url).pop()}:${frame.lineNumber + 1}`
    selfMs.set(name, (selfMs.get(name) ?? 0) + (timeDeltas[index] ?? 0) / 1000)
  })
  return Array.map(
    [...selfMs.entries()]
      .sort(([, first], [, second]) => second - first)
      .slice(0, TOP_FUNCTIONS),
    ([name, ms]) =>
      `${String.padStart(6)(globalThis.String(Math.round(ms)))} ms  ${name}`,
  )
}

const openPage = (context: BrowserContext, profile: Profile) =>
  Effect.gen(function* () {
    const page = yield* attempt(() => context.newPage())
    const cdp = yield* attempt(() => context.newCDPSession(page))
    yield* attempt(() => cdp.send('Network.enable'))
    yield* attempt(() =>
      cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: profile.latencyMs,
        downloadThroughput:
          profile.downloadKbps === 0
            ? -1
            : profile.downloadKbps * KBPS_TO_BYTES,
        uploadThroughput:
          profile.downloadKbps === 0
            ? -1
            : profile.downloadKbps * KBPS_TO_BYTES,
      }),
    )
    yield* attempt(() =>
      cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate }),
    )
    return { page, cdp }
  })

const measureVisit = (visit: Visit, settings: Settings) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { context, profile } = visit
    const { page, cdp } = yield* openPage(context, profile)
    yield* attempt(() =>
      cdp.send('Network.setCacheDisabled', {
        cacheDisabled: visit.name === 'first',
      }),
    )
    if (settings.isProfiling) {
      yield* attempt(() => cdp.send('Profiler.enable'))
      yield* attempt(() =>
        cdp.send('Profiler.setSamplingInterval', { interval: 200 }),
      )
      yield* attempt(() => cdp.send('Profiler.start'))
    }
    const requests: Array<string> = []
    context.removeAllListeners('request')
    context.removeAllListeners('requestfinished')
    const asked = new Map<object, number>()
    const navigationAt = yield* Clock.currentTimeMillis
    if (settings.isNetworkShown) {
      context.on('request', request => asked.set(request, nowMs()))
      context.on('requestfinished', request =>
        requests.push(
          `${String.padStart(6)(globalThis.String((asked.get(request) ?? navigationAt) - navigationAt))} to ${String.padStart(6)(globalThis.String(nowMs() - navigationAt))} ms  ${String.slice(0, 60)(Array.lastNonEmpty(String.split('/')(request.url())))}`,
        ),
      )
    }
    const shots: Array<string> = []
    yield* attempt(() => page.goto(settings.base, { waitUntil: 'commit' }))
    const started = yield* Clock.currentTimeMillis
    const snap = (moment: string) =>
      Effect.gen(function* () {
        const name = `splash-${settings.tag}-${profile.name}-${visit.name}-${moment}`
        yield* attempt(() =>
          page.screenshot({ path: `${import.meta.dir}/shots/${name}.png` }),
        )
        shots.push(name)
      })
    yield* wait(profile.cpuRate === 1 ? 60 : 300)
    yield* snap('early')
    yield* attempt(() =>
      page.waitForFunction(
        () => window.__splashTimes?.['splash hiding'] !== undefined,
        undefined,
        { timeout: 120_000 },
      ),
    )
    const maybeProfile: CpuProfile | undefined = settings.isProfiling
      ? (yield* attempt(() => cdp.send('Profiler.stop'))).profile
      : undefined
    yield* snap('hiding')
    yield* attempt(() =>
      page.waitForFunction(
        () => document.getElementById('splash') === null,
        undefined,
        { timeout: 30_000 },
      ),
    )
    yield* snap('ready')
    const times = yield* evaluateAs(
      page,
      Schema.Record(Schema.String, Schema.Finite),
      () => {
        const [navigation] = performance.getEntriesByType('navigation')
        const splashTimes = window.__splashTimes ?? {}
        if (navigation instanceof PerformanceNavigationTiming) {
          splashTimes['DOMContentLoaded'] =
            navigation.domContentLoadedEventStart
          splashTimes['load event'] = navigation.loadEventStart
        }
        return splashTimes
      },
    )
    const finishedAt = yield* Clock.currentTimeMillis
    yield* Console.log(
      `\n${profile.name} ${visit.name} visit (latency ${profile.latencyMs} ms, ${profile.downloadKbps || 'full'} kbps, CPU ${profile.cpuRate}x), ${finishedAt - started} ms wall:`,
    )
    for (const [name, ms] of Record.toEntries(times).sort(
      ([, first], [, second]) => first - second,
    )) {
      yield* Console.log(`  ${String.padEnd(24)(name)} ${Math.round(ms)} ms`)
    }
    const pageOrigin: number = yield* attempt(() =>
      page.evaluate(() => performance.timeOrigin),
    )
    for (const worker of page.workers()) {
      const { origin, marks } = yield* attempt(() =>
        worker.evaluate(() => ({
          origin: performance.timeOrigin,
          marks: globalThis.Array.from(
            performance.getEntriesByType('mark'),
            mark => [mark.name, mark.startTime] as const,
          ),
        })),
      )
      for (const [name, ms] of marks) {
        yield* Console.log(
          `  worker ${String.padEnd(20)(name)} ${Math.round(ms + origin - pageOrigin)} ms`,
        )
      }
    }
    const longTasks = yield* evaluateAs(
      page,
      Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])),
      () => window.__longTasks ?? [],
    )
    const hiding = times['splash hiding'] ?? Infinity
    const beforeHiding = Array.filter(longTasks, ([start]) => start < hiding)
    yield* Console.log(
      `  long tasks before hiding: ${beforeHiding.length}, ${Math.round(Array.reduce(beforeHiding, 0, (total, [, duration]) => total + duration))} ms total, longest ${Math.round(Math.max(0, ...Array.map(beforeHiding, ([, duration]) => duration)))} ms`,
    )
    for (const [start, duration] of beforeHiding) {
      yield* Console.log(
        `    at ${String.padStart(6)(globalThis.String(Math.round(start)))} ms for ${Math.round(duration)} ms`,
      )
    }
    if (maybeProfile !== undefined) {
      yield* fs.writeFileString(
        `${import.meta.dir}/shots/splash-${settings.tag}-${profile.name}-${visit.name}.cpuprofile`,
        encodeJson(Schema.Unknown)(maybeProfile),
      )
      yield* Console.log('  most CPU time before hiding (self, throttled):')
      for (const line of topSelfTime(maybeProfile)) {
        yield* Console.log(`    ${line}`)
      }
    }
    if (settings.isNetworkShown) {
      yield* Console.log('  requests (wall clock from navigation):')
      for (const line of requests) {
        yield* Console.log(`    ${line}`)
      }
    }
    yield* Console.log(`  shots: ${Array.join(shots, ', ')}`)
    yield* attempt(() => page.close())
  })

type Visit = Readonly<{
  name: (typeof VISITS)[number]
  context: BrowserContext
  profile: Profile
}>

runAuditWith(
  Effect.gen(function* () {
    const settings = yield* Settings
    const browser = yield* openBrowser
    const chosen = Array.filter(PROFILES, ({ name }) =>
      Option.match(settings.only, {
        onNone: () => true,
        onSome: only => only === name,
      }),
    )
    for (const [index, profile] of chosen.entries()) {
      const previous = chosen[index - 1]
      if (previous !== undefined) {
        yield* attempt(() => yieldTurnAsync(`the ${previous.name} profile`, 1))
      }
      const context = yield* attempt(() =>
        browser.newContext({
          viewport: { width: 844, height: 390 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        }),
      )
      yield* attempt(() =>
        context.addInitScript(() => {
          const times: Record<string, number> = {}
          const longTasks: Array<[number, number]> = []
          window.__splashTimes = times
          window.__longTasks = longTasks
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              longTasks.push([entry.startTime, entry.duration])
            }
          }).observe({ type: 'longtask', buffered: true })
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              // NOTE: runs in the page, which has no Effect.
              // @effect-diagnostics-next-line preferEffectString:off
              if (entry.name.startsWith('load:')) {
                times[entry.name] ??= entry.startTime
              }
            }
          }).observe({ type: 'mark', buffered: true })
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              times[entry.name] ??= entry.startTime
            }
          }).observe({ type: 'paint', buffered: true })
          new MutationObserver(() => {
            const splash = document.getElementById('splash')
            if (splash !== null) {
              times['splash in DOM'] ??= performance.now()
              const share = splash.style.getPropertyValue('--splash-progress')
              if (share !== '') {
                times[`bar at ${Math.round(Number(share) * 100)}%`] ??=
                  performance.now()
              }
            }
            if (splash?.classList.contains('is-gone') === true) {
              times['splash hiding'] ??= performance.now()
            }
            if (splash === null && times['splash in DOM'] !== undefined) {
              times['splash removed'] ??= performance.now()
            }
            if (document.querySelector('.game-canvas') !== null) {
              times['game canvas'] ??= performance.now()
            }
          }).observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
          })
        }),
      )

      for (const name of VISITS) {
        yield* measureVisit({ name, context, profile }, settings)
      }
      yield* attempt(() => context.close())
    }
  }),
  NodeServices.layer,
)
