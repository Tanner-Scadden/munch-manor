// Co-op audit (tools/audit/coop.ts): each player's own browser page: the save it
// starts with (rank, look), the viewport, checks, and waiting.

import {
  Array,
  Config,
  Console,
  Effect,
  Function,
  Record,
  Schema,
} from 'effect'
import type { Browser, BrowserContext, Page } from 'playwright-core'

import { pointsForRank } from '@game/rank'

import { encodeJson } from '../../json'
import { SHOTS_DIR, pollUntil } from '../lib'
import { type AuditFailed, attempt } from '../page'
import { coopConfig, slowSockets } from './config'

const SAVE_KEY = 'munch-manor:save'

type ViewportSize = Readonly<{
  width: number
  height: number
  isMobile: boolean
}>
const DESKTOP: ViewportSize = { width: 1280, height: 720, isMobile: false }
const VIEWPORTS: Readonly<Record<string, ViewportSize>> = {
  d1280: DESKTOP,
  l844: { width: 844, height: 390, isMobile: false },
  p390: { width: 390, height: 844, isMobile: false },
}
export const viewportName = Config.String('VIEWPORT').pipe(
  Config.withDefault('d1280'),
)
export const viewportOf = (name: string) => VIEWPORTS[name] ?? DESKTOP

const GRADUATE_SAVE = {
  version: 3,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      shop: 'Learned',
      swap: 'Learned',
      pickup: 'Learned',
      timedBreaks: 'Learned',
      openBreak: 'Learned',
    },
    trapHint: 'Seen',
    introducedKinds: [],
  },
  homeScreenTip: 'Dismissed',
  settings: { sound: 'Muted', music: 'Off', shake: 'On' },
  appearance: {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Pink',
    skinTone: 'Tan',
    shirtColor: 'Teal',
  },
  difficulty: { chosen: 'Normal', card: 'Seen', nightmare: 'Locked' },
}

// NOTE: each page plays at its own rank, so every page can check that it
// reads the others' in the lobby. The save holds a kill for each point the
// veteran grant pays (src/rank.ts), up to rank 10.
export const RANKS = [6, 8, 10]

const bestsOfRank = (rank: number) => ({
  runsPlayed: 0,
  totalKills: 0,
  killsByKind: { Shambler: pointsForRank(rank) },
  byDifficulty: Record.fromEntries(
    Array.map(['Easy', 'Normal', 'Hard', 'Nightmare'], name => [
      name,
      { fastestWinMs: null, bestEndlessWave: null },
    ]),
  ),
})

// NOTE: each player wears their own look, so every page can check that it
// draws the others in theirs.
const LOOKS = [
  {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Pink',
    skinTone: 'Tan',
    shirtColor: 'Teal',
  },
  {
    body: 'Male',
    hairStyle: 'Curls',
    hairColor: 'Blonde',
    skinTone: 'Deep',
    shirtColor: 'Red',
  },
  {
    body: 'Female',
    hairStyle: 'Long',
    hairColor: 'Black',
    skinTone: 'Fair',
    shirtColor: 'Yellow',
  },
]

export const problems: Array<string> = []

export const check: {
  (label: string): (isOk: boolean) => Effect.Effect<void>
  (isOk: boolean, label: string): Effect.Effect<void>
} = Function.dual(2, (isOk: boolean, label: string): Effect.Effect<void> =>
  Effect.andThen(
    Console.log(`${isOk ? '  ok  ' : '  FAIL'} ${label}`),
    Effect.sync(() => {
      if (!isOk) {
        problems.push(label)
      }
    }),
  ),
)

// NOTE: polls `holds` (a failure counts as not yet) until it holds or
// `timeoutMs` has passed, and logs the step as ok or a problem.
export const untilWithin: {
  <E>(
    holds: Effect.Effect<boolean, E>,
    timeoutMs: number,
  ): (label: string) => Effect.Effect<boolean>
  <E>(
    label: string,
    holds: Effect.Effect<boolean, E>,
    timeoutMs: number,
  ): Effect.Effect<boolean>
} = Function.dual(
  3,
  <E>(
    label: string,
    holds: Effect.Effect<boolean, E>,
    timeoutMs: number,
  ): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const { last: isMet, elapsedMs } = yield* pollUntil(
        holds.pipe(Effect.orElseSucceed(() => false)),
        isDone => isDone,
        200,
        timeoutMs,
      )
      if (isMet) {
        yield* Console.log(`  ok   ${label} (${elapsedMs} ms)`)
        return true
      }
      problems.push(label)
      yield* Console.log(`  FAIL ${label}`)
      return false
    }),
)

// NOTE: `untilWithin` with 20 s.
export const until: {
  <E>(
    holds: Effect.Effect<boolean, E>,
  ): (label: string) => Effect.Effect<boolean>
  <E>(label: string, holds: Effect.Effect<boolean, E>): Effect.Effect<boolean>
} = Function.dual(
  2,
  <E>(
    label: string,
    holds: Effect.Effect<boolean, E>,
  ): Effect.Effect<boolean> => untilWithin(label, holds, 20_000),
)

export const shot: {
  (name: string): (page: Page) => Effect.Effect<void, AuditFailed>
  (page: Page, name: string): Effect.Effect<void, AuditFailed>
} = Function.dual(
  2,
  (page: Page, name: string): Effect.Effect<void, AuditFailed> =>
    Effect.gen(function* () {
      const viewport = yield* viewportName.pipe(
        Effect.orElseSucceed(() => 'd1280'),
      )
      yield* attempt(() =>
        page.screenshot({
          path: `${SHOTS_DIR}/coop-e2e-${viewport === 'd1280' ? '' : `${viewport}-`}${name}.png`,
        }),
      )
    }),
)

export const contexts: Array<BrowserContext> = []

export const openPlayer: {
  (
    name: string,
    lookIndex: number,
  ): (browser: Browser) => Effect.Effect<Page, AuditFailed | Config.ConfigError>
  (
    browser: Browser,
    name: string,
    lookIndex: number,
  ): Effect.Effect<Page, AuditFailed | Config.ConfigError>
} = Function.dual(
  3,
  (
    browser: Browser,
    name: string,
    lookIndex: number,
  ): Effect.Effect<Page, AuditFailed | Config.ConfigError> =>
    Effect.gen(function* () {
      const config = yield* coopConfig
      const viewport = yield* viewportName
      const size = viewportOf(viewport)
      const phoneContext =
        viewport === 'd1280' ? {} : { isMobile: true, hasTouch: true }
      const context = yield* attempt(() =>
        browser.newContext({
          viewport: { width: size.width, height: size.height },
          ...phoneContext,
        }),
      )
      contexts.push(context)
      const page = yield* attempt(() => context.newPage())
      if (config.netRtt !== undefined && !Number.isNaN(config.netRtt)) {
        const link = {
          rttMs: config.netRtt,
          jitterMs: config.netJitter ?? 0,
          lossPercent: config.netLoss ?? 0,
        }
        yield* attempt(() => page.addInitScript(slowSockets, link))
      }
      page.on('pageerror', error => problems.push(`${name}: ${error.message}`))
      yield* attempt(() => page.goto(new URL('version.json', config.base).href))
      const save = encodeJson(Schema.Json)({
        ...GRADUATE_SAVE,
        appearance: LOOKS[lookIndex % LOOKS.length] ?? null,
        bests: bestsOfRank(RANKS[lookIndex % RANKS.length] ?? 1),
      })
      yield* attempt(() =>
        page.evaluate(([key, json]) => localStorage.setItem(key, json), [
          SAVE_KEY,
          save,
        ] as const),
      )
      return page
    }),
)

export const filledSeats = (page: Page) =>
  attempt(() => page.locator('.coop-seat:not([data-state="Empty"])').count())

export const roomCodeOf = (page: Page) =>
  attempt(() => page.locator('.coop-room-code-symbol').allTextContents()).pipe(
    Effect.map(symbols => Array.join(symbols, '')),
  )
