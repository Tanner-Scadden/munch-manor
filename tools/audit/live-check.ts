import { Console, Effect, Schema } from 'effect'

import { encodeJson } from '../json'
import { openBrowser, runAudit, wait } from './lib'
import { attempt } from './page'

// Loads a deployed copy of the game in headless Chrome and checks that it
// boots: the page answers 200, the game's two canvases mount (the 3D world
// and the overlay), and nothing throws.
// Usage: bun live-check.ts [url]

const URL = process.argv[2] ?? 'https://munchmanor.com/'
const EXPECTED_CANVASES = 2

const Report = Schema.Struct({
  url: Schema.String,
  status: Schema.Finite,
  canvases: Schema.Finite,
  errors: Schema.Array(Schema.String),
})

runAudit(
  Effect.gen(function* () {
    const browser = yield* openBrowser
    const page = yield* attempt(() =>
      browser.newPage({ viewport: { width: 1280, height: 720 } }),
    )

    const errors: Array<string> = []
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
    page.on('console', message =>
      message.type() === 'error'
        ? errors.push(`console: ${message.text()}`)
        : undefined,
    )
    page.on('requestfailed', request =>
      errors.push(
        `requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
      ),
    )

    const response = yield* attempt(() =>
      page.goto(URL, { waitUntil: 'networkidle' }),
    )
    yield* wait(1500)
    const canvases = yield* attempt(() =>
      page.locator('canvas.world-canvas, canvas.overlay-layer-canvas').count(),
    )
    yield* attempt(() => browser.close())

    const status = response?.status() ?? 0
    const isOk =
      status === 200 && canvases === EXPECTED_CANVASES && errors.length === 0

    yield* Console.log(
      encodeJson(Report, 2)({ url: URL, status, canvases, errors }),
    )
    yield* Effect.sync(() => {
      process.exitCode = isOk ? 0 : 1
    })
  }),
)
