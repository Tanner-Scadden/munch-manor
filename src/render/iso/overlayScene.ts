import { Effect } from 'effect'
import { Application } from 'pixi.js'

import { type BrowserError, toBrowserError } from '../../shared/describeError'
import type * as Draw from '../draw'
import { FlatPainter } from './painter'
import { Textures } from './textures'

export type OverlayPicture = Readonly<{
  width: number
  height: number
  shapes: ReadonlyArray<Draw.Shape>
}>

export class OverlayScene {
  private readonly app: Application
  private readonly textures: Textures
  private readonly painter: FlatPainter
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
