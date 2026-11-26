import { Array, Option } from 'effect'
import { expect, test } from 'vitest'

import type { Model } from '#app/model.ts'
import { strikeOf } from '#render/iso/mood.ts'
import { FAR_KEY, stormKeyOf, stormOf } from '#render/iso/storm.ts'
import type { Box } from '#render/room/roomPalette.ts'
import { windowPanesOf } from '#render/room/windows.ts'
import { atClock, quietWave } from '#test/model.fixture.ts'
import { rectsOf } from '#test/viewReading.ts'
import { levelOf } from '#world/level/arena.ts'

const rainAt = (model: Model, ms: number) => {
  const world = atClock(model, ms)
  return rectsOf(stormOf({ world, level: levelOf(world) }), { x: 0, y: 0 })
}

const wave = quietWave(4)
const level = levelOf(wave)
const panes = windowPanesOf(level)

const isInside = ({ x, y, width, height }: Box, box: Box): boolean =>
  x >= box.x &&
  y >= box.y &&
  x + width <= box.x + box.width &&
  y + height <= box.y + box.height

const clocks = Array.makeBy(30_000 / 10, index => index * 10)
const calm = Option.getOrThrow(
  Array.findFirst(clocks, ms => strikeOf(atClock(wave, ms)) === 0),
)
const struck = Option.getOrThrow(
  Array.findFirst(clocks, ms => strikeOf(atClock(wave, ms)) === 1),
)

test('every window the house draws has its glass, and its light falls below it', () => {
  expect(panes.length).toBeGreaterThanOrEqual(3)
  Array.forEach(panes, ({ glass, thrown }) => {
    expect(glass.width * glass.height).toBeGreaterThan(0)
    expect(thrown.width * thrown.height).toBeGreaterThan(0)
  })
})

test('the rain runs down the glass alone, the same for the same clock', () => {
  const rain = rainAt(wave, calm)
  expect(rain.length).toBeGreaterThan(0)
  expect(
    Array.every(rain, streak =>
      Array.some(panes, ({ glass }) => isInside(streak, glass)),
    ),
  ).toBe(true)
  expect(rainAt(wave, calm)).toEqual(rain)
  expect(rainAt(wave, calm + 100)).not.toEqual(rain)
})

test('a strike flashes the glass and throws its light on the floor', () => {
  const flashed = rainAt(wave, struck)
  Array.forEach(panes, ({ kind, lights, thrown }) => {
    Array.forEach(lights, light =>
      expect(
        Array.some(
          flashed,
          shape =>
            shape.x === light.x &&
            shape.y === light.y &&
            shape.width === light.width &&
            shape.height === light.height,
        ),
      ).toBe(true),
    )
    expect(
      Array.some(
        flashed,
        shape => isInside(shape, thrown) && shape.y >= thrown.y,
      ),
    ).toBe(kind !== 'Rose')
  })
  expect(Array.some(panes, ({ kind }) => kind === 'Rose')).toBe(true)
  expect(
    Array.some(rainAt(wave, calm), shape =>
      Array.some(panes, ({ thrown }) => isInside(shape, thrown)),
    ),
  ).toBe(false)
})

test("the rose window's strike and rain stay on its colored glass, off its lead and stone", () => {
  const rose = Option.getOrThrow(
    Array.findFirst(panes, ({ kind }) => kind === 'Rose'),
  )
  const onRose = (ms: number) =>
    Array.filter(rainAt(wave, ms), shape => isInside(shape, rose.glass))
  const isOnGlass = (shape: Box): boolean =>
    Array.some(rose.lights, light => isInside(shape, light)) ||
    (shape.width === 1 &&
      Array.every(
        Array.makeBy(shape.height, step => shape.y + step),
        row =>
          Array.some(rose.lights, light =>
            isInside({ ...shape, y: row, height: 1 }, light),
          ),
      ))
  const shapes = [...onRose(calm), ...onRose(struck)]
  expect(Array.some(onRose(struck), shape => shape.width > 1)).toBe(true)
  expect(Array.every(shapes, isOnGlass)).toBe(true)
  expect(
    Array.some(
      onRose(struck),
      ({ width, height }) =>
        width === rose.glass.width && height === rose.glass.height,
    ),
  ).toBe(false)
})

test('the rain keeps still while no window is near the viewer', () => {
  const near = Option.getOrThrow(Array.head(panes)).glass
  const keyAt = (ms: number, viewer: Readonly<{ x: number; y: number }>) =>
    stormKeyOf({ world: atClock(wave, ms), level, viewer })
  expect(keyAt(calm, near)).not.toBe(keyAt(calm + 100, near))
  const far = { x: near.x + 2000, y: near.y }
  expect(keyAt(calm, far)).toBe(FAR_KEY)
  expect(keyAt(struck, far)).toBe(FAR_KEY)
})
