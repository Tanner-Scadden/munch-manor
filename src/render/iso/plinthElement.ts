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

const PLINTH_FRAME_MS = 1000 / 20

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

export const definePlinthElement = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, plinthElementClass())
  }
}
