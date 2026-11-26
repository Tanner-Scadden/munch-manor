import { Array } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ShadowWatch } from '../shadowWatch'

const CONES = [
  {
    from: { x: 0, y: 10, z: 0 },
    to: { x: 0, y: 0, z: 0 },
    coneAngle: 30,
    range: 20,
  },
  {
    from: { x: 40, y: 10, z: 0 },
    to: { x: 40, y: 0, z: 0 },
    coneAngle: 30,
    range: 20,
  },
]

const ZOMBIE = {}
const CRATE = {}
const SPHERE = { center: { x: 0, y: 0, z: 0 }, radius: 1 }

const at = (x: number, z = 0): ReadonlyArray<number> => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  0,
  z,
  1,
]

type Cast = Readonly<{ shape: object; x: number; z?: number }>

const frame = (
  watch: ShadowWatch,
  casts: ReadonlyArray<Cast>,
  key = 0,
): ReadonlyArray<boolean> => {
  watch.begin()
  for (const { shape, x, z } of casts) {
    watch.cast({ shape, elements: at(x, z), ...SPHERE })
  }
  watch.note(key)
  watch.end()
  return [watch.isChanged(0), watch.isChanged(1)]
}

const watching = (): ShadowWatch => {
  const watch = new ShadowWatch()
  watch.watch(CONES)
  return watch
}

describe('the shadow watch', () => {
  test('a cone draws again only when a caster in it moves', () => {
    const watch = watching()
    frame(watch, [{ shape: ZOMBIE, x: 1 }])
    expect(frame(watch, [{ shape: ZOMBIE, x: 1 }])).toEqual([false, false])
    expect(frame(watch, [{ shape: ZOMBIE, x: 2 }])).toEqual([true, false])
    expect(frame(watch, [{ shape: ZOMBIE, x: 2 }])).toEqual([false, false])
  })

  test('a caster walking from one cone to the next changes both', () => {
    const watch = watching()
    frame(watch, [{ shape: ZOMBIE, x: 1 }])
    expect(frame(watch, [{ shape: ZOMBIE, x: 39 }])).toEqual([true, true])
  })

  test('a caster far from every cone changes none', () => {
    const watch = watching()
    frame(watch, [{ shape: ZOMBIE, x: 1 }])
    expect(
      frame(watch, [
        { shape: ZOMBIE, x: 1 },
        { shape: CRATE, x: 20 },
      ]),
    ).toEqual([false, false])
  })

  test('the same casters in another order change nothing', () => {
    const watch = watching()
    frame(watch, [
      { shape: ZOMBIE, x: 1 },
      { shape: CRATE, x: 2 },
    ])
    expect(
      frame(watch, [
        { shape: CRATE, x: 2 },
        { shape: ZOMBIE, x: 1 },
      ]),
    ).toEqual([false, false])
  })

  test('another shape in the same spot, or one gone, changes its cone', () => {
    const watch = watching()
    frame(watch, [{ shape: ZOMBIE, x: 1 }])
    expect(frame(watch, [{ shape: CRATE, x: 1 }])).toEqual([true, false])
    expect(frame(watch, [])).toEqual([true, false])
  })

  test('a body reaching in from outside the cone counts', () => {
    const watch = watching()
    frame(watch, [])
    expect(frame(watch, [{ shape: ZOMBIE, x: -6.3 }])).toEqual([true, false])
  })

  test('a shared key changes every cone', () => {
    const watch = watching()
    frame(watch, [], 3)
    expect(frame(watch, [], 3)).toEqual([false, false])
    expect(frame(watch, [], 4)).toEqual([true, true])
  })

  test('a new level draws every cone once', () => {
    const watch = watching()
    expect([watch.isChanged(0), watch.isChanged(1)]).toEqual([true, true])
    expect(frame(watch, [{ shape: ZOMBIE, x: 1 }])).toEqual([true, true])
    expect(frame(watch, [{ shape: ZOMBIE, x: 1 }])).toEqual([false, false])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const isInConePlainly = (
    cone: (typeof CONES)[number],
    x: number,
    y: number,
    z: number,
    radius: number,
  ): boolean => {
    const axis = {
      x: cone.to.x - cone.from.x,
      y: cone.to.y - cone.from.y,
      z: cone.to.z - cone.from.z,
    }
    const length = Math.hypot(axis.x, axis.y, axis.z)
    const dx = x - cone.from.x
    const dy = y - cone.from.y
    const dz = z - cone.from.z
    const distance = Math.hypot(dx, dy, dz)
    if (distance <= radius) {
      return true
    }
    if (distance - radius > cone.range) {
      return false
    }
    const cos = (dx * axis.x + dy * axis.y + dz * axis.z) / (distance * length)
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)))
    const half = ((cone.coneAngle + 2) * Math.PI) / 180
    return angle <= half + Math.asin(radius / distance)
  }

  test('a cone holds the casters the plain angles put in it', () => {
    const watch = watching()
    for (let x = -12; x <= 52; x += 1.37) {
      for (let y = -4; y <= 26; y += 2.9) {
        for (const radius of [0.4, 1.5, 4]) {
          const elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0.3, 1]
          watch.begin()
          watch.end()
          watch.begin()
          watch.cast({
            shape: ZOMBIE,
            elements,
            center: { x: 0, y: 0, z: 0 },
            radius,
          })
          watch.end()
          const seen = [watch.isChanged(0), watch.isChanged(1)]
          const grown = radius * Math.sqrt(3)
          expect(seen, `${x}, ${y}, ${radius}`).toEqual(
            Array.map(CONES, cone => isInConePlainly(cone, x, y, 0.3, grown)),
          )
        }
      }
    }
  })

  test('a cast calls no acos, asin, or hypot', () => {
    const watch = watching()
    const calls = [
      vi.spyOn(Math, 'acos'),
      vi.spyOn(Math, 'asin'),
      vi.spyOn(Math, 'hypot'),
    ]
    frame(watch, [
      { shape: ZOMBIE, x: 1 },
      { shape: CRATE, x: 7 },
      { shape: ZOMBIE, x: 39 },
      { shape: CRATE, x: 20 },
    ])
    expect(Array.map(calls, call => call.mock.calls.length)).toEqual([0, 0, 0])
  })
})
