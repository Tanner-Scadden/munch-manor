// Checks co-op rooms on a deployed copy, in headless Chrome: two to four
// pages of the co-op dev page (tools/mp-dev) as separate players. The first
// creates a room; the rest join from its link; the run starts when every
// page has pressed READY, and each page walks in circles (`?bot=1`). Then it
// checks that every page sees every other page's dot move, measures the
// round trip and the bandwidth each page reports, reloads one page to
// rejoin its seat, and has the host end the run, which every page must
// hear. Last, as many fresh pages press QUICK PLAY (`?quick=1`, which also
// accepts an offer to start with fewer, so 2 or 3 players wait about 45 s)
// and must land in one public room together.
// Run it through the heavy guard, as a Shared job (one context per page):
//   bun run heavy -- --shared bun tools/audit/mp.ts https://munch-manor-mp-dev-pr-12.tanner-scadden.workers.dev/ [players]
import {
  Array,
  Config,
  Console,
  Duration,
  Effect,
  Option,
  Order,
  Schedule,
  Schema,
} from 'effect'
import type { BrowserContext, Page } from 'playwright-core'

import { encodeJson } from '../json'
import {
  SHOTS_DIR,
  finish,
  openBrowser,
  pollUntil,
  runAudit,
  wait,
} from './lib'
import { attempt, failWith } from './page'

const PLAY_SECONDS = 12

// NOTE: the dev page's `#debug` readout, the fields this audit reads.
const Debug = Schema.Struct({
  code: Schema.String,
  visibility: Schema.NullOr(Schema.String),
  names: Schema.Array(Schema.String),
  slot: Schema.NullOr(Schema.Finite),
  phase: Schema.String,
  lobbyStatus: Schema.NullOr(Schema.String),
  members: Schema.Finite,
  rttMs: Schema.Finite,
  downKBs: Schema.Finite,
  inputsPerSecond: Schema.Finite,
  bytesIn: Schema.Finite,
  framesIn: Schema.Finite,
  framesOut: Schema.Finite,
  corrections: Schema.Finite,
  maxCorrectionPx: Schema.Finite,
  tick: Schema.NullOr(Schema.Finite),
  others: Schema.Array(
    Schema.Struct({
      slot: Schema.Finite,
      x: Schema.Finite,
      away: Schema.Boolean,
    }),
  ),
})
type Debug = typeof Debug.Type
const DebugJson = Schema.fromJsonString(Debug)

const problems: Array<string> = []

const debugOf = (page: Page) =>
  Effect.gen(function* () {
    const text = yield* attempt(() => page.locator('#debug').textContent())
    if (text === null || text === '') {
      return undefined
    }
    return yield* Schema.decodeEffect(DebugJson)(text)
  })

const debugsOf = (pages: ReadonlyArray<Page>) =>
  Effect.forEach(pages, debugOf, { concurrency: 'unbounded' })

const until = (
  what: string,
  pages: ReadonlyArray<Page>,
  holds: (debug: Debug) => boolean,
  timeoutMs: number,
) =>
  Effect.gen(function* () {
    const { last: isMet, elapsedMs } = yield* pollUntil(
      Effect.map(debugsOf(pages), debugs =>
        Array.every(debugs, debug => debug !== undefined && holds(debug)),
      ),
      isDone => isDone,
      250,
      timeoutMs,
    )
    if (isMet) {
      yield* Console.log(`  ok  ${what} (${elapsedMs} ms)`)
      return true
    }
    problems.push(what)
    yield* Console.log(`  FAIL ${what}`)
    return false
  })

const DEFAULT_TIMEOUT_MS = 20_000

const withBot = (url: string, name: string, code?: string): string => {
  const next = new URL(url)
  next.searchParams.set('bot', '1')
  next.searchParams.set('name', name)
  if (code !== undefined) {
    next.searchParams.set('room', code)
  }
  return next.toString()
}

const NAMES = ['Ana', 'Bo', 'Cy', 'Dee']

const screenshot = (page: Page | undefined, path: string) =>
  page === undefined ? Effect.void : attempt(() => page.screenshot({ path }))

const Measured = Schema.Struct({
  page: Schema.Finite,
  slot: Schema.optional(Schema.NullOr(Schema.Finite)),
  rttMs: Schema.optional(Schema.Finite),
  downKBsWindow: Schema.Finite,
  downKBsRun: Schema.Finite,
  messagesInPerSecond: Schema.Finite,
  messagesOutPerSecond: Schema.Finite,
  inputsPerSecond: Schema.Finite,
  corrections: Schema.optional(Schema.Finite),
  maxCorrectionPx: Schema.Finite,
})
const encodeMeasured = encodeJson(Measured)

const program = Effect.gen(function* () {
  const maybeEnvBase = yield* Config.String('BASE').pipe(Config.option)
  const maybeBase = Option.orElse(
    Option.fromUndefinedOr(process.argv[2]),
    () => maybeEnvBase,
  )
  if (Option.isNone(maybeBase)) {
    yield* Console.error(
      'Usage: bun tools/audit/mp.ts <co-op dev page url> [players]',
    )
    return yield* Effect.sync(() => process.exit(2))
  }
  const BASE = maybeBase.value
  const PLAYERS = Math.min(4, Math.max(2, Number(process.argv[3] ?? 3)))
  const browser = yield* openBrowser
  const contexts: Array<BrowserContext> = []
  const pages: Array<Page> = []

  for (let index = 0; index < PLAYERS; index += 1) {
    const context = yield* attempt(() =>
      browser.newContext({ viewport: { width: 1000, height: 820 } }),
    )
    contexts.push(context)
    const page = yield* attempt(() => context.newPage())
    page.on('pageerror', error =>
      problems.push(`page ${index}: ${error.message}`),
    )
    pages.push(page)
  }

  const [host, ...guests] = pages
  if (host === undefined) {
    return yield* failWith('No host page')
  }

  yield* Console.log(`Co-op check with ${PLAYERS} players against ${BASE}`)
  yield* attempt(() => host.goto(withBot(BASE, NAMES[0] ?? 'Ana')))
  yield* attempt(() =>
    host
      .locator('#status')
      .filter({ hasText: 'Signed in' })
      .waitFor({ timeout: 20_000 }),
  )
  yield* attempt(() => host.locator('#create').click())
  yield* attempt(() => host.waitForURL(/room=/, { timeout: 20_000 }))
  const code = new URL(host.url()).searchParams.get('room') ?? ''
  yield* Console.log(`  ok  the host created room ${code}`)

  yield* Effect.forEach(
    guests,
    (page, index) =>
      attempt(() => page.goto(withBot(BASE, NAMES[index + 1] ?? 'Zed', code))),
    { concurrency: 'unbounded', discard: true },
  )
  const names = Array.join(
    Array.sort(Array.take(NAMES, PLAYERS), Order.String),
    ',',
  )
  yield* until(
    `every page shows ${PLAYERS} members by name`,
    pages,
    debug =>
      debug.members === PLAYERS &&
      Array.join(Array.sort(debug.names, Order.String), ',') === names,
    DEFAULT_TIMEOUT_MS,
  )

  for (const page of pages) {
    yield* attempt(() => page.locator('#ready:not([disabled])').click())
  }
  yield* until(
    'the last READY starts the run on every page',
    pages,
    debug => debug.phase === 'Playing' && debug.tick !== null,
    DEFAULT_TIMEOUT_MS,
  )

  const seen = new Map<number, Map<number, Set<number>>>()
  const statsOfAll = debugsOf(pages)
  const watchOthers = Effect.map(debugsOf(pages), debugs => {
    Array.forEach(debugs, (debug, index) => {
      Array.forEach(debug?.others ?? [], other => {
        const byOther = seen.get(index) ?? new Map<number, Set<number>>()
        const xs = byOther.get(other.slot) ?? new Set<number>()
        xs.add(Math.round(other.x))
        byOther.set(other.slot, xs)
        seen.set(index, byOther)
      })
    })
  })
  // NOTE: the play is timed from the first readout to the last, so the rates
  // below are over the whole play.
  const [played, [firstStats, lastStats]] = yield* Effect.timed(
    Effect.all([
      statsOfAll,
      watchOthers.pipe(
        Effect.repeat(
          Schedule.spaced(Duration.millis(200)).pipe(
            Schedule.upTo({ duration: Duration.seconds(PLAY_SECONDS) }),
          ),
        ),
        Effect.andThen(statsOfAll),
      ),
    ]),
  )
  for (const index of pages.keys()) {
    const byOther = seen.get(index)
    const moved = Array.filter(
      [...(byOther?.values() ?? [])],
      xs => xs.size > 10,
    ).length
    if (moved < PLAYERS - 1) {
      problems.push(`page ${index} saw ${moved} of ${PLAYERS - 1} others move`)
    } else {
      yield* Console.log(
        `  ok  page ${index} saw all ${PLAYERS - 1} others move`,
      )
    }
  }

  const seconds = Duration.toMillis(played) / 1000
  const measured = Array.map(lastStats, (debug, index) => {
    const first = firstStats[index]
    return {
      page: index,
      slot: debug?.slot,
      rttMs: debug?.rttMs,
      downKBsWindow: Number(debug?.downKBs.toFixed(2)),
      downKBsRun: Number(
        (
          ((debug?.bytesIn ?? 0) - (first?.bytesIn ?? 0)) /
          1024 /
          seconds
        ).toFixed(2),
      ),
      messagesInPerSecond: Number(
        (((debug?.framesIn ?? 0) - (first?.framesIn ?? 0)) / seconds).toFixed(
          1,
        ),
      ),
      messagesOutPerSecond: Number(
        (((debug?.framesOut ?? 0) - (first?.framesOut ?? 0)) / seconds).toFixed(
          1,
        ),
      ),
      inputsPerSecond: Number(debug?.inputsPerSecond.toFixed(1)),
      corrections: debug?.corrections,
      maxCorrectionPx: Number(debug?.maxCorrectionPx.toFixed(1)),
    }
  })
  yield* Console.log('  measured over the play:')
  for (const row of measured) {
    yield* Console.log(`    ${encodeMeasured(row)}`)
  }

  yield* Effect.forEach(
    pages,
    (page, index) =>
      screenshot(page, `${SHOTS_DIR}/mp-${PLAYERS}p-page${index}.png`),
    { concurrency: 'unbounded', discard: true },
  )
  yield* Console.log(`  shots in ${SHOTS_DIR}/mp-${PLAYERS}p-page*.png`)

  const rejoining = guests[0]
  if (rejoining !== undefined) {
    const before = yield* debugOf(rejoining)
    yield* attempt(() => rejoining.reload())
    yield* until(
      'a reloaded page rejoins its seat and plays again',
      [rejoining],
      debug => debug.phase === 'Playing' && debug.slot === before?.slot,
      DEFAULT_TIMEOUT_MS,
    )
    yield* until(
      'nobody shows the reloaded player as away',
      [host],
      debug => Array.every(debug.others, other => !other.away),
      10_000,
    )
  }

  yield* attempt(() => host.locator('#end:not([disabled])').click())
  yield* until(
    'every page hears the game end',
    pages,
    debug => debug.phase === 'Ended',
    DEFAULT_TIMEOUT_MS,
  )
  yield* until(
    'every lobby is back for another run',
    pages,
    debug => debug.lobbyStatus === 'Lobby',
    DEFAULT_TIMEOUT_MS,
  )
  yield* screenshot(pages[0], `${SHOTS_DIR}/mp-${PLAYERS}p-ended.png`)
  yield* Effect.forEach(contexts, context => attempt(() => context.close()), {
    concurrency: 'unbounded',
    discard: true,
  })

  const quickContexts: Array<BrowserContext> = []
  const quickPages: Array<Page> = []
  for (let index = 0; index < PLAYERS; index += 1) {
    const context = yield* attempt(() =>
      browser.newContext({ viewport: { width: 1000, height: 820 } }),
    )
    quickContexts.push(context)
    const page = yield* attempt(() => context.newPage())
    page.on('pageerror', error =>
      problems.push(`quick page ${index}: ${error.message}`),
    )
    const url = new URL(withBot(BASE, `Quick ${index + 1}`))
    url.searchParams.set('quick', '1')
    yield* attempt(() => page.goto(url.toString()))
    quickPages.push(page)
    yield* wait(300)
  }
  yield* screenshot(quickPages[0], `${SHOTS_DIR}/mp-${PLAYERS}p-queue.png`)
  yield* until(
    `${PLAYERS} QUICK PLAY pages land in one public room`,
    quickPages,
    debug => debug.visibility === 'Public' && debug.members === PLAYERS,
    PLAYERS === 4 ? 30_000 : 90_000,
  )
  const quickDebugs = yield* debugsOf(quickPages)
  const quickCodes = new Set(Array.map(quickDebugs, debug => debug?.code))
  if (quickCodes.size !== 1) {
    problems.push(`QUICK PLAY made ${quickCodes.size} rooms`)
  }
  yield* screenshot(
    quickPages[0],
    `${SHOTS_DIR}/mp-${PLAYERS}p-quick-lobby.png`,
  )
  yield* Effect.forEach(
    quickContexts,
    context => attempt(() => context.close()),
    { concurrency: 'unbounded', discard: true },
  )
  yield* finish(problems, `Co-op with ${PLAYERS} players works on ${BASE}`)
})

runAudit(program)
