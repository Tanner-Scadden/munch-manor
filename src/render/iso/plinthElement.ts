// The plinth's element, `<munch-plinth>`: one sprite carved into blocks,
// turning slowly on its lit plinth (plinth.ts). The view sets its one
// property, `pose`, each render; the element asks the world's renderer on
// the page for the picture (element.ts), so the page keeps one WebGL
// context, and shows it on a small canvas of one canvas pixel to a game
// pixel, stretched by a whole number of device pixels, pixelated. The
// canvas takes the picture as an ImageBitmap (its `bitmaprenderer` context,
// handed the bitmap whole), never a 2D context.

import { Effect, Option } from 'effect'

import { Html } from '@effect/ui/html'

import { toBrowserError } from '../../shared/describeError'
import { drawPlinthOnWorld } from './element'
import { type PlinthPose, PlinthPoseSchema } from './plinthPose'

const TAG = 'munch-plinth'

export const plinthElement = Html.customElement({
  tag: TAG,
  properties: { pose: PlinthPoseSchema },
})

// NOTE: at most this many plinth frames a second: the turn steps a few
// times a second and the candle flickers, so more would be wasted work.
const PLINTH_FRAME_MS = 1000 / 20

// NOTE: mutable on purpose: a custom element is the browser's own mutable
// object, holding its canvas while it is on the page. Built only when it is
// defined, since HTMLElement exists only in a browser.
const plinthElementClass = () =>
  class PlinthElement extends HTMLElement {
    private latest: Option.Option<PlinthPose> = Option.none()
    private lastMs = Number.NEGATIVE_INFINITY
    private lastSrc = ''
    private drawn = 0
    private readonly canvas = document.createElement('canvas')
    private readonly reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    )

    get pose(): PlinthPose | undefined {
      return Option.getOrUndefined(this.latest)
    }

    set pose(next: PlinthPose) {
      this.latest = Option.some(next)
      const since = next.clockMs - this.lastMs
      const isSameSprite = next.image.src === this.lastSrc
      if (isSameSprite && since >= 0 && since < PLINTH_FRAME_MS) {
        return
      }
      if (this.draw(next)) {
        this.lastMs = next.clockMs
        this.lastSrc = next.image.src
      }
    }

    connectedCallback(): void {
      this.canvas.classList.add('plinth-canvas')
      if (this.canvas.parentNode !== this) {
        this.append(this.canvas)
      }
      Option.map(this.latest, pose => this.draw(pose))
    }

    // NOTE: whether a picture was drawn; none before the world's renderer
    // is in, or while the sprite loads, and the next render tries again.
    private draw(pose: PlinthPose): boolean {
      const picture = drawPlinthOnWorld({
        pose,
        isStill: this.reducedMotion.matches,
      })
      if (Option.isNone(picture)) {
        return false
      }
      const { pixels, size } = picture.value
      const canvas = this.canvas
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size
        canvas.height = size
      }
      // NOTE: the largest whole number of device pixels a game pixel can
      // cover inside the element's box.
      const ratio = window.devicePixelRatio
      const scale = Math.max(1, Math.floor((this.clientWidth * ratio) / size))
      canvas.style.width = `${(size * scale) / ratio}px`
      canvas.style.height = `${(size * scale) / ratio}px`
      const context = canvas.getContext('bitmaprenderer')
      if (context === null) {
        return false
      }
      const image = new ImageData(size, size)
      image.data.set(pixels.subarray(0, size * size * 4))
      // NOTE: each picture is numbered, so one whose bitmap comes in after a
      // newer one's is let go of unshown.
      this.drawn += 1
      const drawn = this.drawn
      Effect.runFork(
        Effect.tryPromise({
          try: () => createImageBitmap(image),
          catch: toBrowserError,
        }).pipe(
          Effect.match({
            onSuccess: bitmap => {
              if (drawn === this.drawn) {
                context.transferFromImageBitmap(bitmap)
                this.dataset['drawn'] = 'true'
              } else {
                bitmap.close()
              }
            },
            onFailure: () => undefined,
          }),
        ),
      )
      return true
    }
  }

// NOTE: called once by the page's entry, beside the world's element; tests
// never define it, so there the element stays a plain one that draws
// nothing.
export const definePlinthElement = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, plinthElementClass())
  }
}
