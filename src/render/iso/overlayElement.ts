import { Effect, Option, Predicate, Schema } from 'effect'

import { Html } from '@effect/ui/html'

import { toBrowserError } from '#shared/describeError.ts'

import type { OverlayPicture, OverlayScene } from './overlayScene.ts'

const TAG = 'munch-overlay'

const isOverlayPicture = (value: unknown): value is OverlayPicture =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'width') &&
  Predicate.hasProperty(value, 'height') &&
  Predicate.hasProperty(value, 'shapes')

export const overlayElement = Html.customElement({
  tag: TAG,
  properties: { picture: Schema.declare(isOverlayPicture) },
})

const startScene = (
  host: HTMLElement,
  picture: OverlayPicture,
  onLoaded: () => void,
) =>
  Effect.gen(function* () {
    const { createOverlayScene } = yield* Effect.tryPromise({
      try: () => import('./overlayScene.ts'),
      catch: toBrowserError,
    })
    return yield* createOverlayScene({ host, picture, onLoaded })
  })

const overlayElementClass = () =>
  class OverlayElement extends HTMLElement {
    private latest: Option.Option<OverlayPicture> = Option.none()
    private scene: Option.Option<OverlayScene> = Option.none()
    private isOnPage = false
    private isStarting = false
    private isDrawDue = false

    get picture(): OverlayPicture | undefined {
      return Option.getOrUndefined(this.latest)
    }

    set picture(next: OverlayPicture) {
      this.latest = Option.some(next)
      if (this.isOnPage) {
        this.start()
      }
      this.draw()
    }

    connectedCallback(): void {
      this.isOnPage = true
      this.start()
    }

    private start(): void {
      if (
        Option.isSome(this.scene) ||
        this.isStarting ||
        Option.isNone(this.latest)
      ) {
        return
      }
      this.isStarting = true
      Effect.runFork(
        startScene(this, this.latest.value, () => {
          this.drawSoon()
        }).pipe(
          Effect.match({
            onSuccess: scene => {
              this.isStarting = false
              if (this.isOnPage) {
                this.scene = Option.some(scene)
                this.draw()
              } else {
                scene.destroy()
              }
            },
            onFailure: () => {
              this.isStarting = false
            },
          }),
        ),
      )
    }

    disconnectedCallback(): void {
      this.isOnPage = false
      const scene = this.scene
      this.scene = Option.none()
      Option.map(scene, live => {
        live.destroy()
      })
    }

    private drawSoon(): void {
      if (this.isDrawDue) {
        return
      }
      this.isDrawDue = true
      requestAnimationFrame(() => {
        this.isDrawDue = false
        this.draw()
      })
    }

    private draw(): void {
      if (Option.isNone(this.scene) || Option.isNone(this.latest)) {
        return
      }
      this.scene.value.paint(this.latest.value)
      this.dataset['drawn'] = 'true'
    }
  }

export const defineOverlayElement = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, overlayElementClass())
  }
}
