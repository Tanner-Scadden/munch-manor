import { Option } from 'effect'
import type { Application } from 'pixi.js'

import type { View3D } from '@pixi/3d'

import { isCineOn } from '#render/camera/cine.ts'
import type { IsoFrame } from '#render/iso/frame.ts'
import { IsoLens } from '#render/iso/plinth/diorama.ts'
import { canvasStepOf, scaledStepOf } from '#render/iso/space.ts'

import { type CheapBloomEffect, worldBloomOf } from './bloom.ts'
import { FrameProbe } from './frameProbe.ts'
import {
  QualityGovernor,
  type QualityTier,
  TIER_SPECS,
  type TierSpec,
  qualityPinOf,
  shadowQualityOf,
} from './quality.ts'

const bloomPassesOf = (spec: TierSpec): ReadonlyArray<CheapBloomEffect> =>
  Option.match(spec.bloomResolution, {
    onNone: () => [],
    onSome: resolution => [worldBloomOf(resolution)],
  })

const glOf = (app: Application): Option.Option<WebGL2RenderingContext> => {
  const { renderer } = app
  return 'gl' in renderer && renderer.gl instanceof WebGL2RenderingContext
    ? Option.some(renderer.gl)
    : Option.none()
}

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
    this.probe = new FrameProbe(
      this.governor.isPinned ? Option.none() : glOf(app),
    )
  }

  get tier(): QualityTier {
    return this.governor.tier
  }

  get viewOptions(): Readonly<{
    shadowQuality: ReturnType<typeof shadowQualityOf>
    passes: ReadonlyArray<CheapBloomEffect>
  }> {
    return {
      shadowQuality: shadowQualityOf(this.tier),
      passes: bloomPassesOf(TIER_SPECS[this.tier]),
    }
  }

  playStepOf(
    input: Readonly<{ devicePerGamePixel: number; ratio: number }>,
  ): number {
    return Option.match(TIER_SPECS[this.tier].canvasPerGamePixel, {
      onNone: () => canvasStepOf(input),
      onSome: perGamePixel => scaledStepOf({ ...input, perGamePixel }),
    })
  }

  begin(): number {
    return this.probe.begin()
  }

  hold(atMs: number): void {
    this.governor.holdFrom(atMs)
  }

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
