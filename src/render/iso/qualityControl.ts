// The quality tier on the 3D renderer: the governor (quality.ts) fed each
// frame's times (frameProbe.ts), and its tier applied to the view (the
// shadow maps, the bloom) and to the canvas's step (space.ts). Render state
// only: the scene holds one, and nothing of it reaches the Model.

import { Option } from 'effect'
import type { Application } from 'pixi.js'

import type { View3D } from '@pixi/3d'
import { BloomEffect } from '@pixi/3d/extras'

import { isCineOn } from '../cine'
import { IsoLens } from './diorama'
import type { IsoFrame } from './frame'
import { FrameProbe } from './frameProbe'
import {
  QualityGovernor,
  type QualityTier,
  TIER_SPECS,
  type TierSpec,
  qualityPinOf,
  shadowQualityOf,
} from './quality'
import { canvasStepOf, scaledStepOf } from './space'

// NOTE: the bloom at a tier's resolution, or none. Its resolution is fixed
// when it is made, so a tier change makes a new one.
const bloomPassesOf = (spec: TierSpec): ReadonlyArray<BloomEffect> =>
  Option.match(spec.bloomResolution, {
    onNone: () => [],
    onSome: resolution => [
      new BloomEffect({
        threshold: 2,
        intensity: 1.1,
        radius: 0.6,
        resolution,
      }),
    ],
  })

const glOf = (app: Application): Option.Option<WebGL2RenderingContext> => {
  const { renderer } = app
  return 'gl' in renderer && renderer.gl instanceof WebGL2RenderingContext
    ? Option.some(renderer.gl)
    : Option.none()
}

// NOTE: mutable on purpose: it keeps the last frame it was handed, to read
// the gap to the next.
export class WorldQuality {
  private readonly governor: QualityGovernor
  private readonly probe: FrameProbe
  private lastElapsedMs = Number.NaN
  private lastFrameAtMs = 0
  private wasCounted = false

  constructor(app: Application) {
    this.governor = new QualityGovernor(
      qualityPinOf({
        search: window.location.search,
        isAutomated: navigator.webdriver,
      }),
    )
    // NOTE: a pinned tier asks the GPU for no timings, so a pinned audit
    // draws exactly as before.
    this.probe = new FrameProbe(
      this.governor.isPinned ? Option.none() : glOf(app),
    )
  }

  get tier(): QualityTier {
    return this.governor.tier
  }

  // NOTE: the view's options for the tier it starts at.
  get viewOptions(): Readonly<{
    shadowQuality: ReturnType<typeof shadowQualityOf>
    passes: ReadonlyArray<BloomEffect>
  }> {
    return {
      shadowQuality: shadowQualityOf(this.tier),
      passes: bloomPassesOf(TIER_SPECS[this.tier]),
    }
  }

  // NOTE: the play camera's canvas step at this tier.
  playStepOf(
    input: Readonly<{ devicePerGamePixel: number; ratio: number }>,
  ): number {
    return Option.match(TIER_SPECS[this.tier].canvasPerGamePixel, {
      onNone: () => canvasStepOf(input),
      onSome: perGamePixel => scaledStepOf({ ...input, perGamePixel }),
    })
  }

  // NOTE: a draw begins; the page's clock at its start.
  begin(): number {
    return this.probe.begin()
  }

  // NOTE: a change on screen (a level built, the canvas resized).
  hold(atMs: number): void {
    this.governor.holdFrom(atMs)
  }

  // NOTE: the frame just drawn handed to the governor, and its tier applied
  // when it steps. Only play counts, with the world's clock running and no
  // cine on: the title's diorama draws at its own pace, and a paused game
  // draws nothing new.
  end(frame: IsoFrame, view: View3D): void {
    const probed = this.probe.end()
    if (this.governor.isPinned) {
      return
    }
    const { model } = frame
    const isPlay = IsoLens.match(frame.lens, {
      Play: () => true,
      Diorama: () => false,
    })
    // NOTE: play drawn again with the world's clock where it was (a second
    // render in a frame, a paused game) is neither judged nor a change.
    if (isPlay && model.elapsedMs === this.lastElapsedMs) {
      return
    }
    const isCounted = isPlay && !isCineOn(model)
    const gapMs =
      isCounted && this.wasCounted
        ? Option.some(probed.atMs - this.lastFrameAtMs)
        : Option.none()
    this.lastElapsedMs = model.elapsedMs
    this.lastFrameAtMs = probed.atMs
    this.wasCounted = isCounted
    const hasGpuTimer = this.probe.hasGpuTimer
    Option.map(
      this.governor.observe({
        atMs: probed.atMs,
        isCounted,
        costMs: hasGpuTimer ? probed.gpuMs : Option.some(probed.drawMs),
        gapMs,
        hasGpuTimer,
      }),
      tier => {
        view.shadowQuality = shadowQualityOf(tier)
        view.passes = bloomPassesOf(TIER_SPECS[tier])
      },
    )
  }

  destroy(): void {
    this.probe.destroy()
  }
}
