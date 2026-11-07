// Checks the on-device save in SQLite on OPFS, in headless Chrome, against
// the production build or a deployed copy:
// 1. An older localStorage save is imported into SQLite on the first load.
// 2. A setting changed after that lasts across a reload while localStorage
//    stays untouched, so it came back from SQLite, and the database file
//    is in OPFS.
// 3. A second tab follows the first, its change goes through the leader,
//    and when the leader closes the second tab takes over the database.
//    Every reload after that still reads one whole, current save.
// Run it through the heavy guard:
//   BASE=http://localhost:4173/ bun run heavy -- bun tools/audit/sqlite.ts
import { Array, Clock, Config, Console, Effect, Schema, String } from 'effect'
import type { Page } from 'playwright-core'

import { encodeJson } from '../json'
import { GAME, awaitGame, openBrowser, runAudit, wait } from './lib'
import { attempt } from './page'

const SAVE_KEY = 'munch-manor:save'

const legacySave = {
  version: 2,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      shop: 'Pending',
      swap: 'Pending',
      pickup: 'Pending',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
    },
    trapHint: 'Unseen',
    introducedKinds: [],
  },
  homeScreenTip: 'Unseen',
  settings: { sound: 'Muted', music: 'On', shake: 'On' },
  appearance: {
    body: 'Male',
    hairStyle: 'Crop',
    hairColor: 'Brown',
    skinTone: 'Light',
    shirtColor: 'Teal',
  },
  difficulty: { chosen: 'Normal', card: 'Seen', nightmare: 'Locked' },
}

// NOTE: the gear on the home menu (#home-settings) opens the Profile on its
// Settings tab, a list named "Game settings" of toggle buttons named by
// their setting, with aria-pressed. It is opened once per page load.
const settingsList = (page: Page) =>
  page.getByRole('list', { name: 'Game settings' })

const toggle = (page: Page, label: string) =>
  settingsList(page).getByRole('button', { name: label, exact: true })

const openSettings = (page: Page) =>
  Effect.gen(function* () {
    const isOpen = yield* attempt(() => settingsList(page).isVisible())
    if (!isOpen) {
      yield* attempt(() => page.click('#home-settings'))
      yield* attempt(() => settingsList(page).waitFor())
    }
  })

const setting = (page: Page, label: string) =>
  Effect.andThen(
    openSettings(page),
    attempt(() => toggle(page, label).getAttribute('aria-pressed')),
  )

const flip = (page: Page, label: string) =>
  Effect.andThen(
    openSettings(page),
    attempt(() => toggle(page, label).click()),
  )

const isMuted = (page: Page) =>
  Effect.map(setting(page, 'Sound'), pressed =>
    pressed === 'false' ? 'true' : 'false',
  )
const isMusicOn = (page: Page) => setting(page, 'Music')

const legacyInStorage = (page: Page) =>
  attempt(() => page.evaluate(key => localStorage.getItem(key), SAVE_KEY))

const opfsFiles = (page: Page) =>
  attempt(() =>
    page.evaluate(
      // NOTE: runs in the page, where OPFS answers only by promises.
      // @effect-diagnostics-next-line asyncFunction:off
      async () => {
        const found: Array<string> = []
        // NOTE: runs in the page, where OPFS answers only by promises.
        // @effect-diagnostics-next-line asyncFunction:off
        const walk = async (dir: FileSystemDirectoryHandle, path: string) => {
          for await (const [name, handle] of dir.entries()) {
            if (handle instanceof FileSystemDirectoryHandle) {
              await walk(handle, `${path}${name}/`)
            } else {
              found.push(`${path}${name}`)
            }
          }
        }
        await walk(await navigator.storage.getDirectory(), '/')
        return found
      },
    ),
  )

const both = <E>(
  first: Effect.Effect<boolean, E>,
  second: Effect.Effect<boolean, E>,
) =>
  Effect.flatMap(first, isFirst => (isFirst ? second : Effect.succeed(false)))

runAudit(
  Effect.gen(function* () {
    const base = yield* Config.String('BASE').pipe(Config.withDefault(GAME))
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

    const browser = yield* openBrowser
    const context = yield* attempt(() =>
      browser.newContext({
        viewport: { width: 1280, height: 720 },
      }),
    )
    const errors: Array<string> = []
    const watch = (page: Page, name: string) => {
      page.on('pageerror', error => errors.push(`${name}: ${error.message}`))
      page.on('response', response => {
        if (
          response.status() >= 400 &&
          !String.endsWith('favicon.ico')(response.url())
        ) {
          errors.push(`${name}: ${response.status()} ${response.url()}`)
        }
      })
    }

    const page = yield* attempt(() => context.newPage())
    watch(page, 'tab 1')
    yield* attempt(() => page.goto(new URL('version.json', base).href))
    const legacyJson = encodeJson(Schema.Json)(legacySave)
    yield* attempt(() =>
      page.evaluate(([key, json]) => localStorage.setItem(key, json), [
        SAVE_KEY,
        legacyJson,
      ] as const),
    )

    const started = yield* Clock.currentTimeMillis
    yield* attempt(() => page.goto(base))
    yield* awaitGame(page)
    const loaded = yield* Clock.currentTimeMillis
    yield* Console.log(`     the first load took ${loaded - started} ms`)
    yield* wait(300)
    const imported = yield* isMuted(page)
    yield* check(
      imported === 'true',
      'the localStorage save is imported on the first load',
    )
    const files = yield* opfsFiles(page)
    yield* check(
      Array.some(files, file => String.startsWith('/.munch-manor/')(file)),
      `the database lives in OPFS (${files.length} files under /.munch-manor/)`,
    )

    yield* attempt(() =>
      page.evaluate(key => localStorage.removeItem(key), SAVE_KEY),
    )
    yield* flip(page, 'Sound')
    yield* flip(page, 'Music')
    yield* wait(600)
    const soundBack = yield* isMuted(page)
    yield* check(soundBack === 'false', 'the sound goes back on')
    const musicOff = yield* isMusicOn(page)
    yield* check(musicOff === 'false', 'the music goes off')
    const untouched = yield* legacyInStorage(page)
    yield* check(
      untouched === null,
      'the change is not written to localStorage',
    )

    yield* attempt(() => page.reload())
    yield* awaitGame(page)
    yield* wait(300)
    const cameBack = yield* both(
      Effect.map(isMuted(page), muted => muted === 'false'),
      Effect.map(isMusicOn(page), music => music === 'false'),
    )
    yield* check(cameBack, 'after a reload both settings came back from SQLite')

    const second = yield* attempt(() => context.newPage())
    watch(second, 'tab 2')
    yield* attempt(() => second.goto(base))
    yield* awaitGame(second)
    yield* wait(300)
    const secondMusic = yield* isMusicOn(second)
    yield* check(
      secondMusic === 'false',
      'a second tab reads the save through the leader',
    )
    yield* flip(second, 'Sound')
    yield* wait(600)
    const secondMuted = yield* isMuted(second)
    yield* check(secondMuted === 'true', 'the second tab mutes')

    yield* attempt(() => page.close())
    yield* wait(1500)
    yield* flip(second, 'Music')
    yield* wait(800)
    const musicOn = yield* isMusicOn(second)
    yield* check(
      musicOn === 'true',
      'the second tab turns the music on after the leader closed',
    )

    yield* attempt(() => second.reload())
    yield* awaitGame(second)
    yield* wait(300)
    const bothChanges = yield* both(
      Effect.map(isMuted(second), muted => muted === 'true'),
      Effect.map(isMusicOn(second), music => music === 'true'),
    )
    yield* check(
      bothChanges,
      'after the leader closed, a reload reads both changes from the second tab',
    )

    const third = yield* attempt(() => context.newPage())
    watch(third, 'tab 3')
    yield* Effect.all(
      [attempt(() => third.goto(base)), attempt(() => second.reload())],
      { concurrency: 'unbounded' },
    )
    yield* Effect.all([awaitGame(third), awaitGame(second)], {
      concurrency: 'unbounded',
    })
    yield* wait(300)
    const wholeSave = yield* both(
      Effect.map(isMuted(third), muted => muted === 'true'),
      Effect.map(isMuted(second), muted => muted === 'true'),
    )
    yield* check(wholeSave, 'two tabs loading at once both read the whole save')
    const neverWritten = yield* legacyInStorage(third)
    yield* check(
      neverWritten === null,
      'localStorage was never written while OPFS worked',
    )
    yield* check(
      errors.length === 0,
      `no page errors${errors.length > 0 ? `: ${Array.join(errors, ' | ')}` : ''}`,
    )

    yield* attempt(() => browser.close())
    if (failures.length > 0) {
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
    }
  }),
)
