// The sprites in HTML pass: How to play, the pause screen, the Munchopedia,
// and the home corner with the update gift and the install tile, on a
// desktop, a landscape phone, and an upright phone, as
// `s38-<TAG>-<viewport>-<scene>.png`. The harness is a production build, so
// every sprite is a region of the prebuilt atlas. It exits with 1 on an
// <img> or a CSS background that shows a whole atlas sheet (an <img> cannot
// crop, so it must take `standaloneSource`), a control card frame wider
// than a sprite, a gift under 48 px, or a gift tag that runs into the
// corner's other buttons or off the screen.
//   TAG=after bun run heavy -- bun tools/audit/shots38.ts
import { Console, Effect, String } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  SHOTS_DIR,
  type Viewport,
  auditTag,
  closePage,
  deviceQuery,
  finish,
  gotoScene,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  pressButton,
  settleAnimations,
  shotViewports,
} from './lib'
import { type AuditFailed, attempt } from './page'

const fromHand = (card: RegExp) => (page: Page, viewport: Viewport) =>
  Effect.gen(function* () {
    yield* pressButton(page, viewport, /^More:/)
    yield* attempt(() =>
      page.locator('dialog[open]').first().waitFor({ state: 'visible' }),
    )
    yield* pressButton(page, viewport, card)
    yield* attempt(() =>
      page.locator('dialog[open] .panel').first().waitFor({ state: 'visible' }),
    )
  })

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page, viewport: Viewport) => Effect.Effect<void, AuditFailed>
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'howto', query: '', act: fromHand(/^How to play:/) },
  { name: 'pause', query: 'wave=3&start=wave&phase=paused' },
  {
    name: 'munchopedia',
    query: 'seen=all&kills=Shambler:12,Runner:3',
    act: fromHand(/^Munchopedia:/),
  },
  { name: 'gift', query: 'newer=next' },
  { name: 'gift-install', query: 'newer=next&install' },
]

// NOTE: a hint icon frame is at most a few dozen pixels; the atlas sheet is
// 1024 wide.
const MAX_SPRITE_PX = 128

// NOTE: runs in the page, which has no Effect: plain loops, so no native
// Array or String method is left for the Effect rules to flag.
const readSprites = (maxPx: number) => {
  // NOTE: the files the canvases draw sprites from: any URL the page loaded
  // that is not a data URL and names a sprite sheet.
  const isSheet = (url: string) =>
    // NOTE: runs in the page, where effect's String is not loaded.
    // @effect-diagnostics-next-line preferEffectString:off
    !url.startsWith('data:') && /sprite/i.test(url)
  const bad: Array<string> = []
  const images = document.querySelectorAll('img')
  for (const image of images) {
    if (isSheet(image.currentSrc || image.src)) {
      bad.push(`<img class="${image.className}"> ${image.src}`)
    }
  }
  for (const element of document.querySelectorAll('*')) {
    const background = getComputedStyle(element).backgroundImage
    // NOTE: runs in the page, where effect's String is not loaded.
    // @effect-diagnostics-next-line preferEffectString:off
    for (const match of background.matchAll(/url\("?([^")]+)"?\)/g)) {
      const url = match[1] ?? ''
      if (isSheet(url)) {
        bad.push(`${element.className} background ${url}`)
      }
    }
  }
  for (const frame of document.querySelectorAll('.help-card-frame')) {
    if (
      frame instanceof HTMLImageElement &&
      (frame.naturalWidth === 0 || frame.naturalWidth > maxPx)
    ) {
      bad.push(`frame ${frame.naturalWidth} px wide`)
    }
  }
  return { bad, images: images.length }
}

const checkSprites = (page: Page, where: string, problems: Array<string>) =>
  Effect.gen(function* () {
    const found = yield* attempt(() =>
      page.evaluate(readSprites, MAX_SPRITE_PX),
    )
    for (const line of found.bad) {
      problems.push(`${where}: ${line}`)
    }
    return found.images
  })

type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

// NOTE: runs in the page, which has no Effect: a plain loop.
const readGift = () => {
  const boxOf = (element: Element | null) => {
    if (element === null) {
      return null
    }
    const { left, top, right, bottom } = element.getBoundingClientRect()
    return { left, top, right, bottom }
  }
  const gift = document.querySelector('.home-gift')
  const others: Array<{ name: string; box: Box | null }> = []
  for (const element of document.querySelectorAll(
    '.home-corner-button:not(.home-gift), .home-install',
  )) {
    others.push({
      name: element.getAttribute('aria-label') ?? element.className,
      box: boxOf(element),
    })
  }
  return {
    label: gift?.getAttribute('aria-label') ?? null,
    gift: boxOf(gift),
    tag: boxOf(document.querySelector('.gift-tag')),
    others,
  }
}

const checkGift = (
  page: Page,
  viewport: Viewport,
  where: string,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    const found = yield* attempt(() => page.evaluate(readGift))
    const { gift, tag } = found
    if (gift === null || tag === null) {
      problems.push(`${where}: no gift or no tag`)
      return
    }
    if (found.label !== 'Update ready: tap to get it') {
      problems.push(`${where}: the gift is labeled ${found.label}`)
    }
    const width = gift.right - gift.left
    const height = gift.bottom - gift.top
    if (width < 48 || height < 48) {
      problems.push(`${where}: the gift is ${width}x${height}`)
    }
    const overlaps = (first: Box, second: Box) =>
      first.left < second.right &&
      second.left < first.right &&
      first.top < second.bottom &&
      second.top < first.bottom
    for (const other of found.others) {
      if (other.box !== null && overlaps(tag, other.box)) {
        problems.push(`${where}: the gift tag runs into ${other.name}`)
      }
      if (other.box !== null && overlaps(gift, other.box)) {
        problems.push(`${where}: the gift runs into ${other.name}`)
      }
    }
    if (
      tag.left < 0 ||
      tag.top < 0 ||
      tag.right > viewport.width ||
      tag.bottom > viewport.height
    ) {
      problems.push(`${where}: the gift tag runs off the screen`)
    }
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const problems: Array<string> = []
    const browser = yield* openBrowser
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const where = `${viewport.name} ${scene.name}`
        const page = yield* openPage(browser, viewport)
        yield* gotoScene(page, harnessUrl(scene.query, deviceQuery(viewport)))
        if (scene.act !== undefined) {
          yield* scene.act(page, viewport)
        }
        yield* settleAnimations(page)
        const images = yield* checkSprites(page, where, problems)
        if (String.startsWith('gift')(scene.name)) {
          yield* checkGift(page, viewport, where, problems)
        }
        // NOTE: a card's frames take turns through a looping animation,
        // which a shot with animations off holds at a hidden frame, so these
        // run.
        yield* attempt(() =>
          page.screenshot({
            path: `${SHOTS_DIR}/s38-${tag}-${viewport.name}-${scene.name}.png`,
          }),
        )
        yield* Console.log(`${where}: ${images} images`)
        yield* closePage(page)
      }
    }
    yield* finish(
      problems,
      'Every sprite in HTML is its own image, and the gift fits.',
    )
  }),
)
