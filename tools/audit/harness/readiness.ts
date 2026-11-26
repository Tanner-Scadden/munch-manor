import { Effect } from 'effect'

const created = new Set<HTMLImageElement>()

Object.defineProperty(document, 'createElement', {
  value: function (
    this: Document,
    tagName: string,
    options?: ElementCreationOptions,
  ): HTMLElement {
    const element = Document.prototype.createElement.call(
      this,
      tagName,
      options,
    )
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

const isWorldDrawn = (): boolean =>
  document.querySelector('munch-world:not([data-drawn])') === null

export const nextFrame = Effect.callback<void>(resume => {
  requestAnimationFrame(() => resume(Effect.void))
})

const twoFrames = Effect.andThen(nextFrame, nextFrame)

const SETTLE_LIMIT_MS = 10_000

const pageNow = Effect.sync(() => performance.now())

const decoded = (image: HTMLImageElement) =>
  Effect.promise(() => image.decode().catch(() => undefined))

export const settle = (isHeld: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    const startedAt = yield* pageNow
    yield* Effect.promise(() => document.fonts.ready)
    yield* twoFrames
    while ((yield* pageNow) - startedAt < SETTLE_LIMIT_MS) {
      const pending = pendingImages()
      if (pending.length === 0 && isWorldDrawn() && isHeld()) {
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
