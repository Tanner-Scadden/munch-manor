import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Schema,
  String,
} from 'effect'
import type { Page } from 'playwright-core'

// The pixel pass: every menu and overlay screen on a 1280x720 desktop, an
// 844x390 phone on its side, and a 390x844 phone held upright, as
// `<viewport>-<scene>.png` in PIXEL_SHOTS (default /tmp/pixel-shots), with
// `<viewport>-<scene>.json` beside each: the computed style of every control
// on screen (size, font, border, radius, shadow, colors) and of every image
// (drawn size against its own, and its image-rendering), so a report can
// compare like with like across screens. It exits with 1 on an image drawn at
// a non-integer scale of its pixels without `pixelated` rendering.
//   bun run heavy -- --shared bun tools/audit/shotsPixel.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import * as NodeServices from '@effect/platform-node/NodeServices'

import { encodeJson } from '../json'
import { runHarnessAuditWith } from './harnessServer'
import {
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shotViewports,
  wait,
} from './lib'
import { attempt, evaluateAs } from './page'

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'
const LOBBY_PICK = `${LEARNED}&rank=4200&calling=Handyman&newsseen`
const FOUND =
  'bests&kills=Shambler:1203,Runner:140,Tank:12,Exploder:9,Thrower:3,Boss:2&opened=Shambler,Tank'
const SHOP = `wave=5&money=180&gun=smg&tier=1&px=270&py=142&${LEARNED}`
const BREAK = `wave=4&seen=all&break=open&breakMs=20000&money=60&difficulty=Normal&${LEARNED}`
const MIXED =
  'rank=600&bones=140&spent=50&bought=Fez,shirt:Midnight,print:Skull&hat=Fez'

type Scene = Readonly<{
  name: string
  query: string
  // NOTE: selectors clicked in order, each after the last has settled.
  open?: ReadonlyArray<string>
}>

const MANOR = '#home-manor'
const PLAY = '#home-play'
const tab = (index: number) => `dialog[open] [role=tab] >> nth=${index}`
const SHOP_TABS = Array.map([0, 1, 2], tab)

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: '' },
  { name: 'home-found', query: `${FOUND}&newentries=Thrower&newsseen` },
  { name: 'home-corner', query: `${FOUND}&fit=full&install&newer&newsseen` },
  { name: 'home-guide', query: 'fit=home', open: ['#home-install'] },
  { name: 'greet', query: 'greet' },
  { name: 'hand', query: 'support', open: [MANOR] },
  { name: 'settings-home', query: '', open: ['#home-settings'] },
  { name: 'howto', query: '', open: [MANOR, '#hand-card-howtoplay'] },
  { name: 'difficulty', query: 'ask', open: [PLAY] },
  { name: 'lobby', query: LOBBY_PICK, open: [PLAY] },
  { name: 'lobby-mods', query: `${LOBBY_PICK}&mods=10`, open: [PLAY] },
  {
    name: 'lobby-bots-all',
    query: `${LOBBY_PICK}&lobbybots=1&mods=15`,
    open: [PLAY],
  },
  { name: 'lobby-hero', query: LOBBY_PICK, open: [PLAY, '#lobby-hero'] },
  { name: 'coop-tile', query: 'coop=tile' },
  { name: 'coop-hub', query: 'coop=hub' },
  { name: 'coop-problem', query: 'coop=problem' },
  { name: 'coop-code', query: 'coop=code' },
  { name: 'coop-asking', query: 'coop=asking' },
  { name: 'coop-queue', query: 'coop=queue' },
  { name: 'coop-offer', query: 'coop=offer' },
  { name: 'coop-lobby', query: 'coop=lobby' },
  { name: 'coop-host', query: 'coop=host&mods=10' },
  { name: 'coop-guest', query: 'coop=guest&mods=9' },
  { name: 'coop-heroes', query: 'coop=heroes' },
  { name: 'coop-name', query: 'coop=name' },
  { name: 'coop-ready', query: 'coop=ready' },
  { name: 'coop-result', query: 'coop=result' },
  { name: 'profile-look', query: 'profile=look&rank=1850' },
  {
    name: 'profile-look-hair',
    query: 'profile=look&looksection=Hair&rank=1850',
  },
  {
    name: 'profile-look-outfit',
    query: `profile=look&looksection=Outfit&${MIXED}`,
  },
  {
    name: 'profile-look-gear',
    query: `profile=look&looksection=Gear&${MIXED}`,
  },
  { name: 'profile-name', query: 'profile=name&name=Dr. Chomp&rank=1850' },
  {
    name: 'profile-account',
    query: 'profile=account&sync=synced&devices=2',
  },
  {
    name: 'profile-account-link',
    query: 'profile=account&sync=synced&link=entering',
  },
  { name: 'profile-settings', query: 'profile=settings&fit=full&rotate' },
  { name: 'munch-empty', query: '', open: [MANOR, '#hand-card-munchopedia'] },
  { name: 'munch', query: FOUND, open: [MANOR, '#hand-card-munchopedia'] },
  {
    name: 'munch-entry',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile >> nth=0'],
  },
  {
    name: 'munch-shop',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', 'button[aria-label^="Shop,"]'],
  },
  { name: 'whats-new', query: '', open: [MANOR, '#hand-card-whatsnew'] },
  { name: 'shop-guns', query: SHOP },
  ...Array.map(SHOP_TABS.slice(1), (selector, index): Scene => ({
    name: `shop-tab${index + 1}`,
    query: SHOP,
    open: [selector],
  })),
  { name: 'shop-broke', query: 'wave=3&money=12&gun=shotgun&px=270&py=142' },
  { name: 'shop-help', query: SHOP, open: ['button[aria-label="Shop guide"]'] },
  {
    name: 'shop-guide-traps',
    query: SHOP,
    open: ['button[aria-label="Shop guide"]', 'role=button[name="Traps"]'],
  },
  {
    name: 'shop-guide-fridge',
    query: `${SHOP}&prizes=Cooker,Freeze`,
    open: ['button[aria-label="Shop guide"]', 'role=button[name="Fridge"]'],
  },
  {
    name: 'hud-wave',
    query: `wave=4&seen=all&start=wave&elapsed=6000&crowd=8&gun=smg&money=45&${LEARNED}`,
  },
  { name: 'hud-break', query: BREAK },
  { name: 'hud-nudge', query: `${BREAK}&idle=16000` },
  {
    name: 'hud-coop-break',
    query: `${BREAK}&party=2&mates=ready&idle=4000`,
  },
  {
    name: 'hud-portrait-touch',
    query: `wave=4&seen=all&start=wave&elapsed=6000&crowd=8&${LEARNED}`,
  },
  { name: 'pause', query: 'wave=3&seen=all&start=wave&phase=paused' },
  {
    name: 'end-loss',
    query: `wave=5&phase=gameover&stats&rank=162&rankgain=129`,
  },
  {
    name: 'end-win',
    query: `wave=10&phase=escaped&stats&difficulty=Hard&rank=1900&rankgain=537&mods=14`,
  },
  {
    name: 'end-crew',
    query: `wave=10&phase=escaped&stats&party=3&rank=2400&rankgain=204&mods=9`,
  },
  { name: 'coop-card', query: 'coop=card' },
  { name: 'coop-card-won', query: 'coop=cardwon' },
]

const Control = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
)
const Metrics = Schema.Struct({
  controls: Schema.Array(Control),
  images: Schema.Array(Control),
})

const measure = (page: Page) =>
  evaluateAs(page, Metrics, () => {
    // NOTE: this runs in the page, where Effect's modules are not loaded, so
    // it reads the elements with plain loops and the page's own String.
    const round = (value: number) => Math.round(value * 100) / 100
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }
    // NOTE: runs in the page, where Effect's String is not loaded.
    // @effect-diagnostics-next-line preferEffectString:off
    const cut = (text: string, length: number) => text.slice(0, length)
    // NOTE: runs in the page, where Effect's String is not loaded.
    // @effect-diagnostics-next-line preferEffectString:off
    const lower = (text: string) => text.toLowerCase()
    // NOTE: runs in the page, where Effect's String is not loaded.
    // @effect-diagnostics-next-line preferEffectString:off
    const trimmed = (text: string) => text.trim()
    // NOTE: runs in the page, where Effect's String is not loaded.
    // @effect-diagnostics-next-line preferEffectString:off
    const isPercent = (text: string): boolean => text.endsWith('%')
    // NOTE: the first layer of a CSS list, split into its words, keeping a
    // function's own spaces and commas (`max(3px, round(down, 100%, 3px))`).
    const firstLayer = (text: string) => {
      const words: Array<string> = []
      let word = ''
      let depth = 0
      for (const letter of text) {
        if (depth === 0 && letter === ',') {
          break
        }
        if (depth === 0 && letter === ' ') {
          if (word !== '') {
            words.push(word)
          }
          word = ''
          continue
        }
        depth += letter === '(' ? 1 : letter === ')' ? -1 : 0
        word += letter
      }
      if (word !== '') {
        words.push(word)
      }
      return words
    }
    // NOTE: a CSS length as the browser lays it out, in CSS px before any
    // transform, with any percent taken of `space`: a probe box `space` wide
    // inside `host` (so it reads the host's own custom properties) holds a
    // child whose width is the length.
    const probe = document.createElement('div')
    const probeChild = document.createElement('div')
    probe.style.cssText =
      'position:absolute;left:0;top:0;height:0;visibility:hidden;pointer-events:none'
    probeChild.style.height = '1px'
    probe.append(probeChild)
    const laidOut = (text: string, space: number, host: Element) => {
      host.append(probe)
      probe.style.width = `${space}px`
      probeChild.style.width = ''
      probeChild.style.width = text
      const width =
        probeChild.style.width === ''
          ? Number.NaN
          : Number.parseFloat(getComputedStyle(probeChild).width)
      probe.remove()
      return width
    }
    const controls: Array<Record<string, string | number | boolean>> = []
    for (const element of document.querySelectorAll(
      'button, [role=tab], input, dialog[open], .coop, .profile, .panel, h1, h2, h3',
    )) {
      if (!visible(element)) {
        continue
      }
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const dialog = element.closest('dialog')
      const inset =
        dialog === null
          ? { right: 0, top: 0 }
          : {
              right: dialog.getBoundingClientRect().right - box.right,
              top: box.top - dialog.getBoundingClientRect().top,
            }
      controls.push({
        tag: lower(element.tagName),
        cls: cut(element.className.toString(), 60),
        label: cut(
          trimmed(element.getAttribute('aria-label') ?? element.textContent),
          28,
        ),
        x: round(box.left),
        y: round(box.top),
        w: round(box.width),
        h: round(box.height),
        fromDialogRight: round(inset.right),
        fromDialogTop: round(inset.top),
        fontSize: style.fontSize,
        fontFamily: cut(style.fontFamily, 30),
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        color: style.color,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        shadow: cut(style.boxShadow, 80),
        padding: style.padding,
        opacity: style.opacity,
        cursor: style.cursor,
        isDisabled: element instanceof HTMLButtonElement && element.disabled,
      })
    }
    // NOTE: every piece of pixel art on screen: an <img>, a canvas, or an
    // element whose background is a picture (the SVG icons carry their size
    // in their viewBox). For each, how many device pixels one art pixel
    // takes across and down, and where its top left corner lands in device
    // pixels. Art is whole only when both scales are whole numbers and the
    // corner sits on a device pixel: anything else draws its pixels 2 and 3
    // device pixels wide by turns, or blurs them.
    const ratio = window.devicePixelRatio
    // NOTE: an element's border box in CSS px before any transform, to the
    // fraction (offsetWidth and clientWidth round to whole CSS px, which
    // reads a 35.875 px box as a transform of 0.9965), or null for a box
    // with no layout width of its own (an inline element).
    const borderBoxOf = (element: Element) => {
      const style = getComputedStyle(element)
      const side = (name: string) =>
        Number.parseFloat(style.getPropertyValue(name)) || 0
      const extra =
        style.boxSizing === 'border-box'
          ? { width: 0, height: 0 }
          : {
              width:
                side('padding-left') +
                side('padding-right') +
                side('border-left-width') +
                side('border-right-width'),
              height:
                side('padding-top') +
                side('padding-bottom') +
                side('border-top-width') +
                side('border-bottom-width'),
            }
      const width = Number.parseFloat(style.width) + extra.width
      const height = Number.parseFloat(style.height) + extra.height
      return Number.isFinite(width) && width > 0 && Number.isFinite(height)
        ? { width, height }
        : null
    }
    // NOTE: how much a transform on the way up scales the element: art in
    // a box that is scaling (a card dealt in, a menu dimmed behind a
    // dialog) is uneven only while it moves.
    const zoomOf = (element: Element) => {
      const own = borderBoxOf(element)
      return own === null
        ? 1
        : element.getBoundingClientRect().width / own.width
    }
    const fraction = (value: number) =>
      round(Math.abs(value - Math.round(value)))
    const images: Array<Record<string, string | number | boolean>> = []
    const pushArt = (
      element: Element,
      kind: string,
      art: { width: number; height: number },
      drawn: { left: number; top: number; width: number; height: number },
    ) => {
      if (art.width <= 0 || art.height <= 0 || drawn.width <= 0) {
        return
      }
      const scaleX = (drawn.width * ratio) / art.width
      const scaleY = (drawn.height * ratio) / art.height
      const parentClass = element.parentElement?.className.toString()
      const zoom = zoomOf(element)
      images.push({
        tag: lower(element.tagName),
        kind,
        zoom: round(zoom),
        cls: cut(element.className.toString(), 60),
        parent: parentClass === undefined ? '' : cut(parentClass, 40),
        label: cut(
          trimmed(
            element.closest('[aria-label]')?.getAttribute('aria-label') ?? '',
          ),
          28,
        ),
        natural: art.width,
        artHeight: art.height,
        drawn: round(drawn.width),
        scale: round(drawn.width / art.width),
        deviceScaleX: round(scaleX),
        deviceScaleY: round(scaleY),
        offX: fraction(drawn.left * ratio),
        offY: fraction(drawn.top * ratio),
        isWhole:
          fraction(scaleX) <= 0.02 &&
          fraction(scaleY) <= 0.02 &&
          fraction(drawn.left * ratio) <= 0.05 &&
          fraction(drawn.top * ratio) <= 0.05,
        rendering: getComputedStyle(element).imageRendering,
      })
    }
    for (const element of document.querySelectorAll('img, canvas')) {
      if (!visible(element)) {
        continue
      }
      const box = element.getBoundingClientRect()
      const art =
        element instanceof HTMLImageElement
          ? { width: element.naturalWidth, height: element.naturalHeight }
          : element instanceof HTMLCanvasElement
            ? { width: element.width, height: element.height }
            : { width: 0, height: 0 }
      pushArt(element, 'image', art, box)
    }
    // NOTE: the size an SVG data URL's viewBox gives, or nothing.
    const svgSize = (url: string) => {
      const match = /viewBox=['"]0 0 ([0-9.]+) ([0-9.]+)['"]/.exec(
        decodeURIComponent(url),
      )
      return match === null
        ? null
        : { width: Number(match[1]), height: Number(match[2]) }
    }
    for (const element of document.querySelectorAll('*')) {
      if (!(element instanceof HTMLElement) || !visible(element)) {
        continue
      }
      const style = getComputedStyle(element)
      const url = /url\("?(data:image\/svg\+xml[^")]*)"?\)/.exec(
        style.backgroundImage,
      )
      const source = url?.[1]
      if (source === undefined) {
        continue
      }
      const art = svgSize(source)
      if (art === null) {
        continue
      }
      const box = element.getBoundingClientRect()
      // NOTE: a transform on the way up scales the box, and the background
      // with it; the background's room is the padding box.
      const own = borderBoxOf(element) ?? {
        width: element.offsetWidth,
        height: element.offsetHeight,
      }
      const zoom = own.width > 0 ? box.width / own.width : 1
      const borders = {
        left: Number.parseFloat(style.borderLeftWidth),
        right: Number.parseFloat(style.borderRightWidth),
        top: Number.parseFloat(style.borderTopWidth),
        bottom: Number.parseFloat(style.borderBottomWidth),
      }
      const borderLeft = borders.left * zoom
      const borderTop = borders.top * zoom
      // NOTE: with background-origin: content-box the room leaves out the
      // padding.
      const isContent = style.backgroundOrigin === 'content-box'
      const padding = (side: string) =>
        isContent ? Number.parseFloat(style.getPropertyValue(side)) : 0
      const padLeft = padding('padding-left') * zoom
      const padTop = padding('padding-top') * zoom
      const room = {
        width:
          (own.width -
            borders.left -
            borders.right -
            padding('padding-left') -
            padding('padding-right')) *
          zoom,
        height:
          (own.height -
            borders.top -
            borders.bottom -
            padding('padding-top') -
            padding('padding-bottom')) *
          zoom,
      }
      // NOTE: a background length laid out in the room it has, scaled by the
      // zoom, or null for auto.
      const length = (text: string | undefined, space: number) =>
        text === undefined || text === 'auto'
          ? null
          : laidOut(text, space / zoom, element) * zoom
      const [sizeX, sizeY] = firstLayer(style.backgroundSize)
      const aspect = art.width / art.height
      const fit =
        sizeX === 'contain' || sizeX === 'cover'
          ? (sizeX === 'cover' ? Math.max : Math.min)(
              room.width / art.width,
              room.height / art.height,
            )
          : null
      const givenX = length(sizeX, room.width)
      const givenY = length(sizeY, room.height)
      const width =
        fit !== null
          ? art.width * fit
          : (givenX ??
            (givenY === null
              ? Math.min(room.width, room.height * aspect)
              : givenY * aspect))
      const height =
        fit !== null ? art.height * fit : (givenY ?? width / aspect)
      const [positionX, positionY] = firstLayer(style.backgroundPosition)
      const place = (text: string | undefined, free: number) =>
        text === undefined
          ? 0
          : isPercent(text)
            ? (Number.parseFloat(text) / 100) * free
            : Number.parseFloat(text) * zoom
      pushArt(element, 'background', art, {
        left:
          box.left +
          borderLeft +
          padLeft +
          place(positionX, room.width - width),
        top:
          box.top + borderTop + padTop + place(positionY, room.height - height),
        width,
        height,
      })
    }
    return { controls, images }
  })

const problems: Array<string> = []

runHarnessAuditWith(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* Config.String('PIXEL_SHOTS').pipe(
      Config.withDefault('/tmp/pixel-shots'),
    )
    yield* fs.makeDirectory(dir, { recursive: true })
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=72'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const where = `${viewport.name}-${scene.name}`
        // NOTE: a scene whose query the harness refuses, or whose control is
        // missing, is a problem to report, never a reason to stop the pass.
        yield* Effect.gen(function* () {
          const page = yield* pages.open(
            viewport,
            harnessQuery(scene.query, deviceQuery(viewport)),
          )
          for (const selector of scene.open ?? []) {
            yield* attempt(() =>
              page.locator(selector).first().click({ timeout: 5000 }),
            )
            yield* settleAnimations(page)
          }
          yield* wait(250)
          yield* settleAnimations(page)
          const metrics = yield* measure(page)
          for (const image of metrics.images) {
            const scale = Number(image['scale'])
            if (
              image['tag'] === 'img' &&
              scale > 0 &&
              Math.abs(scale - Math.round(scale)) > 0.02 &&
              image['rendering'] !== 'pixelated' &&
              image['rendering'] !== 'crisp-edges'
            ) {
              problems.push(
                `${where}: ${globalThis.String(image['cls'])} drawn at ${scale}x, ${globalThis.String(image['rendering'])}`,
              )
            }
          }
          yield* fs.writeFileString(
            `${dir}/${where}.json`,
            `${encodeJson(Metrics, 2)(metrics)}\n`,
          )
          yield* attempt(() =>
            page.screenshot({
              path: `${dir}/${where}.png`,
              animations: 'disabled',
            }),
          )
          yield* Console.log(`shot ${where}`)
          pages.release(page)
        }).pipe(
          Effect.catch(error =>
            Effect.sync(() => {
              problems.push(
                `${where}: ${String.split('\n')(globalThis.String(error))[0]}`,
              )
            }),
          ),
        )
      }
    }
    yield* pages.close
    yield* finish(problems, 'The pixel pass found no problems.')
  }),
  NodeServices.layer,
)
