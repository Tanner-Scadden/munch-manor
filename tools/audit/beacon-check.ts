import {
  Console,
  Duration,
  Effect,
  Fiber,
  Option,
  Schema,
  String,
} from 'effect'

import { encodeJson } from '../json'
import { desktop, openBrowser, runAudit, wait } from './lib'
import { attempt } from './page'

// Plays the shortest real run end against a deployed copy, from the menu to a
// quit through the pause MENU, and checks that the game posts its run summary
// to the analytics Worker and the Worker accepts it. Run it through the heavy guard:
//
//   bun run heavy -- bun tools/audit/beacon-check.ts https://munch-manor-pr-42.tanner-scadden.workers.dev/

const RUNS_PATH = '/api/runs'
const BEACON_WAIT_MS = 10_000
const ACCEPTED = 202

const Report = Schema.Struct({
  url: Schema.String,
  beaconUrl: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Finite),
  errors: Schema.Array(Schema.String),
})

const check = (url: string) =>
  Effect.gen(function* () {
    const browser = yield* openBrowser
    const page = yield* desktop(browser)

    const errors: Array<string> = []
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))

    // NOTE: listens from here on, with no time limit of its own: the race
    // below gives up after BEACON_WAIT_MS, and a page that closes first never
    // posted.
    const beacon = yield* attempt(() =>
      page.waitForRequest(
        request =>
          request.method() === 'POST' &&
          String.endsWith(RUNS_PATH)(request.url()),
        { timeout: 0 },
      ),
    ).pipe(Effect.option, Effect.forkScoped)

    yield* attempt(() => page.goto(url, { waitUntil: 'networkidle' }))
    yield* wait(2000)
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

    const request = yield* Fiber.join(beacon).pipe(
      Effect.timeoutOption(Duration.millis(BEACON_WAIT_MS)),
      Effect.map(Option.flatten),
    )

    // NOTE: Chrome does not hand a beacon's Blob body to Playwright, so the
    // check reads the Worker's answer. `bun tools/analytics/report.ts` shows
    // the row.
    const response = yield* Option.match(request, {
      onNone: () => Effect.succeed(null),
      onSome: sent => attempt(() => sent.response()),
    })

    yield* attempt(() => browser.close())

    const isOk = response?.status() === ACCEPTED && errors.length === 0

    yield* Console.log(
      encodeJson(
        Report,
        2,
      )({
        url,
        beaconUrl: Option.getOrUndefined(
          Option.map(request, sent => sent.url()),
        ),
        status: response?.status(),
        errors,
      }),
    )
    yield* Effect.sync(() => {
      process.exitCode = isOk ? 0 : 1
    })
  })

const URL = process.argv[2]

runAudit(
  URL === undefined
    ? Effect.andThen(
        Console.error('Usage: bun beacon-check.ts <site url>'),
        Effect.sync(() => {
          process.exitCode = 2
        }),
      )
    : check(URL),
)
