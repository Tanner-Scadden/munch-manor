import { Array, Option, String } from 'effect'
import { expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import type * as Draw from '#render/draw.ts'
import {
  dripsOf,
  maybeDripHeard,
  puddleGlintsOf,
  puddleKeyOf,
  puddlesOf,
} from '#render/iso/leaks.ts'
import { strikeOf } from '#render/iso/mood.ts'
import { atClock, quietWave } from '#test/model.fixture.ts'
import { rectsOf } from '#test/viewReading.ts'
import { levelOf, openExitIn } from '#world/level/arena.ts'
import { leaksOf } from '#world/level/leaks.ts'
import { EAST_EXIT, FAR_EXIT } from '#world/level/plan.ts'

const wave = atClock(quietWave(5), 0)
const manor = levelOf(wave)

test('the puddles lie in whole pixels', () => {
  const rects = rectsOf(puddlesOf(manor), { x: 0, y: 0 })
  expect(rects.length).toBeGreaterThan(0)
  Array.forEach(rects, ({ x, y, width, height }) => {
    Array.forEach([x, y, width, height], value => {
      expect(Number.isInteger(value)).toBe(true)
    })
  })
})

test('a drop falls in whole pixels and lands where it is heard', () => {
  const leak = Option.getOrThrow(Array.head(leaksOf(manor)))
  const clocks = Array.makeBy(4000 / 16, index => index * 16)
  const drops = Array.flatMap(clocks, ms =>
    dripsOf({ world: atClock(wave, ms), level: manor }),
  )
  expect(drops.length).toBeGreaterThan(0)
  Array.forEach(drops, ({ x, y, hover }) => {
    Array.forEach([x, y, hover], value => {
      expect(Number.isInteger(value)).toBe(true)
    })
  })
  const heard = Array.getSomes(
    Array.map(Array.drop(clocks, 1), (ms, index) =>
      maybeDripHeard({
        world: atClock(wave, ms),
        level: manor,
        listener: leak.spot,
        previousMs: Option.getOrThrow(Array.get(clocks, index)),
      }),
    ),
  )
  expect(heard.length).toBeGreaterThan(0)
  expect(Array.some(heard, ({ volume }) => volume > 0.9)).toBe(true)
  const far = maybeDripHeard({
    world: atClock(wave, 4000),
    level: manor,
    listener: { x: leak.spot.x + 2000, y: leak.spot.y },
    previousMs: 0,
  })
  expect(Option.isNone(far)).toBe(true)
})

test('a strike lights the puddles, and only a change paints them again', () => {
  const clocks = Array.makeBy(30_000 / 10, index => index * 10)
  const calm = Option.getOrThrow(
    Array.findFirst(clocks, ms => strikeOf(atClock(wave, ms)) === 0),
  )
  const struck = Option.getOrThrow(
    Array.findFirst(clocks, ms => strikeOf(atClock(wave, ms)) === 1),
  )
  const viewer = { x: 10_000, y: 10_000, facing: { x: 1, y: 0 } }
  const glints = (ms: number) =>
    rectsOf(
      puddleGlintsOf({ world: atClock(wave, ms), level: manor, viewer }),
      { x: 0, y: 0 },
    )
  expect(glints(struck).length).toBeGreaterThan(glints(calm).length)
  const keyAt = (ms: number) =>
    puddleKeyOf({ world: atClock(wave, ms), level: manor, viewer })
  expect(keyAt(calm)).not.toBe(keyAt(struck))
  expect(keyAt(calm)).toBe(keyAt(calm + 10))
})

test('the flashlight catches a cellar puddle in the dark', () => {
  const dark = UiStruct.evolve(quietWave(4), {
    level: state => openExitIn(openExitIn(state, EAST_EXIT), FAR_EXIT),
  })
  const level = levelOf(dark)
  const puddle = Option.getOrThrow(
    Array.findFirst(leaksOf(level), ({ isUnderground }) => isUnderground),
  )
  const viewerFacing = (x: number) => ({
    x: puddle.spot.x - 45,
    y: puddle.spot.y,
    facing: { x, y: 0 },
  })
  const glintsFacing = (x: number) =>
    rectsOf(puddleGlintsOf({ world: dark, level, viewer: viewerFacing(x) }), {
      x: 0,
      y: 0,
    })
  expect(glintsFacing(1).length).toBeGreaterThan(glintsFacing(-1).length)
  const keyFacing = (x: number) =>
    puddleKeyOf({ world: dark, level, viewer: viewerFacing(x) })
  expect(keyFacing(1)).not.toBe(keyFacing(-1))
})

const ringPixelsAt = (ms: number, spot: Readonly<{ x: number; y: number }>) => {
  const keyOf = ({ x, y, width, height, fill }: Draw.Rect) =>
    `${x},${y},${width},${height},${fill}`
  const glints = (at: Readonly<{ x: number; y: number }>) =>
    rectsOf(
      puddleGlintsOf({
        world: atClock(wave, ms),
        level: manor,
        viewer: { ...at, facing: { x: 1, y: 0 } },
      }),
      {
        x: 0,
        y: 0,
      },
    )
  const far = new Set(
    Array.map(glints({ x: 100_000, y: 100_000 }), rect => keyOf(rect)),
  )
  const ring = Array.filter(
    glints(spot),
    rect =>
      !far.has(keyOf(rect)) &&
      Math.abs(rect.y - spot.y) <= 2 &&
      Math.abs(rect.x - spot.x) <= 4,
  )
  return Array.flatMap(ring, ({ x, y, width }) =>
    Array.makeBy(width, along => `${x + along},${y}`),
  )
}

const isOneLoop = (pixels: ReadonlyArray<string>): boolean => {
  const left = new Set(pixels)
  const queue = Array.take(pixels, 1)
  Array.forEach(queue, at => left.delete(at))
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y = 0] = Array.map(String.split(queue[index] ?? '', ','), Number)
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const next = `${x + dx},${y + dy}`
        if (left.delete(next)) {
          queue.push(next)
        }
      }
    }
  }
  return left.size === 0
}

test('a splash ring is one closed loop at every step, never loose dots', () => {
  const leak = Option.getOrThrow(Array.head(leaksOf(manor)))
  const center = `${leak.spot.x},${leak.spot.y}`
  const rings = Array.filter(
    Array.map(
      Array.makeBy(4000 / 10, index => index * 10),
      ms => ringPixelsAt(ms, leak.spot),
    ),
    pixels => pixels.length > 0,
  )
  const shapes = new Set(Array.map(rings, pixels => Array.join(pixels, ' ')))
  expect(shapes.size).toBe(3)
  Array.forEach(rings, pixels => {
    expect(pixels.length).toBeGreaterThanOrEqual(8)
    expect(new Set(pixels).size).toBe(pixels.length)
    expect(pixels).not.toContain(center)
    expect(isOneLoop(pixels)).toBe(true)
  })
})
