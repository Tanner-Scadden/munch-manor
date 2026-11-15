// The world's element, `<munch-world>`: the 3D renderer on the page. The view
// sets its one property, `frame`, each render (a new IsoFrame each time), and
// the element draws that frame then and there, with no ticker of its own, so
// a frame drawn is always the Model's latest and a screenshot is the same each
// time. The renderer (PixiJS 3D) loads in its own chunk the first time an
// element joins the page.

import { Effect, Option, Schedule, pipe } from 'effect'
import { CustomElement } from 'foldkit'

import { toBrowserError } from '../../shared/describeError'
import { DIORAMA_FRAME_MS, IsoLens } from './diorama'
import { type IsoFrame, IsoFrameSchema } from './frame'
import type { PlinthPicture } from './plinth'
import type { PlinthPose } from './plinthPose'
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

const lengthOr = (length: string, fallback: number): number => {
  const pixels = Number.parseFloat(length)
  return Number.isFinite(pixels) && pixels > 0 ? pixels : fallback
}

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
      const isDue = this.isDueAt(next.lens)
      this.latest = Option.some(next)
      if (isDue) {
        this.draw()
      }
    }

    // NOTE: the title's diorama draws at most DIORAMA_FPS frames a second
    // by its own clock, so a phone resting on the menu does half the work.
    // The play camera draws every frame it is handed.
    private lastDioramaMs = Number.NEGATIVE_INFINITY

    private isDueAt(lens: IsoLens): boolean {
      return IsoLens.match(lens, {
        Play: () => {
          this.lastDioramaMs = Number.NEGATIVE_INFINITY
          return true
        },
        Diorama: ({ clockMs }) => {
          const since = clockMs - this.lastDioramaMs
          if (since >= 0 && since < DIORAMA_FRAME_MS) {
            return false
          }
          this.lastDioramaMs = clockMs
          return true
        },
      })
    }

    // NOTE: the browser's reduced motion setting, read as each frame
    // draws: the title's diorama then holds still.
    private readonly reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    )

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
              this.dataset['ready'] = 'true'
            },
          }),
        ),
      )
    }

    // NOTE: the scene is let go of before it is destroyed, so a teardown that
    // throws never leaves a dead scene to draw with when the element joins
    // the page again.
    disconnectedCallback(): void {
      this.isOnPage = false
      const scene = this.scene
      this.scene = Option.none()
      Option.map(scene, live => {
        live.destroy()
      })
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

    // NOTE: the frame drawn again and copied at once, in the same task, since
    // WebGL clears its canvas once the page shows it: Munch Studio's pixel
    // loupe and a note's picture (tools/studio/worldStage.ts).
    snapshot(): HTMLCanvasElement | undefined {
      this.draw()
      const canvas = this.querySelector('canvas.world-canvas')
      if (!(canvas instanceof HTMLCanvasElement)) {
        return undefined
      }
      const copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      copy.getContext('2d')?.drawImage(canvas, 0, 0)
      return copy
    }

    // NOTE: a plinth's picture drawn with this renderer, so the page keeps
    // one WebGL context (plinthElement.ts); none before the renderer is in.
    drawPlinth(
      pose: PlinthPose,
      options: Readonly<{ isStill: boolean }>,
    ): Option.Option<PlinthPicture> {
      return Option.flatMap(this.scene, scene =>
        scene.drawPlinth(pose, options),
      )
    }

    private draw(): void {
      if (Option.isNone(this.scene) || Option.isNone(this.latest)) {
        return
      }
      // NOTE: the box's laid out size, fractions kept (a stage on whole
      // device pixels can be a fraction of a CSS pixel wide,
      // src/render/screen.ts), and before the lens's scale, which stretches
      // the drawn canvas instead.
      const style = getComputedStyle(this)
      this.scene.value.draw(
        this.latest.value,
        {
          width: lengthOr(style.width, this.clientWidth),
          height: lengthOr(style.height, this.clientHeight),
        },
        { isStill: this.reducedMotion.matches },
      )
      // NOTE: the audits wait for it before they take a picture.
      this.dataset['drawn'] = 'true'
      // NOTE: the splash waits for this: the world drawn with every sprite
      // it asked for (src/app/boot.ts).
      if (this.scene.value.isSettled) {
        this.dataset['ready'] = 'true'
      }
    }
  }

type WorldElement = InstanceType<ReturnType<typeof worldElementClass>>

const isWorldElement = (node: Element | null): node is WorldElement =>
  node !== null && 'snapshot' in node

// NOTE: a plinth's picture, drawn by the world's renderer on the page; none
// before the renderer is in, or while the sprite loads.
export const drawPlinthOnWorld = (
  input: Readonly<{ pose: PlinthPose; isStill: boolean }>,
): Option.Option<PlinthPicture> => {
  const world = document.querySelector(TAG)
  return isWorldElement(world)
    ? world.drawPlinth(input.pose, { isStill: input.isStill })
    : Option.none()
}

// NOTE: the world's frame on the page drawn again and copied, for the dev
// tools that read its pixels; none before the renderer is in.
export const snapshotWorld = (): Option.Option<HTMLCanvasElement> => {
  const world = document.querySelector(TAG)
  return isWorldElement(world)
    ? Option.fromNullishOr(world.snapshot())
    : Option.none()
}

// SPLASH

const READY_POLL_MS = 50
const READY_GIVE_UP_MS = 15_000

const isWorldReady = (): boolean => {
  const world = document.querySelector<HTMLElement>(TAG)
  return world === null || world.dataset['ready'] === 'true'
}

// NOTE: the world's first whole frame: the renderer loaded, its shaders
// built, and every sprite it asked for in, so the menu never opens on a
// black, stalling world. Given up on after a while, so a slow device still
// gets in.
export const awaitWorldReady: Effect.Effect<void> = pipe(
  Effect.sync(isWorldReady),
  Effect.repeat({
    until: isReady => isReady,
    schedule: Schedule.spaced(READY_POLL_MS),
  }),
  Effect.timeout(READY_GIVE_UP_MS),
  Effect.ignore,
)

// NOTE: called once by the page's entry; tests never define it, so there the
// element stays a plain one that draws nothing.
export const defineWorldElement = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, worldElementClass())
  }
}
