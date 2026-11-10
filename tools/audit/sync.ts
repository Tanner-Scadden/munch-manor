import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  String,
} from 'effect'
import type { Browser, Page } from 'playwright-core'

// Checks player sync end to end against a deployed copy, in headless Chrome,
// with two browser contexts as two devices:
// 1. Device A starts from the live game's version 4 localStorage save (57
//    zombies splatted, What's New seen, no sharing setting yet), syncs with
//    sharing turned on and What's New still seen, changes its shirt, and
//    finishes a run (leaving it from the pause MENU).
// 2. A shows a link code; device B types it under "Use a code".
// 3. B then shows A's shirt, kills, and seen What's New, and says it is
//    linked to 2 devices.
// 4. B turns the music off; A sees it after a reload (a new connection).
// 5. A goes offline, turns screen shake off, says "Offline, will sync",
//    comes back online, catches up, and B sees screen shake off.
// Run it through the heavy guard:
//   bun run heavy -- bun tools/audit/sync.ts https://munch-manor-pr-2.tanner-scadden.workers.dev/
import * as NodeServices from '@effect/platform-node/NodeServices'

import { encodeJson } from '../json'
import { awaitGame, openBrowser, pollUntil, runAuditWith, wait } from './lib'
import { attempt } from './page'

const SAVE_KEY = 'munch-manor:save'
const STARTING_KILLS = 57

// NOTE: the newest What's New day, as the build reads it from CHANGELOG.md,
// so a save that has seen it shows no dot on the What's New button.
const newestNewsDay = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const changelog = yield* fs.readFileString(
    path.join(import.meta.dir, '../../CHANGELOG.md'),
  )
  const heading = Option.getOrElse(
    Array.findFirst(String.split('\n')(changelog), line =>
      String.startsWith('## ')(line),
    ),
    () => '',
  )
  return String.trim(
    Array.headNonEmpty(String.split(': ')(String.slice(3)(heading))),
  )
})

// NOTE: the live game's save, as it keeps it in localStorage today.
const olderSave = (seenNewsDay: string) => ({
  version: 4,
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
    introducedKinds: ['Shambler'],
  },
  homeScreenTip: 'Dismissed',
  settings: { sound: 'Muted', music: 'On', shake: 'On' },
  appearance: {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Ginger',
    skinTone: 'Medium',
    shirtColor: 'Teal',
  },
  difficulty: { chosen: 'Normal', card: 'Seen', nightmare: 'Locked' },
  bests: {
    runsPlayed: 3,
    totalKills: STARTING_KILLS,
    killsByKind: { Shambler: 50, Runner: 7 },
    byDifficulty: {
      Easy: { fastestWinMs: null, bestEndlessWave: null },
      Normal: { fastestWinMs: null, bestEndlessWave: null },
      Hard: { fastestWinMs: null, bestEndlessWave: null },
      Nightmare: { fastestWinMs: null, bestEndlessWave: null },
    },
  },
  home: { seenNewsDay, openedEntries: ['Shambler'] },
})

const errors: Array<string> = []
const watch = (page: Page, name: string) => {
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`))
}

const toggleSelector = (label: string) =>
  `button[aria-label="${label}"][aria-pressed]`

// NOTE: the gear opens the Profile on Settings. Sync, linking, and stats
// sharing live on its Account tab.
type ProfileTab = 'Look' | 'Name' | 'Account' | 'Settings'

const openTab = (page: Page, tab: ProfileTab) =>
  Effect.gen(function* () {
    const open = yield* attempt(() =>
      page.locator('.profile-dialog[open]').count(),
    )
    if (open === 0) {
      yield* attempt(() => page.click('#home-settings'))
      yield* attempt(() => page.waitForSelector('.profile-dialog[open]'))
    }
    yield* attempt(() => page.getByRole('tab', { name: tab }).click())
    yield* wait(300)
  })

const closePanel = (page: Page) =>
  Effect.gen(function* () {
    const open = yield* attempt(() => page.locator('dialog[open]').count())
    if (open > 0) {
      yield* attempt(() => page.keyboard.press('Escape'))
      yield* wait(400)
    }
  })

const tabOf = (label: string): ProfileTab =>
  label === 'Share anonymous play stats' ? 'Account' : 'Settings'

const setting = (page: Page, label: string) =>
  Effect.andThen(
    openTab(page, tabOf(label)),
    attempt(() =>
      page.locator(toggleSelector(label)).getAttribute('aria-pressed'),
    ),
  )

const flip = (page: Page, label: string) =>
  Effect.andThen(
    openTab(page, tabOf(label)),
    attempt(() => page.locator(toggleSelector(label)).click()),
  )

const syncLine = (page: Page) =>
  Effect.andThen(
    openTab(page, 'Account'),
    attempt(() => page.locator('.account-status').textContent()),
  ).pipe(Effect.map(line => line ?? ''))

// NOTE: waits on the status line until it says what is expected, checking
// twice a second. Returns the last thing it said.
const waitForLine = (page: Page, expected: RegExp, timeoutMs: number) =>
  pollUntil(syncLine(page), line => expected.test(line), 500, timeoutMs).pipe(
    Effect.map(({ last }) => last),
  )

const hasNewsDot = (page: Page) =>
  Effect.gen(function* () {
    yield* closePanel(page)
    const label = yield* attempt(() =>
      page.locator('#home-manor').getAttribute('aria-label'),
    )
    return String.includes("Something new in What's new")(label ?? '')
  })

// NOTE: the home menu's bests badge names each best only for a screen
// reader, beside its icon, so the kills row is found by that hidden name.
const splatted = (page: Page) =>
  Effect.gen(function* () {
    yield* closePanel(page)
    const best = page
      .locator('.home-best')
      .filter({ has: page.getByText('Zombies splatted', { exact: true }) })
      .locator('.home-best-value')
    if ((yield* attempt(() => best.count())) === 0) {
      return ''
    }
    const text = yield* attempt(() => best.textContent())
    return text ?? ''
  })

const look = (page: Page) =>
  Effect.gen(function* () {
    yield* closePanel(page)
    yield* attempt(() => page.click('.home-hero'))
    const preview = page.locator('[aria-label^="Preview:"]')
    yield* attempt(() => preview.waitFor())
    const label = yield* attempt(() => preview.getAttribute('aria-label'))
    return label ?? ''
  })

const closeLook = (page: Page) =>
  Effect.andThen(
    attempt(() => page.keyboard.press('Escape')),
    wait(400),
  )

const pickShirt = (page: Page, color: string) =>
  Effect.gen(function* () {
    yield* look(page)
    yield* attempt(() =>
      page
        .getByRole('radiogroup', { name: 'Parts' })
        .getByRole('radio', { name: 'Outfit' })
        .click(),
    )
    yield* attempt(() =>
      page
        .getByRole('radiogroup', { name: 'Outfit color' })
        .getByRole('radio', { name: color })
        .click(),
    )
    yield* wait(300)
    yield* closeLook(page)
  })

// NOTE: the shortest real run end: start the campaign, pause, and leave it
// from the MENU. Leaving counts the run.
const finishRun = (page: Page) =>
  Effect.gen(function* () {
    yield* closePanel(page)
    yield* attempt(() => page.locator('.game-surface').focus())
    yield* attempt(() => page.keyboard.press('Enter'))
    yield* wait(800)
    const normal = page.getByRole('button', { name: /^Double Dare/ })
    if ((yield* attempt(() => normal.count())) > 0) {
      yield* attempt(() => normal.first().click())
      yield* wait(800)
    }
    yield* attempt(() => page.keyboard.press('Escape'))
    yield* wait(500)
    yield* attempt(() => page.keyboard.press('KeyH'))
    yield* wait(800)
    yield* attempt(() => page.getByRole('button', { name: 'Leave' }).click())
    yield* wait(1000)
  })

const newDevice = (browser: Browser, name: string) =>
  Effect.gen(function* () {
    const context = yield* attempt(() =>
      browser.newContext({
        viewport: { width: 1280, height: 720 },
      }),
    )
    const page = yield* attempt(() => context.newPage())
    watch(page, name)
    return { context, page }
  })

const SYNC_TIMEOUT = 20_000

const checkSync = (base: string) =>
  Effect.gen(function* () {
    const failures: Array<string> = []
    const check = (isOk: boolean, label: string) =>
      Effect.andThen(
        Console.log(`${isOk ? 'ok  ' : 'FAIL'} ${label}`),
        Effect.sync(() => {
          if (!isOk) {
            failures.push(label)
          }
        }),
      )
    const newsDay = yield* newestNewsDay
    const browser = yield* openBrowser

    yield* Console.log(`Checking sync on ${base}`)
    const a = yield* newDevice(browser, 'device A')
    yield* attempt(() => a.page.goto(new URL('version.json', base).href))
    const olderJson = encodeJson(Schema.Json)(olderSave(newsDay))
    yield* attempt(() =>
      a.page.evaluate(([key, json]) => localStorage.setItem(key, json), [
        SAVE_KEY,
        olderJson,
      ] as const),
    )
    yield* attempt(() => a.page.goto(base))
    yield* awaitGame(a.page)
    const aSynced = yield* waitForLine(a.page, /^Synced/, SYNC_TIMEOUT)
    yield* check(
      String.startsWith('Synced')(aSynced),
      'device A syncs its older save',
    )
    const aKills = yield* splatted(a.page)
    yield* check(
      aKills === `${STARTING_KILLS}`,
      `device A shows ${STARTING_KILLS} zombies splatted`,
    )
    const aDot = yield* hasNewsDot(a.page)
    yield* check(!aDot, `device A keeps What's New seen (${newsDay})`)
    const sharing = yield* setting(a.page, 'Share anonymous play stats')
    yield* check(
      sharing === 'true',
      'device A has stats sharing turned on by the migration',
    )

    yield* pickShirt(a.page, 'Purple')
    const aLook = yield* look(a.page)
    yield* check(
      String.includes('purple tee')(aLook),
      'device A changes its shirt to purple',
    )
    yield* closeLook(a.page)
    yield* finishRun(a.page)
    yield* wait(1500)

    yield* openTab(a.page, 'Account')
    yield* attempt(() =>
      a.page.getByRole('button', { name: 'Link another device' }).click(),
    )
    yield* attempt(() =>
      a.page.locator('.account-code').waitFor({ timeout: SYNC_TIMEOUT }),
    )
    const codeText = yield* attempt(() =>
      a.page.locator('.account-code').textContent(),
    )
    const code = String.trim(codeText ?? '')
    yield* check(
      /^[A-Z2-9]{6}$/.test(code),
      `device A shows a link code (${code})`,
    )

    const b = yield* newDevice(browser, 'device B')
    yield* attempt(() => b.page.goto(base))
    yield* awaitGame(b.page)
    const bSynced = yield* waitForLine(b.page, /^Synced/, SYNC_TIMEOUT)
    yield* check(
      String.startsWith('Synced')(bSynced),
      'device B syncs its own new player',
    )
    const bKills = yield* splatted(b.page)
    yield* check(bKills === '', 'device B starts with no kills')
    const bDot = yield* hasNewsDot(b.page)
    yield* check(bDot, "device B starts with What's New unseen")
    yield* openTab(b.page, 'Account')
    yield* attempt(() =>
      b.page.getByRole('button', { name: 'Use a code' }).click(),
    )
    const codeForm = b.page.locator('label[for="link-code-input"]')
    yield* attempt(() => codeForm.waitFor({ timeout: SYNC_TIMEOUT }))
    const formText = yield* attempt(() => codeForm.textContent())
    yield* check(
      String.includes("This device will use the other device's progress.")(
        formText ?? '',
      ),
      "device B's code form says it will use the other device's progress",
    )
    yield* attempt(() =>
      b.page.locator('.account-code-input').fill(String.toLowerCase(code)),
    )
    yield* attempt(() =>
      b.page.getByRole('button', { name: 'Link', exact: true }).click(),
    )
    yield* attempt(() =>
      b.page
        .getByText("Linked! This device now uses your other device's progress.")
        .waitFor({ timeout: SYNC_TIMEOUT }),
    )
    yield* check(true, 'device B links with the code')
    const bLine = yield* waitForLine(
      b.page,
      /Linked to 2 devices/,
      SYNC_TIMEOUT,
    )
    yield* check(/Linked to 2 devices/.test(bLine), `device B says "${bLine}"`)
    const bLinkedKills = yield* splatted(b.page)
    yield* check(
      bLinkedKills === `${STARTING_KILLS}`,
      `device B shows A's ${STARTING_KILLS} zombies splatted`,
    )
    const bLook = yield* look(b.page)
    yield* check(
      String.includes('purple tee')(bLook),
      "device B shows A's purple shirt",
    )
    yield* closeLook(b.page)
    const bLinkedDot = yield* hasNewsDot(b.page)
    yield* check(!bLinkedDot, "device B shows A's What's New as seen")
    const aLine = yield* waitForLine(
      a.page,
      /Linked to 2 devices/,
      SYNC_TIMEOUT,
    )
    yield* check(
      /Linked to 2 devices/.test(aLine),
      `device A says "${aLine}" without a reload`,
    )

    const musicBefore = yield* setting(b.page, 'Music')
    yield* flip(b.page, 'Music')
    const musicSeen: Array<string | null> = []
    for (const _ of [1, 2, 3, 4, 5, 6]) {
      yield* wait(500)
      const seen = yield* setting(b.page, 'Music')
      musicSeen.push(seen)
    }
    yield* check(
      Array.every(musicSeen, value => value === 'false'),
      `device B turns the music off and it stays off (${musicBefore} then ${Array.join(
        Array.map(musicSeen, value => value ?? ''),
        ', ',
      )})`,
    )
    yield* wait(2000)
    yield* attempt(() => a.page.reload())
    yield* awaitGame(a.page)
    yield* waitForLine(a.page, /^Synced/, SYNC_TIMEOUT)
    const aMusic = yield* setting(a.page, 'Music')
    yield* check(
      aMusic === 'false',
      "device A sees B's music setting after a reload",
    )

    yield* attempt(() => a.context.setOffline(true))
    yield* wait(1500)
    yield* flip(a.page, 'Screen shake')
    const offline = yield* waitForLine(
      a.page,
      /Offline, will sync/,
      SYNC_TIMEOUT,
    )
    yield* check(
      offline === 'Offline, will sync',
      `device A offline says "${offline}"`,
    )
    yield* attempt(() => a.context.setOffline(false))
    const back = yield* waitForLine(a.page, /^Synced/, 40_000)
    yield* check(
      String.startsWith('Synced')(back),
      `device A back online says "${back}"`,
    )
    yield* wait(2000)
    yield* attempt(() => b.page.reload())
    yield* awaitGame(b.page)
    yield* waitForLine(b.page, /^Synced/, SYNC_TIMEOUT)
    const bShake = yield* setting(b.page, 'Screen shake')
    yield* check(
      bShake === 'false',
      "device B sees A's offline change once A is back",
    )

    yield* attempt(() => browser.close())

    yield* check(
      errors.length === 0,
      `no page errors${errors.length === 0 ? '' : `: ${Array.join(errors, '; ')}`}`,
    )
    yield* Console.log(
      failures.length === 0
        ? 'All sync checks passed.'
        : `${failures.length} checks failed.`,
    )
    yield* Effect.sync(() => {
      process.exitCode = failures.length === 0 ? 0 : 1
    })
  })

runAuditWith(
  Effect.gen(function* () {
    const envBase = yield* Config.String('BASE').pipe(Config.option)
    const base = Option.orElse(
      Option.fromUndefinedOr(process.argv[2]),
      () => envBase,
    )
    if (Option.isNone(base)) {
      yield* Console.error('Usage: bun tools/audit/sync.ts <site url>')
      yield* Effect.sync(() => {
        process.exitCode = 2
      })
      return
    }
    yield* checkSync(base.value)
  }),
  NodeServices.layer,
)
