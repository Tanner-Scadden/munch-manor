// NOTE: the harness's ready signal. The entry imports this module first, so
// it runs before any game module can make an image. It keeps every image
// element the page creates, through `document.createElement('img')` (what
// Foldkit's canvas image cache uses) or `new Image()`, so the signal waits for
// whatever images the page loads, however the game builds them: data URLs, an
// atlas, or files.

import { Effect } from 'effect'

const created = new Set<HTMLImageElement>()

// NOTE: the wrappers replace the page's own through defineProperty, which
// keeps each property's attributes as an assignment would, since a plain
// function cannot take the place of createElement's overloads or Image's
// constructor in the DOM's types.
// oxlint-disable-next-line typescript/unbound-method -- called below with .call(this)
const nativeCreateElement = Document.prototype.createElement
Object.defineProperty(Document.prototype, 'createElement', {
  value: function (
    this: Document,
    tagName: string,
    options?: ElementCreationOptions,
  ): HTMLElement {
    const element = nativeCreateElement.call(this, tagName, options)
    if (element instanceof HTMLImageElement) {
      created.add(element)
    }
    return element
  },
})

const NativeImage = window.Image
function TrackedImage(width?: number, height?: number): HTMLImageElement {
  const image = new NativeImage(width, height)
  created.add(image)
  return image
}
Object.defineProperty(TrackedImage, 'prototype', {
  value: NativeImage.prototype,
})
Object.defineProperty(window, 'Image', { value: TrackedImage })

const isPending = (image: HTMLImageElement): boolean =>
  image.getAttribute('src') !== null && !image.complete

// NOTE: images that are done are dropped from the set, so each check walks
// only the few still loading.
const pendingImages = (): ReadonlyArray<HTMLImageElement> => {
  const pending: Array<HTMLImageElement> = []
  for (const image of [...created, ...globalThis.Array.from(document.images)]) {
    if (isPending(image)) {
      pending.push(image)
    } else if (image.getAttribute('src') !== null) {
      created.delete(image)
    }
  }
  return pending
}

// NOTE: waits for the next animation frame.
export const nextFrame = Effect.callback<void>(resume => {
  requestAnimationFrame(() => resume(Effect.void))
})

const twoFrames = Effect.andThen(nextFrame, nextFrame)

const SETTLE_LIMIT_MS = 10_000

// NOTE: the page's own clock, as the frame times are.
const pageNow = Effect.sync(() => performance.now())

const decoded = (image: HTMLImageElement) =>
  Effect.promise(() => image.decode().catch(() => undefined))

// NOTE: resolves once the fonts are loaded, the scene has rendered, and every
// image the page asked for has loaded and decoded, with two more frames so a
// canvas that repaints when its image arrives has painted. `isHeld` is the
// extra condition a scene needs, such as a frozen scene's last frame. It gives
// up after ten seconds, so a broken image cannot hang a script forever.
export const settle = (isHeld: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    const startedAt = yield* pageNow
    yield* Effect.promise(() => document.fonts.ready)
    yield* twoFrames
    while ((yield* pageNow) - startedAt < SETTLE_LIMIT_MS) {
      const pending = pendingImages()
      if (pending.length === 0 && isHeld()) {
        yield* twoFrames
        if (pendingImages().length === 0) {
          return
        }
      }
      yield* Effect.forEach(pending, decoded, {
        concurrency: 'unbounded',
        discard: true,
      })
      yield* nextFrame
    }
  })
