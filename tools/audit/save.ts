import { Config, Console, Effect, String } from 'effect'

// Plays past the wave 1 practice gate in headless Chrome, reloads, and checks
// that the on-device save brought the player back with the gate open and
// the sound still muted. The save lives in SQLite now (see sqlite.ts for the
// storage itself), so this reads it back only through the game.
//   BASE=http://localhost:4173/ bun save.ts
import { GAME, desktop, openBrowser, runAudit, wait } from './lib'
import { attempt } from './page'

const GATE_NOTE = 'The wave waits until you try moving, aiming, and firing.'

runAudit(
  Effect.gen(function* () {
    const base = yield* Config.String('BASE').pipe(Config.withDefault(GAME))
    const browser = yield* openBrowser
    const page = yield* desktop(browser)
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

    const status = attempt(() =>
      page.evaluate(
        () =>
          document.querySelector('[role="status"].sr-only')?.textContent ?? '',
      ),
    )

    // NOTE: the Sound toggle in the home menu's settings shows the setting.
    const isMutedOnHome = Effect.gen(function* () {
      yield* attempt(() => page.click('#home-settings'))
      const sound = page.locator(
        '.setting-toggle:has(.setting-label:text-is("Sound"))',
      )
      const pressed = yield* attempt(() => sound.getAttribute('aria-pressed'))
      return pressed === 'false'
    })

    const awaitSplashGone = attempt(() =>
      page.waitForFunction(() => document.getElementById('splash') === null, {
        timeout: 30_000,
      }),
    )

    yield* attempt(() => page.goto(base))
    yield* awaitSplashGone
    yield* attempt(() => page.reload())
    yield* awaitSplashGone

    yield* attempt(() => page.click('.home-play'))
    yield* wait(300)
    // NOTE: a first visit asks for a difficulty before the first run.
    yield* attempt(() =>
      page.getByRole('button', { name: /^double dare/i }).click(),
    )
    yield* attempt(() => page.keyboard.press('KeyM'))
    yield* wait(300)
    const gated = yield* status
    yield* check(
      String.includes(GATE_NOTE)(gated),
      'a new player meets the practice gate',
    )

    yield* wait(2600)
    yield* attempt(() => page.keyboard.down('KeyD'))
    yield* wait(700)
    yield* attempt(() => page.keyboard.up('KeyD'))
    const canvas = yield* attempt(() =>
      page.locator('.game-surface').boundingBox(),
    )
    if (canvas !== null) {
      yield* attempt(() =>
        page.mouse.move(
          canvas.x + canvas.width * 0.8,
          canvas.y + canvas.height * 0.3,
        ),
      )
      for (const _ of [1, 2, 3, 4, 5]) {
        yield* attempt(() => page.mouse.down())
        yield* wait(120)
        yield* attempt(() => page.mouse.up())
        yield* wait(250)
      }
    }
    yield* wait(400)
    const opened = yield* status
    yield* check(
      !String.includes(GATE_NOTE)(opened),
      'moving and firing opens the gate',
    )
    yield* wait(500)

    yield* attempt(() => page.reload())
    yield* awaitSplashGone
    yield* attempt(() => page.click('.home-play'))
    yield* wait(300)
    // NOTE: a player past the practice gate gets the lobby, and START plays.
    yield* attempt(() => page.click('#lobby-start'))
    yield* wait(300)
    const reloaded = yield* status
    yield* check(
      !String.includes(GATE_NOTE)(reloaded),
      'after a reload the gate stays open',
    )
    yield* attempt(() => page.reload())
    yield* awaitSplashGone
    const isMuted = yield* isMutedOnHome
    yield* check(isMuted, 'after a reload the sound is still muted')

    yield* attempt(() => browser.close())
    if (failures.length > 0) {
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
    }
  }),
)
