// The 3D world's quality tiers, and the governor that picks one from how
// long frames take on this device (owner, 2026-11-15: a steady 60 fps, and
// phones that do not get hot). A device whose GPU cannot keep up steps down:
// first the shadow maps and the bloom, which nobody sees go, then the render
// scale, the biggest fill cost, then the floor. A strong GPU keeps the full
// look. It reads only measured frame times, never the device's kind, its
// touch, its layout, or its user agent.
//
// This is render state: the renderer (scene.ts) holds the governor and feeds
// it its own frame times (frameProbe.ts). Nothing here is in the Model or the
// World, nothing touches update, and nothing is saved, so the game plays the
// same at every tier and each session starts at Full.

import { Array, Option, Order, String } from 'effect'

import type { ShadowQuality } from '@pixi/3d'

export type QualityTier = 'Full' | 'Light' | 'Scaled' | 'Floor'

// NOTE: best first; a step down is one place on.
export const TIERS: ReadonlyArray<QualityTier> = [
  'Full',
  'Light',
  'Scaled',
  'Floor',
]

export type TierSpec = Readonly<{
  // NOTE: each casting light's shadow map, texels a side.
  shadowMapPx: 512 | 1024 | 2048
  // NOTE: the bloom's largest blur level, texels per pixel, or no bloom.
  bloomResolution: Option.Option<number>
  // NOTE: the most canvas pixels drawn to a game pixel, or as many as the
  // device's ratio allows (space.ts, `canvasStepOf`).
  canvasPerGamePixel: Option.Option<number>
}>

export const TIER_SPECS: { readonly [Tier in QualityTier]: TierSpec } = {
  Full: {
    shadowMapPx: 2048,
    bloomResolution: Option.some(0.5),
    canvasPerGamePixel: Option.none(),
  },
  Light: {
    shadowMapPx: 1024,
    bloomResolution: Option.some(0.25),
    canvasPerGamePixel: Option.none(),
  },
  Scaled: {
    shadowMapPx: 1024,
    bloomResolution: Option.some(0.25),
    canvasPerGamePixel: Option.some(2),
  },
  Floor: {
    shadowMapPx: 512,
    bloomResolution: Option.none(),
    canvasPerGamePixel: Option.some(2),
  },
}

const SHADOW_QUALITY: {
  readonly [Px in TierSpec['shadowMapPx']]: ShadowQuality
} = {
  512: 'low',
  1024: 'medium',
  2048: 'high',
}

export const shadowQualityOf = (tier: QualityTier): ShadowQuality =>
  SHADOW_QUALITY[TIER_SPECS[tier].shadowMapPx]

// PINNING

const PIN_PARAM = 'quality'

const PINS: Readonly<Record<string, Option.Option<QualityTier>>> = {
  full: Option.some('Full'),
  light: Option.some('Light'),
  scaled: Option.some('Scaled'),
  floor: Option.some('Floor'),
  auto: Option.none(),
}

// NOTE: `?quality=full|light|scaled|floor` pins a tier, so audits and
// screenshots are the same each time; `?quality=auto` adapts. A browser
// driven by automation (the audits' headless Chrome, whose software GL is
// slow) is pinned at Full unless it asks for `auto`, so no audit's picture
// changes with the machine's load.
export const qualityPinOf = (
  input: Readonly<{ search: string; isAutomated: boolean }>,
): Option.Option<QualityTier> => {
  const asked = new URLSearchParams(input.search).get(PIN_PARAM)
  const pin = asked === null ? undefined : PINS[String.toLowerCase(asked)]
  return pin ?? (input.isAutomated ? Option.some('Full') : Option.none())
}

// THE GOVERNOR

// NOTE: how frames are judged. A window of 2 s of play is read at once:
// slow when its 75th percentile frame takes over 14 ms (of the 16.7 a frame
// at 60 fps has) or over a tenth of its frames are dropped; roomy when that
// frame takes under 7 ms and almost none drop. Two slow windows in a row
// step down a tier, so one hitch (a crowd spawning) never does. Ten roomy
// windows in a row (20 s) step back up a tier, twice as many each time that
// tier proved slow, so it never flaps between two.
export const GOVERNOR = {
  windowMs: 2000,
  holdMs: 1000,
  leastFrames: 20,
  slowMs: 14,
  roomyMs: 7,
  slowDropShare: 0.1,
  roomyDropShare: 0.02,
  // NOTE: a gap between two drawn frames longer than this is a dropped
  // frame at 60 fps; one longer than `pauseMs` is the page put away, not a
  // slow frame.
  dropGapMs: 25,
  pauseMs: 250,
  slowWindows: 2,
  upWindows: 10,
} as const

export type FrameSample = Readonly<{
  // NOTE: when the frame started, on the page's clock.
  atMs: number
  // NOTE: whether the frame counts: play on screen with no cine. A frame
  // that does not count starts a hold.
  isCounted: boolean
  // NOTE: what the frame cost: the GPU's time for it where the context can
  // time the GPU, else the draw's own time on the main thread.
  costMs: Option.Option<number>
  // NOTE: the gap since the frame drawn before it, where that one counted
  // too; read only where the GPU's time is not known.
  gapMs: Option.Option<number>
  hasGpuTimer: boolean
}>

const percentileOf = (values: ReadonlyArray<number>, share: number): number => {
  const sorted = Array.sort(values, Order.Number)
  return Option.getOrElse(
    Array.get(
      sorted,
      Math.min(sorted.length - 1, Math.floor(sorted.length * share)),
    ),
    () => 0,
  )
}

// NOTE: mutable on purpose: the renderer's own state, fed once a frame;
// each window's costs are gathered in place and dropped as it is read.
export class QualityGovernor {
  private index = 0
  private readonly pin: Option.Option<QualityTier>
  private holdUntilMs = Number.NEGATIVE_INFINITY
  private windowStartMs: number | undefined
  private costs: Array<number> = []
  private frames = 0
  private drops = 0
  private roomyWindows = 0
  private slowWindows = 0
  // NOTE: how many times each tier stepped down for being slow.
  private readonly slowCounts: Array<number> = Array.map(TIERS, () => 0)

  constructor(pin: Option.Option<QualityTier>) {
    this.pin = pin
    this.index = Option.match(pin, {
      onNone: () => 0,
      onSome: tier =>
        Option.getOrElse(
          Array.findFirstIndex(TIERS, each => each === tier),
          () => 0,
        ),
    })
  }

  get tier(): QualityTier {
    return Option.getOrElse(Array.get(TIERS, this.index), () => 'Full')
  }

  // NOTE: a change on screen (a level built, the canvas resized, a tier
  // stepped): nothing is judged for a second after it.
  holdFrom(atMs: number): void {
    this.holdUntilMs = atMs + GOVERNOR.holdMs
    this.windowStartMs = undefined
  }

  // NOTE: one frame in; a new tier when its window decides on one.
  observe(sample: FrameSample): Option.Option<QualityTier> {
    if (Option.isSome(this.pin)) {
      return Option.none()
    }
    const isPaused = Option.exists(
      sample.gapMs,
      gapMs => gapMs > GOVERNOR.pauseMs,
    )
    if (!sample.isCounted || isPaused) {
      this.holdFrom(sample.atMs)
      return Option.none()
    }
    if (sample.atMs < this.holdUntilMs) {
      return Option.none()
    }
    if (this.windowStartMs === undefined) {
      this.windowStartMs = sample.atMs
      this.costs = []
      this.frames = 0
      this.drops = 0
    }
    if (Option.isSome(sample.costMs)) {
      this.costs.push(sample.costMs.value)
    }
    this.frames += 1
    if (
      !sample.hasGpuTimer &&
      Option.exists(sample.gapMs, gapMs => gapMs > GOVERNOR.dropGapMs)
    ) {
      this.drops += 1
    }
    if (
      sample.atMs - this.windowStartMs < GOVERNOR.windowMs ||
      this.costs.length < GOVERNOR.leastFrames
    ) {
      return Option.none()
    }
    return this.judge(sample.atMs)
  }

  private judge(atMs: number): Option.Option<QualityTier> {
    const cost = percentileOf(this.costs, 0.75)
    const dropShare = this.drops / Math.max(1, this.frames)
    this.windowStartMs = undefined
    const isSlow = cost > GOVERNOR.slowMs || dropShare > GOVERNOR.slowDropShare
    const isRoomy =
      cost < GOVERNOR.roomyMs && dropShare < GOVERNOR.roomyDropShare
    if (isSlow) {
      this.roomyWindows = 0
      this.slowWindows += 1
      if (
        this.index >= TIERS.length - 1 ||
        this.slowWindows < GOVERNOR.slowWindows
      ) {
        return Option.none()
      }
      this.slowCounts[this.index] = (this.slowCounts[this.index] ?? 0) + 1
      return this.stepTo(this.index + 1, atMs)
    }
    this.slowWindows = 0
    if (!isRoomy) {
      this.roomyWindows = 0
      return Option.none()
    }
    this.roomyWindows += 1
    const above = this.index - 1
    const needed = GOVERNOR.upWindows * 2 ** (this.slowCounts[above] ?? 0)
    if (above < 0 || this.roomyWindows < needed) {
      return Option.none()
    }
    this.roomyWindows = 0
    return this.stepTo(above, atMs)
  }

  private stepTo(index: number, atMs: number): Option.Option<QualityTier> {
    this.index = index
    this.slowWindows = 0
    this.holdFrom(atMs)
    return Option.some(this.tier)
  }
}
