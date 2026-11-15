import { describe, expect, test } from 'vitest'

import { ShadowWatch } from '../shadowWatch'

// NOTE: two fills side by side, each straight down on its own floor.
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

// NOTE: one frame of casters, and which cones the watch says changed.
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
    // NOTE: the cone reaches about 6.2 either way on the floor; this sphere's
    // middle stands outside it and its edge inside.
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
})
