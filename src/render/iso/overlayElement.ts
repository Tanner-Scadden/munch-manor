// The overlay's element, `<munch-overlay>`: the HUD, the banners, and the
// cards over the world, painted by Pixi (overlayScene.ts). The view sets its
// one property, `picture`, each render; the host writes it only when it is
// not the one written last, so an overlay kept the same (src/app/layers.ts)
// costs nothing. The renderer loads in its own chunk the first time an
// element joins the page.

import { Effect, Option, Predicate, Schema } from 'effect'

import { Html } from '@effect/ui/html'

import { toBrowserError } from '../../shared/describeError'
import type { OverlayPicture, OverlayScene } from './overlayScene'

const TAG = 'munch-overlay'

const isOverlayPicture = (value: unknown): value is OverlayPicture =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'width') &&
  Predicate.hasProperty(value, 'height') &&
  Predicate.hasProperty(value, 'shapes')

// NOTE: the element's one property. The host writes it as it is, never
// decoding it, so a declared Schema only names its type.
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
      try: () => import('./overlayScene'),
      catch: toBrowserError,
    })
    return yield* createOverlayScene({ host, picture, onLoaded })
  })

// NOTE: mutable on purpose: a custom element is the browser's own mutable
// object, holding the renderer while it is on the page. Built only when it is
// defined, since HTMLElement exists only in a browser.
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

    // NOTE: started once the element is on the page with a picture, so the
    // canvas is made at the picture's size.
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

    // NOTE: the scene is let go of before it is destroyed, so a teardown that
    // throws never leaves a dead scene to paint with when the element joins
    // the page again.
    disconnectedCallback(): void {
      this.isOnPage = false
      const scene = this.scene
      this.scene = Option.none()
      Option.map(scene, live => {
        live.destroy()
      })
    }

    // NOTE: a sprite that loads asks for one more paint on the next
    // animation frame, however many load together.
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
      // NOTE: the audits wait for it before they take a picture.
      this.dataset['drawn'] = 'true'
    }
  }

// NOTE: called once by the page's entry, beside the world's element; tests
// never define it, so there the element stays a plain one that paints
// nothing.
export const defineOverlayElement = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, overlayElementClass())
  }
}
