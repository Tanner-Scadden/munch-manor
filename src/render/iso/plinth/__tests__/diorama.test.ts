import { describe, expect, test } from 'vitest'

import * as Draw from '#render/draw.ts'
import { dioramaCameraOf, dioramaStepOf } from '#render/iso/plinth/diorama.ts'
import { plinthFrameOf } from '#render/iso/plinth/plinthPose.ts'
import { PITCH, UNIT } from '#render/iso/space.ts'

const TARGET = { x: 10, y: 0, z: 20 }

const cameraAt = (clockMs: number, isStill: boolean) =>
  dioramaCameraOf({
    clockMs,
    isStill,
    target: TARGET,
    centerX: 100,
    centerY: 80,
    canvasWidth: 320,
    canvasHeight: 180,
  })

describe('the diorama', () => {
  test('a canvas pixel covers half the play camera game pixel, whole', () => {
    expect(dioramaStepOf(6)).toBe(3)
    expect(dioramaStepOf(4)).toBe(2)
    expect(dioramaStepOf(3)).toBe(1)
    expect(dioramaStepOf(1)).toBe(1)
  })

  test('shows one game pixel to a canvas pixel', () => {
    expect(cameraAt(0, false).orthographicSize).toBeCloseTo((320 * UNIT) / 2)
  })

  test('swings round the house as its clock runs, at the play pitch', () => {
    const start = cameraAt(0, false)
    const later = cameraAt(12_000, false)
    expect(later.position.x).not.toBeCloseTo(start.position.x)
    const rise = later.position.y - TARGET.y
    const across = Math.hypot(
      later.position.x - TARGET.x,
      later.position.z - TARGET.z,
    )
    expect(Math.atan2(rise, across)).toBeCloseTo(PITCH)
  })

  test('holds still with reduced motion', () => {
    expect(cameraAt(0, true).position).toEqual(cameraAt(31_000, true).position)
  })

  test('culls to the floor any turn could show', () => {
    expect(cameraAt(0, false).view).toEqual({
      left: -220,
      top: -240,
      right: 420,
      bottom: 400,
    })
  })
})

describe('the plinth', () => {
  const image = (width: number, height: number) =>
    Draw.Image({
      src: 'a.png',
      x: -width / 2,
      y: -height,
      width,
      height,
      rendering: 'Pixelated',
    })

  test('its picture is square, even, and holds the sprite on its plinth', () => {
    const tall = plinthFrameOf(image(10, 14))
    expect(tall.size % 2).toBe(0)
    expect(tall.size).toBeGreaterThanOrEqual(14 + 6)
    const boss = plinthFrameOf(image(30, 40))
    expect(boss.size % 2).toBe(0)
    expect(boss.size).toBeGreaterThan(tall.size)
  })

  test('the figure fills most of its frame, the plinth below it', () => {
    const boss = plinthFrameOf(image(30, 40))
    expect(40 / boss.size).toBeGreaterThan(0.75)
    expect(boss.middle + boss.size / 2).toBeGreaterThanOrEqual(40)
    expect(boss.size / 2 - boss.middle).toBeLessThan(12)
  })
})
