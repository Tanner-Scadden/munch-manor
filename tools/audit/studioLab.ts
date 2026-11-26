import { Config, Effect, Schema, String } from 'effect'

import {
  auditTag,
  closePage,
  openBrowser,
  openPage,
  runAudit,
  shot,
  wait,
} from './lib'
import { attempt, decodedFrom, evaluateAs, failWith } from './page'

const STUDIO = Config.String('STUDIO').pipe(
  Config.withDefault('http://localhost:5173/tools/studio/'),
)

const VIEWPORT = {
  name: 'studio',
  width: 1600,
  height: 1100,
  scale: 1,
  isPhone: false,
}

const SETTLE_MS = 1500
const LIVE_SETTLE_MS = 6000

const Brightness = Schema.Finite

const readBrightness = (selector: string): number => {
  const canvas = document.querySelector(selector)
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0) {
    return -1
  }
  const gl = document.createElement('canvas').getContext('webgl2')
  if (gl === null) {
    return -1
  }
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  const framebuffer = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  )
  const data = new Uint8Array(canvas.width * canvas.height * 4)
  gl.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  )
  gl.deleteFramebuffer(framebuffer)
  gl.deleteTexture(texture)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  let sum = 0
  for (let index = 0; index < data.length; index += 4) {
    sum += (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0)
  }
  return sum / (data.length / 4) / 3
}

runAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const studio = yield* STUDIO
    const browser = yield* openBrowser
    const page = yield* openPage(browser, VIEWPORT)
    const click = (selector: string) =>
      attempt(() => page.locator(selector).first().click())
    const brightness = (selector: string) =>
      decodedFrom(Brightness, () => page.evaluate(readBrightness, selector))
    yield* attempt(() => page.goto(studio))
    yield* attempt(() => page.waitForSelector('.card'))
    yield* click('.card')
    yield* click('button.segment:has-text("Blocks")')
    yield* attempt(() => page.waitForSelector('.stage3d-canvas'))
    yield* wait(SETTLE_MS * 2)
    yield* shot(page, `studio-${tag}-stage-break`)
    for (const preset of ['Candle', 'Chandelier', 'Flashlight', 'Lightning']) {
      yield* click(`button.segment:has-text("${preset}")`)
      yield* wait(SETTLE_MS)
      yield* shot(page, `studio-${tag}-stage-${String.toLowerCase(preset)}`)
    }
    yield* click('button.segment:has-text("Break")')

    const box = yield* attempt(() =>
      page.locator('.stage3d-marks').boundingBox(),
    )
    if (box === null) {
      return yield* failWith('the stage has no box')
    }
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    yield* attempt(() => page.mouse.move(middle.x, middle.y))
    yield* attempt(() => page.mouse.down())
    yield* attempt(() =>
      page.mouse.move(middle.x + 160, middle.y - 30, { steps: 8 }),
    )
    yield* attempt(() => page.mouse.up())
    yield* wait(SETTLE_MS)
    yield* shot(page, `studio-${tag}-stage-turned`)
    yield* click('button:has-text("Game camera")')
    yield* wait(SETTLE_MS)

    yield* attempt(() => page.mouse.click(middle.x, middle.y))
    yield* wait(SETTLE_MS)
    const pin = yield* evaluateAs(
      page,
      Schema.String,
      () => document.querySelector('.inspector')?.textContent ?? '',
    )
    if (!String.includes('Pinned a spot')(pin)) {
      return yield* failWith('a press on a block pinned nothing')
    }
    yield* shot(page, `studio-${tag}-stage-pinned`)

    yield* click('button:has-text("Light lab")')
    yield* wait(SETTLE_MS)
    yield* click('details.lab-group > summary:text-is("Look")')
    yield* click('details.lab-group > summary:text-is("Dining")')
    const before = yield* brightness('.stage-shot')
    yield* attempt(() => page.locator('[id="lab-LOOK.ambient"]').fill('0.3'))
    yield* attempt(() =>
      page.locator('[id="lab-LOOK.rooms.Dining.light"]').fill('#ff4040'),
    )
    yield* wait(SETTLE_MS)
    const after = yield* brightness('.stage-shot')
    yield* Effect.log(`stage brightness ${before} -> ${after}`)
    if (Math.abs(after - before) < 1) {
      return yield* failWith('the lab slider did not change the stage')
    }
    yield* shot(page, `studio-${tag}-lab-stage`)

    yield* attempt(() =>
      page.locator('textarea').first().fill('Moodier dining room, please.'),
    )
    yield* click('button:has-text("Propose these")')
    yield* attempt(() =>
      page.waitForSelector('button:has-text("Sent")', { timeout: 10000 }),
    )
    yield* shot(page, `studio-${tag}-lab-proposed`)

    yield* click('button:has-text("Rooms")')
    yield* attempt(() => page.waitForSelector('.live-frame'))
    yield* wait(LIVE_SETTLE_MS)
    const liveTuned = yield* brightness('.live-shot')
    yield* shot(page, `studio-${tag}-lab-live-tuned`)
    yield* click('button:has-text("Reset")')
    yield* wait(SETTLE_MS * 2)
    const liveShipped = yield* brightness('.live-shot')
    yield* shot(page, `studio-${tag}-lab-live-shipped`)
    yield* Effect.log(
      `live brightness tuned ${liveTuned}, shipped ${liveShipped}`,
    )
    if (Math.abs(liveTuned - liveShipped) < 1) {
      return yield* failWith('the lab did not change the live room')
    }
    yield* closePage(page)
  }),
)
