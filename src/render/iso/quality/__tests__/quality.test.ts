import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  GOVERNOR,
  QualityGovernor,
  type QualityTier,
  TIERS,
  TIER_SPECS,
  qualityPinOf,
  shadowQualityOf,
} from '#render/iso/quality/quality.ts'

const FRAME_MS = 1000 / 60

type Feed = Readonly<{
  governor: QualityGovernor
  fromMs: number
  seconds: number
  costMs: number
  hasGpuTimer?: boolean
  gapMs?: number
  isCounted?: boolean
}>

const feed = (
  input: Feed,
): Readonly<{
  steps: ReadonlyArray<QualityTier>
  endMs: number
}> => {
  const count = Math.round(input.seconds * 60)
  const steps: Array<QualityTier> = []
  Array.forEach(Array.range(0, count - 1), frame => {
    const atMs = input.fromMs + frame * FRAME_MS
    Option.map(
      input.governor.observe({
        atMs,
        isCounted: input.isCounted ?? true,
        costMs: Option.some(input.costMs),
        gapMs: Option.some(input.gapMs ?? FRAME_MS),
        hasGpuTimer: input.hasGpuTimer ?? true,
      }),
      tier => {
        steps.push(tier)
      },
    )
  })
  return { steps, endMs: input.fromMs + count * FRAME_MS }
}

const adaptive = () => new QualityGovernor(Option.none())

describe('the tiers', () => {
  test.each([
    { tier: 'Full', shadow: 2048, bloom: 0.5, scale: undefined },
    { tier: 'Light', shadow: 1024, bloom: 0.25, scale: undefined },
    { tier: 'Scaled', shadow: 1024, bloom: 0.25, scale: 2 },
    { tier: 'Floor', shadow: 512, bloom: undefined, scale: 2 },
  ] as const)('$tier: shadows $shadow, bloom $bloom, scale $scale', row => {
    const spec = TIER_SPECS[row.tier]
    expect(spec.shadowMapPx).toBe(row.shadow)
    expect(Option.getOrUndefined(spec.bloomResolution)).toBe(row.bloom)
    expect(Option.getOrUndefined(spec.canvasPerGamePixel)).toBe(row.scale)
  })

  test("pixi's shadow quality matches each tier's map", () => {
    expect(Array.map(TIERS, shadowQualityOf)).toEqual([
      'high',
      'medium',
      'medium',
      'low',
    ])
  })
})

describe('pinning a tier', () => {
  test.each([
    { search: '?quality=full', isAutomated: false, pin: 'Full' },
    { search: '?quality=scaled', isAutomated: false, pin: 'Scaled' },
    { search: '?quality=Floor', isAutomated: false, pin: 'Floor' },
    { search: '', isAutomated: false, pin: undefined },
    { search: '?quality=auto', isAutomated: true, pin: undefined },
    { search: '', isAutomated: true, pin: 'Full' },
    { search: '?quality=nonsense', isAutomated: true, pin: 'Full' },
  ])(
    '$search, automated $isAutomated: $pin',
    ({ search, isAutomated, pin }) => {
      expect(Option.getOrUndefined(qualityPinOf({ search, isAutomated }))).toBe(
        pin,
      )
    },
  )

  test('a pinned tier never steps', () => {
    const governor = new QualityGovernor(Option.some('Light'))
    expect(governor.tier).toBe('Light')
    expect(governor.isPinned).toBe(true)
    expect(new QualityGovernor(Option.none()).isPinned).toBe(false)
    const { steps } = feed({ governor, fromMs: 0, seconds: 10, costMs: 30 })
    expect(steps).toEqual([])
    expect(governor.tier).toBe('Light')
  })
})

describe('the governor', () => {
  test('starts at Full and keeps it while frames are quick', () => {
    const governor = adaptive()
    const { steps } = feed({ governor, fromMs: 0, seconds: 30, costMs: 5 })
    expect(steps).toEqual([])
    expect(governor.tier).toBe('Full')
  })

  test('steps down one tier after two slow windows in a row', () => {
    const governor = adaptive()
    const once = feed({ governor, fromMs: 0, seconds: 2.5, costMs: 18 })
    expect(once.steps).toEqual([])
    const twice = feed({
      governor,
      fromMs: once.endMs,
      seconds: 2,
      costMs: 18,
    })
    expect(twice.steps).toEqual(['Light'])
  })

  test('one slow window, a hitch, never steps down', () => {
    const governor = adaptive()
    const hitch = feed({ governor, fromMs: 0, seconds: 2.1, costMs: 30 })
    const quick = feed({ governor, fromMs: hitch.endMs, seconds: 2, costMs: 5 })
    const again = feed({
      governor,
      fromMs: quick.endMs,
      seconds: 2,
      costMs: 30,
    })
    expect([...hitch.steps, ...quick.steps, ...again.steps]).toEqual([])
  })

  test('judges nothing in the second after a change', () => {
    const governor = adaptive()
    governor.holdFrom(0)
    const { steps } = feed({ governor, fromMs: 0, seconds: 4.9, costMs: 30 })
    expect(steps).toEqual([])
    expect(
      feed({ governor, fromMs: 4900, seconds: 0.2, costMs: 30 }).steps,
    ).toEqual(['Light'])
  })

  test('after a step down, holds before judging again', () => {
    const governor = adaptive()
    const first = feed({ governor, fromMs: 0, seconds: 4.1, costMs: 30 })
    expect(first.steps).toEqual(['Light'])
    const held = feed({
      governor,
      fromMs: first.endMs,
      seconds: (GOVERNOR.holdMs + 2 * GOVERNOR.windowMs - 100) / 1000,
      costMs: 30,
    })
    expect(held.steps).toEqual([])
  })

  test('never steps during a cine or a paused game', () => {
    const governor = adaptive()
    const { steps } = feed({
      governor,
      fromMs: 0,
      seconds: 10,
      costMs: 30,
      isCounted: false,
    })
    expect(steps).toEqual([])
    expect(governor.tier).toBe('Full')
  })

  test('steps down to the floor and no further', () => {
    const governor = adaptive()
    const { steps } = feed({ governor, fromMs: 0, seconds: 30, costMs: 30 })
    expect(steps).toEqual(['Light', 'Scaled', 'Floor'])
  })

  test('steps up only after a long stretch of headroom', () => {
    const governor = adaptive()
    const slow = feed({ governor, fromMs: 0, seconds: 4.1, costMs: 20 })
    expect(slow.steps).toEqual(['Light'])
    const middling = feed({
      governor,
      fromMs: slow.endMs,
      seconds: 60,
      costMs: 10,
    })
    expect(middling.steps).toEqual([])
    const stretchSeconds =
      (GOVERNOR.holdMs + 2 * GOVERNOR.upWindows * GOVERNOR.windowMs) / 1000
    const early = feed({
      governor,
      fromMs: middling.endMs,
      seconds: stretchSeconds - 3,
      costMs: 3,
    })
    expect(early.steps).toEqual([])
    const late = feed({
      governor,
      fromMs: early.endMs,
      seconds: 6,
      costMs: 3,
    })
    expect(late.steps).toEqual(['Full'])
  })

  test('a tier that proved slow twice takes four times the stretch back', () => {
    const governor = adaptive()
    let atMs = 0
    const slowThenRoomy = (roomySeconds: number) => {
      const slow = feed({ governor, fromMs: atMs, seconds: 6.1, costMs: 20 })
      const roomy = feed({
        governor,
        fromMs: slow.endMs,
        seconds: roomySeconds,
        costMs: 3,
      })
      atMs = roomy.endMs
      return [...slow.steps, ...roomy.steps]
    }
    expect(slowThenRoomy(45)).toEqual(['Light', 'Full'])
    expect(slowThenRoomy(70)).toEqual(['Light'])
    expect(
      feed({ governor, fromMs: atMs, seconds: 15, costMs: 3 }).steps,
    ).toEqual(['Full'])
  })

  test('with no GPU timer, dropped frames step down too', () => {
    const governor = adaptive()
    const { steps } = feed({
      governor,
      fromMs: 0,
      seconds: 4.5,
      costMs: 4,
      hasGpuTimer: false,
      gapMs: 33,
    })
    expect(steps).toEqual(['Light'])
  })

  test('with a GPU timer, a slow main thread alone never steps down', () => {
    const governor = adaptive()
    const { steps } = feed({
      governor,
      fromMs: 0,
      seconds: 10,
      costMs: 4,
      hasGpuTimer: true,
      gapMs: 33,
    })
    expect(steps).toEqual([])
  })

  test('a long gap is a page put away, never a slow frame', () => {
    const governor = adaptive()
    const { steps } = feed({
      governor,
      fromMs: 0,
      seconds: 10,
      costMs: 4,
      hasGpuTimer: false,
      gapMs: 400,
    })
    expect(steps).toEqual([])
  })
})
