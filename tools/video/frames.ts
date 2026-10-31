import { Array, Data, Effect, FileSystem, Option, Path, pipe } from 'effect'
import type { Browser, Page } from 'playwright-core'

import { textPixels } from '../../src/font'
import {
  harnessQuery,
  harnessUrl,
  waitForReady,
  whenSettled,
} from '../audit/lib'
import {
  type CameraKey,
  type Caption,
  type Format,
  type Shot,
  encodePlan,
} from './shotList'
import { type ClipCue, decodeAudioLog } from './soundtrackRequest'

// THE DIRECTOR'S CAMERA
//
// NOTE: plays one shot through the built audit harness with `director` on
// (tools/audit/harness/director.ts): the page holds still, and this asks
// it for `step` ticks at a time, then captures the picture. CSS
// animations, such as the shop's MINE! stamp, are paused and set to the
// shot's own clock before each capture, so they too land on the same
// picture every render. Captions, fades, the director's own camera, the
// split screen of devices, and dissolves are drawn over the page, so a
// captured frame is the finished frame.

class PageFailed extends Data.TaggedError('PageFailed')<{
  readonly step: string
  readonly reason: string
}> {}

const onPage = <A>(step: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: error => new PageFailed({ step, reason: String(error) }),
  })

// NOTE: the CSS size and device scale of each format. Both are six screen
// pixels a game pixel: the landscape screen is 320x180 game pixels, and an
// upright phone's portrait screen is 180 wide and, at 9:16, 320 tall.
const VIEWPORTS: Readonly<
  Record<
    Format,
    { width: number; height: number; scale: number; isTouch: boolean }
  >
> = {
  '16:9': { width: 960, height: 540, scale: 2, isTouch: false },
  '9:16': { width: 360, height: 640, scale: 3, isTouch: true },
}

// NOTE: screen pixels a game pixel, in both formats.
const UNIT = 6

export const outputSize = (format: Format) => {
  const viewport = VIEWPORTS[format]
  return {
    width: viewport.width * viewport.scale,
    height: viewport.height * viewport.scale,
  }
}

// NOTE: what the game draws over the world: the HUD's canvas layer, the
// thumb area, and the HTML controls, for a clean plate.
const HIDE_HUD_CSS = `
.overlay-layer-canvas, .thumb-area, .touch-stick, .ghost-sticks,
.hud-tap-frame, .gun-cluster, .corner-buttons, .debut-card {
  visibility: hidden !important;
}`

export const openShotPage = (browser: Browser, format: Format) =>
  onPage('open the page', async () => {
    const viewport = VIEWPORTS[format]
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.scale,
      ...(viewport.isTouch ? { isMobile: true, hasTouch: true } : {}),
    })
    const page = await context.newPage()
    // NOTE: the page's animation clock stands still, so an animation
    // starts and stays at its first frame until `holdAnimations` sets it
    // to the shot's clock, however long a capture takes. A short one can
    // no longer run out unseen between two captures.
    const devTools = await context.newCDPSession(page)
    await devTools.send('Animation.enable')
    await devTools.send('Animation.setPlaybackRate', { playbackRate: 0 })
    return page
  })

// CAPTIONS

// NOTE: each font pixel is as many screen pixels as the largest of these
// that fits the caption in nine tenths of the frame's width.
const CAPTION_PIXEL_SIZES = [18, 12, 9, 6]
const CAPTION_COLORS: Readonly<Record<string, string>> = {
  Plain: '#f4f1de',
  Prompt: '#ffe066',
  Title: '#9be36a',
  Victory: '#ffd23f',
  Defeat: '#ff4a4f',
  Fresh: '#ff8a3d',
}
const CAPTION_OUTLINE = '#140c10'
const CAPTION_SHADOW = '#2a1418'

export type CaptionDrawing = Readonly<{
  rows: ReadonlyArray<string>
  pixel: number
  color: string
  place: 'Top' | 'Middle' | 'Bottom'
  top: number | undefined
}>

const captionDrawing = (
  caption: Caption,
  frameWidth: number,
): CaptionDrawing => {
  const rows = textPixels(caption.text.toUpperCase())
  const width = (rows[0]?.length ?? 0) + 2
  const pixel =
    caption.pixel ??
    pipe(
      Array.findFirst(
        CAPTION_PIXEL_SIZES,
        size => width * size <= frameWidth * 0.9,
      ),
      Option.getOrElse(() => 6),
    )
  return {
    rows,
    pixel,
    color: CAPTION_COLORS[caption.tone ?? 'Prompt'] ?? '#ffe066',
    place: caption.place ?? 'Top',
    top: caption.top,
  }
}

// THE OVERLAY

type Box = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

// NOTE: a laptop or a phone in the split screen: its outside and its
// screen, in frame pixels, the part of the page's picture its screen shows,
// and the size of one of its pixels.
type Device = Readonly<{
  kind: 'Laptop' | 'Phone'
  outer: Box
  screen: Box
  crop: Box
  unit: number
}>

// NOTE: what the overlay draws under the captions, over the page: the
// page's own picture through the director's camera (a crop of it, scaled
// back up to the frame), the split screen of devices, or a finished frame
// from disk. It is plain data for code that runs in the page, where
// Effect's Match is not loaded, hence `kind` and a switch.
type Base =
  | Readonly<{ kind: 'Camera'; src: string; crop: Box }>
  | Readonly<{ kind: 'Devices'; src: string; devices: ReadonlyArray<Device> }>
  | Readonly<{ kind: 'Frame'; src: string }>

export type Overlay = Readonly<{
  base: Base | undefined
  captions: ReadonlyArray<CaptionDrawing>
  // NOTE: a finished frame laid over everything at this opacity, for a
  // dissolve between two shots.
  dissolve: Readonly<{ src: string; alpha: number }> | undefined
  fade: number
  outline: string
  shadow: string
}>

// NOTE: runs in the page: the overlay with the shot's base, captions,
// dissolve, and fade.
const paintOverlay = async ({
  base,
  captions,
  dissolve,
  fade,
  outline,
  shadow,
}: Overlay) => {
  const ratio = window.devicePixelRatio
  const id = 'director-overlay'
  const existing = document.getElementById(id)
  const canvas =
    existing instanceof HTMLCanvasElement
      ? existing
      : document.body.appendChild(document.createElement('canvas'))
  canvas.id = id
  canvas.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;image-rendering:pixelated'
  canvas.width = Math.round(window.innerWidth * ratio)
  canvas.height = Math.round(window.innerHeight * ratio)
  const context = canvas.getContext('2d')
  if (context === null) {
    return
  }
  const load = async (src: string): Promise<HTMLImageElement> => {
    const image = new Image()
    image.src = src
    await image.decode()
    return image
  }
  const fill = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => {
    context.fillStyle = color
    context.fillRect(x, y, width, height)
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (base !== undefined) {
    const picture = await load(base.src)
    switch (base.kind) {
      case 'Camera': {
        context.imageSmoothingEnabled = false
        context.drawImage(
          picture,
          base.crop.x,
          base.crop.y,
          base.crop.width,
          base.crop.height,
          0,
          0,
          canvas.width,
          canvas.height,
        )
        break
      }
      case 'Frame': {
        context.drawImage(picture, 0, 0, canvas.width, canvas.height)
        break
      }
      case 'Devices': {
        // NOTE: the split screen: a dark room with a purple glow, and each
        // device drawn in blocks of its unit, its screen showing its crop.
        fill(0, 0, canvas.width, canvas.height, '#160b24')
        const rings: ReadonlyArray<readonly [number, string]> = [
          [0.56, '#1d0f30'],
          [0.42, '#24123a'],
          [0.3, '#2b1749'],
        ]
        for (const [share, color] of rings) {
          context.fillStyle = color
          context.beginPath()
          context.arc(
            canvas.width / 2,
            canvas.height / 2,
            Math.max(canvas.width, canvas.height) * share,
            0,
            Math.PI * 2,
          )
          context.fill()
        }
        for (const device of base.devices) {
          const { outer, screen, unit } = device
          const middle = outer.x + outer.width / 2
          fill(
            outer.x - unit,
            outer.y - unit,
            outer.width + unit * 2,
            outer.height + unit * 2,
            outline,
          )
          fill(outer.x, outer.y, outer.width, outer.height, '#3a3550')
          fill(outer.x, outer.y, outer.width, unit, '#5a5478')
          if (device.kind === 'Laptop') {
            const lipY = outer.y + outer.height + unit
            fill(
              outer.x - unit * 8,
              lipY,
              outer.width + unit * 16,
              unit * 4,
              outline,
            )
            fill(
              outer.x - unit * 7,
              lipY + unit,
              outer.width + unit * 14,
              unit * 2,
              '#5a5478',
            )
            fill(middle - unit * 10, lipY + unit, unit * 20, unit, '#3a3550')
          } else {
            fill(middle - unit * 3, outer.y + unit * 2, unit * 6, unit, outline)
            fill(
              middle - unit * 4,
              outer.y + outer.height - unit * 3,
              unit * 8,
              unit,
              '#5a5478',
            )
          }
          fill(
            screen.x - unit,
            screen.y - unit,
            screen.width + unit * 2,
            screen.height + unit * 2,
            outline,
          )
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          context.drawImage(
            picture,
            device.crop.x,
            device.crop.y,
            device.crop.width,
            device.crop.height,
            screen.x,
            screen.y,
            screen.width,
            screen.height,
          )
          // NOTE: a glint across the glass.
          fill(
            screen.x + unit * 2,
            screen.y + unit * 2,
            unit * 3,
            unit,
            'rgba(255, 255, 255, 0.35)',
          )
        }
        break
      }
    }
  }
  for (const caption of captions) {
    const { rows, pixel } = caption
    const columns = rows[0]?.length ?? 0
    const left =
      Math.round((canvas.width - columns * pixel) / 2 / pixel) * pixel
    const textHeight = rows.length * pixel
    const top =
      caption.top !== undefined
        ? Math.round(canvas.height * caption.top)
        : caption.place === 'Top'
          ? Math.round(canvas.height * 0.08)
          : caption.place === 'Bottom'
            ? Math.round(canvas.height * 0.86 - textHeight)
            : Math.round((canvas.height - textHeight) / 2)
    const filled = (x: number, y: number) => rows[y]?.[x] === '#'
    const box = (x: number, y: number, color: string) =>
      fill(left + x * pixel, top + y * pixel, pixel, pixel, color)
    // NOTE: a one pixel outline around the letters, and under it a one
    // pixel drop shadow, as the game's own text has.
    const inked = (x: number, y: number) =>
      filled(x, y) ||
      filled(x - 1, y) ||
      filled(x + 1, y) ||
      filled(x, y - 1) ||
      filled(x, y + 1)
    for (let y = -1; y <= rows.length + 1; y++) {
      for (let x = -1; x <= columns; x++) {
        if (inked(x, y)) {
          box(x, y, outline)
        } else if (inked(x, y - 1)) {
          box(x, y, shadow)
        }
      }
    }
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < columns; x++) {
        if (filled(x, y)) {
          box(x, y, caption.color)
        }
      }
    }
  }
  if (dissolve !== undefined) {
    const picture = await load(dissolve.src)
    context.globalAlpha = dissolve.alpha
    context.drawImage(picture, 0, 0, canvas.width, canvas.height)
    context.globalAlpha = 1
  }
  if (fade > 0) {
    fill(0, 0, canvas.width, canvas.height, `rgba(0, 0, 0, ${fade})`)
  }
}

const EMPTY_OVERLAY: Overlay = {
  base: undefined,
  captions: [],
  dissolve: undefined,
  fade: 0,
  outline: CAPTION_OUTLINE,
  shadow: CAPTION_SHADOW,
}

// NOTE: runs in the page: every CSS animation paused at its age on the
// shot's clock, counted from the tick it was first seen on.
const holdAnimations = (tick: number) => {
  const starts = (window.__animationStarts ??= new WeakMap())
  for (const animation of document.getAnimations()) {
    if (!starts.has(animation)) {
      starts.set(animation, tick)
    }
    animation.pause()
    animation.currentTime =
      ((tick - (starts.get(animation) ?? tick)) * 1000) / 60
  }
}

const pngSource = (png: Uint8Array): string =>
  `data:image/png;base64,${Buffer.from(png).toString('base64')}`

// THE CAMERA

// NOTE: eases in and out between two keys.
const smooth = (share: number): number => share * share * (3 - 2 * share)

const cameraAt = (
  keys: ReadonlyArray<CameraKey>,
  tick: number,
): Option.Option<Pick<CameraKey, 'zoom' | 'x' | 'y'>> => {
  const before = Array.findLast(keys, key => key.at <= tick)
  const after = Array.findFirst(keys, key => key.at > tick)
  if (Option.isNone(before)) {
    return after
  }
  if (Option.isNone(after)) {
    return before
  }
  const from = before.value
  const to = after.value
  const share = smooth((tick - from.at) / (to.at - from.at))
  const blend = (a: number, b: number) => a + (b - a) * share
  return Option.some({
    zoom: blend(from.zoom, to.zoom),
    x: blend(from.x, to.x),
    y: blend(from.y, to.y),
  })
}

const clampBox = (box: Box, within: Box): Box => ({
  ...box,
  x: Math.min(Math.max(box.x, within.x), within.x + within.width - box.width),
  y: Math.min(Math.max(box.y, within.y), within.y + within.height - box.height),
})

// NOTE: the part of the frame the camera sees, in frame pixels, or none
// when it sees all of it.
const cameraCrop = (shot: Shot, format: Format, tick: number) => {
  const size = outputSize(format)
  return pipe(
    cameraAt(shot.camera ?? [], tick),
    Option.filter(camera => camera.zoom > 1),
    Option.map(camera => {
      const width = size.width / camera.zoom
      const height = size.height / camera.zoom
      return clampBox(
        {
          x: camera.x * UNIT - width / 2,
          y: camera.y * UNIT - height / 2,
          width,
          height,
        },
        { x: 0, y: 0, ...size },
      )
    }),
  )
}

// THE SPLIT SCREEN

type Seats = Readonly<{
  world: Box
  seats: ReadonlyArray<Readonly<{ slot: number; x: number; y: number }>>
}>

type Frame = Readonly<{ outer: Box; screen: Box }>

// NOTE: a laptop and three phones held upright, in game pixels of the
// screen: side by side on a wide frame, the laptop over the phones on an
// upright one.
const DEVICE_LAYOUTS: Readonly<
  Record<Format, { laptop: Frame; phones: ReadonlyArray<Frame> }>
> = {
  '16:9': {
    laptop: {
      outer: { x: 8, y: 44, width: 176, height: 102 },
      screen: { x: 12, y: 48, width: 168, height: 94 },
    },
    phones: [192, 234, 276].map((x, index) => ({
      outer: { x, y: index === 1 ? 46 : 56, width: 38, height: 76 },
      screen: {
        x: x + 3,
        y: (index === 1 ? 46 : 56) + 6,
        width: 32,
        height: 64,
      },
    })),
  },
  '9:16': {
    laptop: {
      outer: { x: 6, y: 62, width: 168, height: 96 },
      screen: { x: 10, y: 66, width: 160, height: 88 },
    },
    phones: [10, 65, 120].map((x, index) => ({
      outer: { x, y: index === 1 ? 186 : 196, width: 50, height: 100 },
      screen: {
        x: x + 3,
        y: (index === 1 ? 186 : 196) + 6,
        width: 44,
        height: 88,
      },
    })),
  },
}

const scaled = (box: Box): Box => ({
  x: box.x * UNIT,
  y: box.y * UNIT,
  width: box.width * UNIT,
  height: box.height * UNIT,
})

// NOTE: the laptop shows the whole room; each phone shows one teammate's
// own camera, close on them, at the same moment.
const PHONE_REACH = 0.8

const devicesOf = (format: Format, { world, seats }: Seats) => {
  const layout = DEVICE_LAYOUTS[format]
  const room = scaled(world)
  const laptopScreen = scaled(layout.laptop.screen)
  const aspect = laptopScreen.width / laptopScreen.height
  const laptopWidth = Math.min(room.width, room.height * aspect)
  const laptopCrop = {
    x: room.x + (room.width - laptopWidth) / 2,
    y: room.y + (room.height - laptopWidth / aspect) / 2,
    width: laptopWidth,
    height: laptopWidth / aspect,
  }
  const mates = seats.length > 1 ? seats.slice(1) : seats
  const phones = Array.map(layout.phones, (phone, index): Device => {
    const screen = scaled(phone.screen)
    const seat = mates[index % Math.max(1, mates.length)] ?? {
      x: world.x + world.width / 2,
      y: world.y + world.height / 2,
    }
    const height = room.height * PHONE_REACH
    const width = (height * screen.width) / screen.height
    return {
      kind: 'Phone',
      outer: scaled(phone.outer),
      screen,
      crop: clampBox(
        {
          x: seat.x * UNIT - width / 2,
          y: seat.y * UNIT - height / 2,
          width,
          height,
        },
        room,
      ),
      unit: UNIT,
    }
  })
  return [
    {
      kind: 'Laptop',
      outer: scaled(layout.laptop.outer),
      screen: laptopScreen,
      crop: laptopCrop,
      unit: UNIT,
    } satisfies Device,
    ...phones,
  ]
}

// THE SHOT

type ShotFrames = Readonly<{
  // NOTE: the clip frame each captured tick starts on, by tick.
  frameOfTick: ReadonlyMap<number, number>
  frameCount: number
  cues: ReadonlyArray<ClipCue>
}>

const FADE_STEPS = 16

const fadeAt = (shot: Shot, tick: number): number => {
  const fadeIn = shot.fadeIn ?? 0
  const fadeOut = shot.fadeOut ?? 0
  const shown = tick - (shot.skip ?? 0)
  const before = fadeIn > 0 ? Math.max(0, 1 - shown / fadeIn) : 0
  const after = fadeOut > 0 ? Math.max(0, 1 - (shot.ticks - tick) / fadeOut) : 0
  return Math.round(Math.max(before, after) * FADE_STEPS) / FADE_STEPS
}

const repeatsAt = (shot: Shot, tick: number): number =>
  pipe(
    shot.slowMotion ?? [],
    Array.filter(slow => slow.from <= tick && tick < slow.to),
    Array.reduce(1, (most, slow) => Math.max(most, slow.repeat)),
  ) +
  pipe(
    shot.holds ?? [],
    Array.filter(hold => hold.at === tick),
    Array.reduce(0, (sum, hold) => sum + hold.frames),
  )

const directedTick = (page: Page) =>
  onPage('read the tick', () => page.evaluate(() => window.__directedTick))

const awaitTick = (page: Page, tick: number) =>
  onPage(`reach tick ${tick}`, () =>
    page.waitForFunction(expected => window.__directedTick === expected, tick, {
      polling: 'raf',
      timeout: 60_000,
    }),
  )

const capture = (page: Page, overlay: Overlay) =>
  onPage('capture', async () => {
    await page.evaluate(paintOverlay, overlay)
    return page.screenshot({ type: 'png', caret: 'hide', animations: 'allow' })
  })

// NOTE: writes a frame in place of whatever is there. A repeated frame is a
// hard link, so the old name is removed first, not written through.
const replaceFrame = (file: string, png: Uint8Array) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(file).pipe(Effect.ignore)
    yield* fs.writeFile(file, png)
  })

const readSource = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return pngSource(yield* fs.readFile(file))
  })

// NOTE: plays a shot and writes its frames from `firstFrame` on, as
// frame-000000.png and up in `dir`. The frames before `overlapEnd` are the
// last shot's end: this shot's start dissolves over them, frame by frame.
export const captureShot = (
  page: Page,
  shot: Shot,
  format: Format,
  dir: string,
  firstFrame: number,
  overlapEnd: number,
  log: (line: string) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const isTouch = VIEWPORTS[format].isTouch
    const query = harnessQuery(
      shot.scene,
      'director',
      'nodev',
      isTouch ? 'device=touch' : '',
    )
    yield* onPage('load the scene', async () => {
      await page.goto(harnessUrl(query))
      await waitForReady(page)
    })
    if (shot.hideHud === true) {
      yield* onPage('hide the HUD', () =>
        page.addStyleTag({ content: HIDE_HUD_CSS }).then(() => undefined),
      )
    }
    const hudTop = shot.hudTop
    if (hudTop !== undefined) {
      // NOTE: the HUD's canvas cut off above a share of the screen, so the
      // band at the top (wave, counts, money) no longer covers what is
      // under it, while what the HUD draws lower, such as the fridge's
      // reel, stays.
      const css = `.overlay-layer-canvas { clip-path: inset(${hudTop * 100}% 0 0 0); }`
      yield* onPage('cut the HUD band', () =>
        page.addStyleTag({ content: css }).then(() => undefined),
      )
    }
    const plan = yield* encodePlan({
      segments: shot.segments ?? [],
      taps: shot.taps ?? [],
      cards: shot.cards ?? [],
      ...(shot.lobby === undefined ? {} : { lobby: shot.lobby }),
      ...(shot.coop === undefined ? {} : { coop: shot.coop }),
    })
    yield* onPage('start the shot', () =>
      page.evaluate(json => window.__director.start(json), plan),
    )
    yield* awaitTick(page, 0)
    const skip = shot.skip ?? 0
    if (skip > 0) {
      // NOTE: what is animating already, such as a co-op room's countdown
      // or a dialog opening, starts on the shot's clock at tick 0, so the
      // skipped ticks play it out too.
      yield* onPage('start the animations', async () => {
        await whenSettled(page)
        await page.evaluate(holdAnimations, 0)
      })
      yield* onPage('skip', () =>
        page.evaluate(n => window.__director.step(n), skip),
      )
      yield* awaitTick(page, skip)
    }
    const frameWidth = outputSize(format).width
    const step = shot.step ?? 1
    const overlap = overlapEnd - firstFrame
    const frameOfTick = new Map<number, number>()
    let frame = firstFrame
    for (let tick = skip; tick < shot.ticks; tick += step) {
      for (const click of Array.filter(
        shot.clicks ?? [],
        planned => planned.at === tick,
      )) {
        yield* onPage(`click ${click.selector}`, () =>
          page.click(click.selector, { timeout: 5_000 }),
        )
      }
      if (tick > skip) {
        yield* onPage('step', () =>
          page.evaluate(n => window.__director.step(n), step),
        )
        yield* awaitTick(page, tick)
      }
      yield* onPage('settle', async () => {
        await whenSettled(page)
        await page.evaluate(holdAnimations, tick)
      })
      const isDevices =
        shot.devices !== undefined &&
        shot.devices.from <= tick &&
        tick < shot.devices.to
      const maybeCrop = cameraCrop(shot, format, tick)
      // NOTE: the camera and the split screen draw from the page's own
      // picture, taken first with the overlay clear.
      let base: Base | undefined = undefined
      if (isDevices) {
        const src = pngSource(yield* capture(page, EMPTY_OVERLAY))
        const seats: Seats = yield* onPage('read the seats', () =>
          page.evaluate(() => window.__director.seats()),
        )
        base = { kind: 'Devices', src, devices: devicesOf(format, seats) }
      } else if (Option.isSome(maybeCrop)) {
        const src = pngSource(yield* capture(page, EMPTY_OVERLAY))
        base = { kind: 'Camera', src, crop: maybeCrop.value }
      }
      const overlay: Overlay = {
        ...EMPTY_OVERLAY,
        base,
        captions: Array.map(
          Array.filter(
            shot.captions ?? [],
            caption => caption.from <= tick && tick < caption.to,
          ),
          caption => captionDrawing(caption, frameWidth),
        ),
        fade: fadeAt(shot, tick),
      }
      frameOfTick.set(tick, frame)
      let maybeFirst: Option.Option<string> = Option.none()
      for (let copy = 0; copy < repeatsAt(shot, tick); copy++) {
        const file = path.join(dir, frameName(frame))
        if (frame < overlapEnd) {
          // NOTE: the last shot's frame on top, thinning out to nothing.
          const alpha = 1 - (frame - firstFrame + 1) / (overlap + 1)
          const under = yield* readSource(file)
          const png = yield* capture(page, {
            ...overlay,
            dissolve: { src: under, alpha },
          })
          yield* replaceFrame(file, png)
        } else if (Option.isSome(maybeFirst)) {
          yield* fs.link(maybeFirst.value, file)
        } else {
          yield* replaceFrame(file, yield* capture(page, overlay))
          maybeFirst = Option.some(file)
        }
        frame++
      }
      if (tick % 120 === 0) {
        yield* log(`  ${shot.name}: tick ${tick} of ${shot.ticks}`)
      }
    }
    const reached = yield* directedTick(page)
    const audio = yield* decodeAudioLog(
      yield* onPage('read the audio log', () =>
        page.evaluate((): unknown => window.__director.audio()),
      ),
    )
    // NOTE: a sound logged on tick t is heard on the first frame that
    // shows the world after it.
    const captured = [...frameOfTick.entries()]
    // NOTE: what played in the skipped ticks is not heard.
    const heard = Array.filter(audio, cue => cue.tick >= skip - 1)
    const cues = Array.getSomes(
      Array.map(heard, cue =>
        Option.map(
          Array.findFirst(captured, ([tick]) => tick > cue.tick),
          ([, at]): ClipCue => ({ frame: at, cue }),
        ),
      ),
    )
    yield* log(
      `  ${shot.name}: ${frame - firstFrame} frames, ${cues.length} sounds, tick ${reached ?? 0}`,
    )
    return {
      frameOfTick,
      frameCount: frame - firstFrame,
      cues,
    } satisfies ShotFrames
  })

// THE LOOP

// NOTE: the clip's last `overlap` frames dissolve into its first ones, so
// the clip plays round with no seam: frame i shows the head's frame i with
// the tail's frame i over it, thinning out. The tail is then dropped.
export const loopFrames = (
  page: Page,
  dir: string,
  frames: number,
  overlap: number,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tailStart = frames - overlap
    for (let index = 0; index < overlap; index++) {
      const head = path.join(dir, frameName(index))
      const tail = path.join(dir, frameName(tailStart + index))
      const png = yield* capture(page, {
        ...EMPTY_OVERLAY,
        base: { kind: 'Frame', src: yield* readSource(head) },
        dissolve: {
          src: yield* readSource(tail),
          alpha: 1 - (index + 1) / (overlap + 1),
        },
      })
      yield* replaceFrame(head, png)
    }
    for (let index = tailStart; index < frames; index++) {
      yield* fs.remove(path.join(dir, frameName(index)))
    }
    return tailStart
  })

export const frameName = (frame: number): string =>
  `frame-${String(frame).padStart(6, '0')}.png`
