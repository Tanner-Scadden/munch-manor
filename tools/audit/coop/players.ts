// Co-op audit (tools/audit/coop.ts): each player's own browser page: the save it
// starts with (rank, look), the viewport, checks, and waiting.

import { Schema } from 'effect'
import type { BrowserContext, Page } from 'playwright-core'

import { pointsForRank } from '@game/rank'

import { encodeJson } from '../../json'
import { SHOTS_DIR, launch, pollUntil } from '../lib'
import { BASE, NET_JITTER, NET_LOSS, NET_RTT, slowSockets } from './config'

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
export const VIEWPORT_NAME = process.env['VIEWPORT'] ?? 'd1280'
export const VIEWPORT = VIEWPORTS[VIEWPORT_NAME] ?? DESKTOP

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
export const RANKS = [3, 8, 10]

const bestsOfRank = (rank: number) => ({
  runsPlayed: 0,
  totalKills: 0,
  killsByKind: { Shambler: pointsForRank(rank) },
  byDifficulty: Object.fromEntries(
    ['Easy', 'Normal', 'Hard', 'Nightmare'].map(name => [
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

export const check = (isOk: boolean, label: string) => {
  console.log(`${isOk ? '  ok  ' : '  FAIL'} ${label}`)
  if (!isOk) {
    problems.push(label)
  }
}

export const until = async (
  label: string,
  holds: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<boolean> => {
  const { last: isMet, elapsedMs } = await pollUntil(
    () => holds().catch(() => false),
    isDone => isDone,
    200,
    timeoutMs,
  )
  if (isMet) {
    console.log(`  ok   ${label} (${elapsedMs} ms)`)
    return true
  }
  problems.push(label)
  console.log(`  FAIL ${label}`)
  return false
}

export const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${SHOTS_DIR}/coop-e2e-${VIEWPORT_NAME === 'd1280' ? '' : `${VIEWPORT_NAME}-`}${name}.png`,
  })

export const browser = await launch()
const PHONE_CONTEXT =
  VIEWPORT_NAME === 'd1280' ? {} : { isMobile: true, hasTouch: true }
export const contexts: Array<BrowserContext> = []

export const openPlayer = async (
  name: string,
  lookIndex = 0,
): Promise<Page> => {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    ...PHONE_CONTEXT,
  })
  contexts.push(context)
  const page = await context.newPage()
  if (NET_RTT !== undefined && !Number.isNaN(NET_RTT)) {
    await page.addInitScript(slowSockets, {
      rttMs: NET_RTT,
      jitterMs: NET_JITTER ?? 0,
      lossPercent: NET_LOSS ?? 0,
    })
  }
  page.on('pageerror', error => problems.push(`${name}: ${error.message}`))
  await page.goto(new URL('version.json', BASE).href)
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [
    SAVE_KEY,
    encodeJson(Schema.Json)({
      ...GRADUATE_SAVE,
      appearance: LOOKS[lookIndex % LOOKS.length] ?? null,
      bests: bestsOfRank(RANKS[lookIndex % RANKS.length] ?? 1),
    }),
  ] as const)
  return page
}

export const filledSeats = (page: Page) =>
  page.locator('.coop-seat:not([data-state="Empty"])').count()

export const roomCodeOf = async (page: Page): Promise<string> => {
  const symbols = await page.locator('.coop-room-code-symbol').allTextContents()
  return symbols.join('')
}
