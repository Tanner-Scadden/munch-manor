// The overlay's renderer: the HUD, the banners, and the cards, painted flat
// by Pixi (painter.ts) on a WebGL canvas of one canvas pixel to a game pixel,
// stretched over the stage by CSS, pixelated. It never runs a ticker: the
// overlay's element (overlayElement.ts) paints each picture it is handed,
// and only one that differs from the last painted.

import { Effect } from 'effect'
import { Application } from 'pixi.js'

import { type BrowserError, toBrowserError } from '../../shared/describeError'
import type * as Draw from '../draw'
import { FlatPainter } from './painter'
import { Textures } from './textures'

// NOTE: what the overlay shows: its shapes on a picture of `width` by
// `height` game pixels, the screen's size.
export type OverlayPicture = Readonly<{
  width: number
  height: number
  shapes: ReadonlyArray<Draw.Shape>
}>

// NOTE: mutable on purpose: it holds pixi's own objects for the life of the
// overlay's element.
export class OverlayScene {
  private readonly app: Application
  private readonly textures: Textures
  private readonly painter: FlatPainter
  // NOTE: what was painted last, and how many sources had loaded then: an
  // image still loading draws nothing, so a source come in since paints the
  // same picture again.
  private shown: OverlayPicture | undefined
  private shownLoaded = -1

  constructor(app: Application, onLoaded: () => void) {
    this.app = app
    this.textures = new Textures(app, onLoaded)
    this.painter = new FlatPainter(this.textures)
    app.stage.addChild(this.painter.container)
  }

  paint(picture: OverlayPicture): void {
    const loaded = this.textures.loaded
    if (picture === this.shown && loaded === this.shownLoaded) {
      return
    }
    this.shown = picture
    this.shownLoaded = loaded
    const { renderer } = this.app
    if (
      renderer.width !== picture.width ||
      renderer.height !== picture.height
    ) {
      renderer.resize(picture.width, picture.height, 1)
    }
    this.painter.paint(picture.shapes)
    this.app.render()
  }

  destroy(): void {
    this.textures.destroy()
    this.app.destroy(true, { children: true })
  }
}

// NOTE: the overlay's own small WebGL2 canvas in `host`. It sits outside the
// world's lens (its CSS zoom and color drain at a run's end), so it cannot
// share the world's canvas, and copying a picture from the world's context
// each frame would stall on its GPU work.
export const createOverlayScene = ({
  host,
  picture,
  onLoaded,
}: Readonly<{
  host: HTMLElement
  picture: OverlayPicture
  onLoaded: () => void
}>): Effect.Effect<OverlayScene, BrowserError> =>
  Effect.gen(function* () {
    const app = new Application()
    yield* Effect.tryPromise({
      try: () =>
        app.init({
          preference: 'webgl',
          backgroundAlpha: 0,
          antialias: false,
          autoStart: false,
          width: Math.max(1, picture.width),
          height: Math.max(1, picture.height),
          resolution: 1,
          autoDensity: false,
        }),
      catch: toBrowserError,
    })
    app.canvas.classList.add('overlay-layer-canvas')
    host.append(app.canvas)
    return new OverlayScene(app, onLoaded)
  })
