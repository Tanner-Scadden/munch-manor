import {
  Array,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  String,
  pipe,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import type { Browser, Page } from 'playwright-core'

import { textPixels } from '../../src/art/font'
import { smoothStep } from '../../src/world/step/geometry'
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
import {
  type Base,
  type Box,
  type CaptionDrawing,
  type Device,
  type Overlay,
  paintOverlay,
} from './inPage/paintOverlay'

class PageFailed extends Schema.TaggedError<
  PageFailed,
  { readonly brand: unique symbol }
>()('PageFailed', { step: Schema.String, reason: Schema.String }) {}

const onPage = <A>(
  step: string,
  run: () => Promise<A>,
): Effect.Effect<A, PageFailed> =>
  Effect.tryPromise({
    try: run,
    catch: error => PageFailed.make({ step, reason: globalThis.String(error) }),
  })

const VIEWPORTS: Readonly<
  Record<
    Format,
    { width: number; height: number; scale: number; isTouch: boolean }
  >
> = {
  '16:9': { width: 960, height: 540, scale: 2, isTouch: false },
  '9:16': { width: 360, height: 640, scale: 3, isTouch: true },
}

const UNIT = 6

export const outputSize = (format: Format) => {
  const viewport = VIEWPORTS[format]
  return {
    width: viewport.width * viewport.scale,
    height: viewport.height * viewport.scale,
  }
}

const HIDE_HUD_CSS = `
.overlay-layer-canvas, .thumb-area, .touch-stick, .ghost-sticks,
.hud-tap-frame, .gun-cluster, .corner-buttons, .debut-card {
  visibility: hidden !important;
}`

export const openShotPage = ({
  browser,
  format,
}: Readonly<{ browser: Browser; format: Format }>): Effect.Effect<
  Page,
  PageFailed
> =>
  Effect.gen(function* () {
    const viewport = VIEWPORTS[format]
    const context = yield* onPage('open the page', () =>
      browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.scale,
        ...(viewport.isTouch ? { isMobile: true, hasTouch: true } : {}),
      }),
    )
    const page = yield* onPage('open the page', () => context.newPage())
    const devTools = yield* onPage('open the page', () =>
      context.newCDPSession(page),
    )
    yield* onPage('open the page', () => devTools.send('Animation.enable'))
    yield* onPage('open the page', () =>
      devTools.send('Animation.setPlaybackRate', { playbackRate: 0 }),
    )
    return page
  })

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


const captionDrawing = (
  caption: Caption,
  frameWidth: number,
): CaptionDrawing => {
  const rows = textPixels(String.toUpperCase(caption.text))
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


const EMPTY_OVERLAY: Overlay = {
  base: undefined,
  captions: [],
  dissolve: undefined,
  fade: 0,
  outline: CAPTION_OUTLINE,
  shadow: CAPTION_SHADOW,
}

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
  const share = smoothStep((tick - from.at) / (to.at - from.at))
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

type Seats = Readonly<{
  world: Box
  seats: ReadonlyArray<Readonly<{ slot: number; x: number; y: number }>>
}>

type Frame = Readonly<{ outer: Box; screen: Box }>

const DEVICE_LAYOUTS: Readonly<
  Record<Format, { laptop: Frame; phones: ReadonlyArray<Frame> }>
> = {
  '16:9': {
    laptop: {
      outer: { x: 8, y: 44, width: 176, height: 102 },
      screen: { x: 12, y: 48, width: 168, height: 94 },
    },
    phones: Array.map([192, 234, 276], (x, index) => ({
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
    phones: Array.map([10, 65, 120], (x, index) => ({
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

type ShotFrames = Readonly<{
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
  Effect.andThen(
    onPage('capture', () => page.evaluate(paintOverlay, overlay)),
    onPage('capture', () =>
      page.screenshot({ type: 'png', caret: 'hide', animations: 'allow' }),
    ),
  )

const settleAt = (step: string, page: Page, tick: number) =>
  Effect.andThen(
    onPage(step, () => whenSettled(page)),
    onPage(step, () => page.evaluate(holdAnimations, tick)),
  )

const replaceFrame = (file: string, png: Uint8Array) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(file).pipe(Effect.ignore)
    yield* fs.writeFile(file, png)
  })

const readSource = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const value_1 = yield* fs.readFile(file)
    return pngSource(value_1)
  })

export const captureShot = ({
  page,
  shot,
  format,
  dir,
  firstFrame,
  overlapEnd,
  log,
}: Readonly<{
  page: Page
  shot: Shot
  format: Format
  dir: string
  firstFrame: number
  overlapEnd: number
  log: (line: string) => Effect.Effect<void>
}>): Effect.Effect<
  ShotFrames,
  PageFailed | PlatformError | Schema.SchemaError,
  FileSystem.FileSystem | Path.Path
> =>
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
    yield* onPage('load the scene', () => page.goto(harnessUrl(query)))
    yield* onPage('load the scene', () => waitForReady(page))
    if (shot.hideHud === true) {
      yield* onPage('hide the HUD', () =>
        page.addStyleTag({ content: HIDE_HUD_CSS }).then(() => undefined),
      )
    }
    const hudTop = shot.hudTop
    if (hudTop !== undefined) {
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
      yield* settleAt('start the animations', page, 0)
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
      yield* settleAt('settle', page, tick)
      const isDevices =
        shot.devices !== undefined &&
        shot.devices.from <= tick &&
        tick < shot.devices.to
      const maybeCrop = cameraCrop(shot, format, tick)
      let base: Base | undefined = undefined
      if (isDevices) {
        const value_2 = yield* capture(page, EMPTY_OVERLAY)
        const src = pngSource(value_2)
        const seats: Seats = yield* onPage('read the seats', () =>
          page.evaluate(() => window.__director.seats()),
        )
        base = { kind: 'Devices', src, devices: devicesOf(format, seats) }
      } else if (Option.isSome(maybeCrop)) {
        const value_3 = yield* capture(page, EMPTY_OVERLAY)
        const src = pngSource(value_3)
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
          const value_4 = yield* capture(page, overlay)
          yield* replaceFrame(file, value_4)
          maybeFirst = Option.some(file)
        }
        frame++
      }
      if (tick % 120 === 0) {
        yield* log(`  ${shot.name}: tick ${tick} of ${shot.ticks}`)
      }
    }
    const reached = yield* directedTick(page)
    const value_5 = yield* onPage('read the audio log', () =>
      page.evaluate((): unknown => window.__director.audio()),
    )
    const audio = yield* decodeAudioLog(value_5)
    const captured = [...frameOfTick.entries()]
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

export const loopFrames = ({
  page,
  dir,
  frames,
  overlap,
}: Readonly<{
  page: Page
  dir: string
  frames: number
  overlap: number
}>): Effect.Effect<
  number,
  PageFailed | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tailStart = frames - overlap
    for (let index = 0; index < overlap; index++) {
      const head = path.join(dir, frameName(index))
      const tail = path.join(dir, frameName(tailStart + index))
      const headSource = yield* readSource(head)
      const tailSource = yield* readSource(tail)
      const png = yield* capture(page, {
        ...EMPTY_OVERLAY,
        base: { kind: 'Frame', src: headSource },
        dissolve: {
          src: tailSource,
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
  `frame-${String.padStart(6, '0')(globalThis.String(frame))}.png`
