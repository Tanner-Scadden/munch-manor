import { Effect, Option, Predicate, Schema } from 'effect'
import { Application } from 'pixi.js'

import { Html } from '@effect/ui/html'

import type * as Draw from '../../src/render/draw'
import { FlatPainter } from '../../src/render/iso/painter'
import { Textures } from '../../src/render/iso/textures'
import { toBrowserError } from '../../src/shared/describeError'

const TAG = 'studio-picture'

export type StudioPicture = Readonly<{
  key: string
  width: number
  height: number
  shapes: ReadonlyArray<Draw.Shape>
}>

const isStudioPicture = (value: unknown): value is StudioPicture =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'key') &&
  Predicate.hasProperty(value, 'width') &&
  Predicate.hasProperty(value, 'height') &&
  Predicate.hasProperty(value, 'shapes')

export const studioPicture = Html.customElement({
  tag: TAG,
  properties: { picture: Schema.declare(isStudioPicture) },
})

type Paintable = Readonly<{
  pictureToPaint: () => Option.Option<StudioPicture>
  show: (bitmap: ImageBitmap, token: number, isSettled: boolean) => void
  nextToken: () => number
}>

type Renderer = Readonly<{
  app: Application
  textures: Textures
  painter: FlatPainter
}>

class SharedPainter {
  private renderer: Option.Option<Renderer> = Option.none()
  private isStarting = false
  private isPassDue = false
  private readonly due = new Set<Paintable>()
  private readonly live = new Set<Paintable>()

  join(element: Paintable): void {
    this.live.add(element)
    this.ask(element)
  }

  leave(element: Paintable): void {
    this.live.delete(element)
    this.due.delete(element)
  }

  ask(element: Paintable): void {
    this.due.add(element)
    this.start()
    this.schedule()
  }

  private start(): void {
    if (Option.isSome(this.renderer) || this.isStarting) {
      return
    }
    this.isStarting = true
    const app = new Application()
    Effect.runFork(
      Effect.tryPromise({
        try: () =>
          app.init({
            preference: 'webgl',
            backgroundAlpha: 0,
            antialias: false,
            autoStart: false,
            width: 1,
            height: 1,
            resolution: 1,
            autoDensity: false,
          }),
        catch: toBrowserError,
      }).pipe(
        Effect.match({
          onSuccess: () => {
            const textures = new Textures(app, () => {
              for (const element of this.live) {
                this.due.add(element)
              }
              this.schedule()
            })
            const painter = new FlatPainter(textures)
            app.stage.addChild(painter.container)
            this.renderer = Option.some({ app, textures, painter })
            this.isStarting = false
            this.schedule()
          },
          onFailure: () => {
            this.isStarting = false
          },
        }),
      ),
    )
  }

  private schedule(): void {
    if (this.isPassDue || Option.isNone(this.renderer) || this.due.size === 0) {
      return
    }
    this.isPassDue = true
    requestAnimationFrame(() => {
      this.isPassDue = false
      this.pass()
    })
  }

  private pass(): void {
    if (Option.isNone(this.renderer)) {
      return
    }
    const { app, textures, painter } = this.renderer.value
    const elements = [...this.due]
    this.due.clear()
    for (const element of elements) {
      const maybePicture = element.pictureToPaint()
      if (Option.isNone(maybePicture)) {
        continue
      }
      const picture = maybePicture.value
      const width = Math.max(1, Math.round(picture.width))
      const height = Math.max(1, Math.round(picture.height))
      const { renderer } = app
      if (renderer.width !== width || renderer.height !== height) {
        renderer.resize(width, height, 1)
      }
      painter.paint(picture.shapes)
      app.render()
      const token = element.nextToken()
      const isSettled = textures.isSettled
      Effect.runFork(
        Effect.tryPromise({
          try: () => createImageBitmap(app.canvas),
          catch: toBrowserError,
        }).pipe(
          Effect.match({
            onSuccess: bitmap => {
              element.show(bitmap, token, isSettled)
            },
            onFailure: () => undefined,
          }),
        ),
      )
    }
  }
}

const SHARED = new SharedPainter()

const pictureElementClass = () =>
  class PictureElement extends HTMLElement {
    private latest: Option.Option<StudioPicture> = Option.none()
    private paintedKey: Option.Option<string> = Option.none()
    private token = 0
    private readonly canvas = document.createElement('canvas')
    private readonly paintable: Paintable = {
      pictureToPaint: () => this.latest,
      show: (bitmap, token, isSettled) => {
        this.show(bitmap, token, isSettled)
      },
      nextToken: () => {
        this.token += 1
        return this.token
      },
    }

    get picture(): StudioPicture | undefined {
      return Option.getOrUndefined(this.latest)
    }

    set picture(next: StudioPicture) {
      const isSame = Option.exists(this.paintedKey, key => key === next.key)
      this.latest = Option.some(next)
      if (!isSame && this.isConnected) {
        this.paintedKey = Option.some(next.key)
        SHARED.ask(this.paintable)
      }
    }

    connectedCallback(): void {
      if (this.canvas.parentElement !== this) {
        this.append(this.canvas)
      }
      this.paintedKey = Option.map(this.latest, picture => picture.key)
      SHARED.join(this.paintable)
    }

    disconnectedCallback(): void {
      SHARED.leave(this.paintable)
    }

    private show(bitmap: ImageBitmap, token: number, isSettled: boolean): void {
      const context = this.canvas.getContext('bitmaprenderer')
      if (token !== this.token || context === null) {
        bitmap.close()
        return
      }
      this.canvas.width = bitmap.width
      this.canvas.height = bitmap.height
      context.transferFromImageBitmap(bitmap)
      this.dataset['drawn'] = isSettled ? 'true' : 'loading'
    }
  }

export const defineStudioPicture = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, pictureElementClass())
  }
}
