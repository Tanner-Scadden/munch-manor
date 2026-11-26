import { Effect, Option, Schedule, pipe } from 'effect'

import { Html } from '@effect/ui/html'

import { toBrowserError } from '../../shared/describeError'
import { DIORAMA_FRAME_MS, IsoLens } from './diorama'
import { type IsoFrame, IsoFrameSchema } from './frame'
import { type HoldKey, isHeldOver } from './hold'
import type { PlinthPicture } from './plinth'
import type { PlinthPose } from './plinthPose'
import type { IsoScene } from './scene'
import { unsupportedNode } from './support'

const TAG = 'munch-world'

export const worldElement = Html.customElement({
  tag: TAG,
  properties: { frame: IsoFrameSchema },
})

const startScene = (host: HTMLElement, onLoaded: () => void) =>
  Effect.gen(function* () {
    const { createIsoScene } = yield* Effect.tryPromise({
      try: () => import('./scene'),
      catch: toBrowserError,
    })
    return yield* createIsoScene({ host, onLoaded })
  })

const DIORAMA_EARLY_MS = 4

const lengthOr = (length: string, fallback: number): number => {
  const pixels = Number.parseFloat(length)
  return Number.isFinite(pixels) && pixels > 0 ? pixels : fallback
}

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
      const isDue =
        this.isDueAt(next.lens) &&
        !isHeldOver({ drawn: this.drawnHold, next: next.hold })
      this.latest = Option.some(next)
      if (isDue) {
        this.draw()
      }
    }

    private lastDioramaMs = Number.NEGATIVE_INFINITY

    private drawnHold: Option.Option<HoldKey> = Option.none()

    private isDueAt(lens: IsoLens): boolean {
      return IsoLens.match(lens, {
        Play: () => {
          this.lastDioramaMs = Number.NEGATIVE_INFINITY
          return true
        },
        Diorama: ({ clockMs }) => {
          const since = clockMs - this.lastDioramaMs
          if (since >= 0 && since < DIORAMA_FRAME_MS - DIORAMA_EARLY_MS) {
            return false
          }
          this.lastDioramaMs = clockMs
          return true
        },
      })
    }

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

    snapshot(): HTMLCanvasElement | undefined {
      this.draw()
      const canvas = this.querySelector('canvas.world-canvas')
      return canvas instanceof HTMLCanvasElement ? canvas : undefined
    }

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
      const style = getComputedStyle(this)
      this.scene.value.draw(
        this.latest.value,
        {
          width: lengthOr(style.width, this.clientWidth),
          height: lengthOr(style.height, this.clientHeight),
        },
        { isStill: this.reducedMotion.matches },
      )
      this.drawnHold = this.latest.value.hold
      this.dataset['drawn'] = 'true'
      this.dataset['quality'] = this.scene.value.tier
      if (this.scene.value.isSettled) {
        this.dataset['ready'] = 'true'
      }
    }
  }

type WorldElement = InstanceType<ReturnType<typeof worldElementClass>>

const isWorldElement = (node: Element | null): node is WorldElement =>
  node !== null && 'snapshot' in node

export const drawPlinthOnWorld = (
  input: Readonly<{ pose: PlinthPose; isStill: boolean }>,
): Option.Option<PlinthPicture> => {
  const world = document.querySelector(TAG)
  return isWorldElement(world)
    ? world.drawPlinth(input.pose, { isStill: input.isStill })
    : Option.none()
}

export const snapshotWorld = (): Option.Option<HTMLCanvasElement> => {
  const world = document.querySelector(TAG)
  return isWorldElement(world)
    ? Option.fromNullishOr(world.snapshot())
    : Option.none()
}

const READY_POLL_MS = 50
const READY_GIVE_UP_MS = 15_000

const isWorldReady = (): boolean => {
  const world = document.querySelector<HTMLElement>(TAG)
  return world === null || world.dataset['ready'] === 'true'
}

export const awaitWorldReady: Effect.Effect<void> = pipe(
  Effect.sync(isWorldReady),
  Effect.repeat({
    until: isReady => isReady,
    schedule: Schedule.spaced(READY_POLL_MS),
  }),
  Effect.timeout(READY_GIVE_UP_MS),
  Effect.ignore,
)

export const defineWorldElement = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, worldElementClass())
  }
}
