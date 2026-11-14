// The world's element, `<munch-world>`: the 3D renderer on the page. The view
// sets its one property, `frame`, each render (a new IsoFrame each time), and
// the element draws that frame then and there, with no ticker of its own, so
// a frame drawn is always the Model's latest and a screenshot is the same each
// time. The renderer (PixiJS 3D) loads in its own chunk the first time an
// element joins the page.

import { Effect, Option } from 'effect'
import { CustomElement } from 'foldkit'

import { toBrowserError } from '../../shared/describeError'
import { type IsoFrame, IsoFrameSchema } from './frame'
import type { IsoScene } from './scene'
import { unsupportedNode } from './support'

const TAG = 'munch-world'

export const worldElement = CustomElement.define({
  tag: TAG,
  properties: { frame: IsoFrameSchema },
  events: {},
})

const startScene = (host: HTMLElement, onLoaded: () => void) =>
  Effect.gen(function* () {
    const { createIsoScene } = yield* Effect.tryPromise({
      try: () => import('./scene'),
      catch: toBrowserError,
    })
    return yield* createIsoScene({ host, onLoaded })
  })

// NOTE: mutable on purpose: a custom element is the browser's own mutable
// object, holding the renderer while it is on the page. Built only when it is
// defined, since HTMLElement exists only in a browser.
const worldElementClass = () =>
  class WorldElement extends HTMLElement {
    private latest: Option.Option<IsoFrame> = Option.none()
    private scene: Option.Option<IsoScene> = Option.none()
    private isOnPage = false
    private isStarting = false
    private isDrawDue = false

    get frame(): IsoFrame | undefined {
      return Option.getOrUndefined(this.latest)
    }

    set frame(next: IsoFrame) {
      this.latest = Option.some(next)
      this.draw()
    }

    connectedCallback(): void {
      this.isOnPage = true
      if (Option.isSome(this.scene) || this.isStarting) {
        return
      }
      this.isStarting = true
      Effect.runFork(
        startScene(this, () => {
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
              this.replaceChildren(unsupportedNode())
            },
          }),
        ),
      )
    }

    disconnectedCallback(): void {
      this.isOnPage = false
      Option.map(this.scene, scene => {
        scene.destroy()
      })
      this.scene = Option.none()
    }

    // NOTE: a sprite that loads asks for one more draw on the next animation
    // frame, however many load together.
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
      this.scene.value.draw(this.latest.value, {
        width: this.clientWidth,
        height: this.clientHeight,
      })
      // NOTE: the audits wait for it before they take a picture.
      this.dataset['drawn'] = 'true'
    }
  }

// NOTE: called once by the page's entry; tests never define it, so there the
// element stays a plain one that draws nothing.
export const defineWorldElement = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, worldElementClass())
  }
}
