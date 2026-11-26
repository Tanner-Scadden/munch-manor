import { Array, Option, Order, String } from 'effect'

import type { ShadowQuality } from '@pixi/3d'

export type QualityTier = 'Full' | 'Light' | 'Scaled' | 'Floor'

export const TIERS: ReadonlyArray<QualityTier> = [
  'Full',
  'Light',
  'Scaled',
  'Floor',
]

export type TierSpec = Readonly<{
  shadowMapPx: 512 | 1024 | 2048
  bloomResolution: Option.Option<number>
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

const PIN_PARAM = 'quality'

const PINS: Readonly<Record<string, Option.Option<QualityTier>>> = {
  full: Option.some('Full'),
  light: Option.some('Light'),
  scaled: Option.some('Scaled'),
  floor: Option.some('Floor'),
  auto: Option.none(),
}

export const qualityPinOf = (
  input: Readonly<{ search: string; isAutomated: boolean }>,
): Option.Option<QualityTier> => {
  const asked = new URLSearchParams(input.search).get(PIN_PARAM)
  const pin = asked === null ? undefined : PINS[String.toLowerCase(asked)]
  return pin ?? (input.isAutomated ? Option.some('Full') : Option.none())
}

export const GOVERNOR = {
  windowMs: 2000,
  holdMs: 1000,
  leastFrames: 20,
  slowMs: 14,
  roomyMs: 7,
  slowDropShare: 0.1,
  roomyDropShare: 0.02,
  dropGapMs: 25,
  pauseMs: 250,
  slowWindows: 2,
  upWindows: 10,
} as const

export type FrameSample = Readonly<{
  atMs: number
  isCounted: boolean
  costMs: Option.Option<number>
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

  get isPinned(): boolean {
    return Option.isSome(this.pin)
  }

  holdFrom(atMs: number): void {
    this.holdUntilMs = atMs + GOVERNOR.holdMs
    this.windowStartMs = undefined
  }

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
