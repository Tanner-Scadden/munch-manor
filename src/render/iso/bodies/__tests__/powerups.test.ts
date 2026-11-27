import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { AURA_FRAME_COUNT, AURA_SPRITES } from '#art/sprites/auras.ts'
import { PICKUP_SPRITES } from '#art/sprites/pickups.ts'
import type * as Draw from '#render/draw.ts'
import {
  auraCubesOf,
  auraFrameOf,
  isPowerupImage,
  pickupRingOf,
  pickupSpinOf,
} from '#render/iso/bodies/powerups.ts'

const FEET = { x: 160, y: 120 }

const imageOf = (
  sprite: ReadonlyArray<Draw.Shape>,
): Option.Option<Draw.Image> =>
  Array.findFirst(
    sprite,
    (shape): shape is Draw.Image => shape._tag === 'Image',
  )

describe('the aura in 3D', () => {
  test('every aura frame is known by its image', () => {
    Array.forEach(AURA_SPRITES.Damage, (sprite, frame) => {
      expect(Option.flatMap(imageOf(sprite), auraFrameOf)).toEqual(
        Option.some({ kind: 'Damage', frame }),
      )
    })
  })

  test('a power-up on the floor is known by its image, an aura is not', () => {
    expect(Option.map(imageOf(PICKUP_SPRITES.Speed), isPowerupImage)).toEqual(
      Option.some(true),
    )
    expect(Option.map(imageOf(AURA_SPRITES.Speed[0]), isPowerupImage)).toEqual(
      Option.some(false),
    )
  })

  test('the silver ring stands on the floor round the feet, in front and behind', () => {
    const cubes = auraCubesOf({ kind: 'Damage', frame: 0, feet: FEET })
    const onFloor = Array.filter(cubes, cube => cube.rise === 0)
    expect(Array.some(onFloor, cube => cube.footY < FEET.y)).toBe(true)
    expect(Array.some(onFloor, cube => cube.footY > FEET.y)).toBe(true)
    expect(Array.some(onFloor, cube => cube.x < FEET.x - 8)).toBe(true)
    expect(Array.some(onFloor, cube => cube.x > FEET.x + 8)).toBe(true)
  })

  test('the notes hang in the air over the feet', () => {
    const cubes = auraCubesOf({ kind: 'Speed', frame: 4, feet: FEET })
    const aloft = Array.filter(cubes, cube => cube.rise > 4)
    expect(aloft.length).toBeGreaterThan(0)
    expect(Array.every(aloft, cube => cube.footY === FEET.y)).toBe(true)
  })

  test('every frame of every boost stands some blocks', () => {
    Array.forEach(['RapidFire', 'Damage', 'Speed', 'Pierce'] as const, kind =>
      Array.forEach(Array.range(0, AURA_FRAME_COUNT - 1), frame => {
        expect(auraCubesOf({ kind, frame, feet: FEET }).length).toBeGreaterThan(
          0,
        )
      }),
    )
  })
})

describe('a goodie in 3D', () => {
  test('it spins a whole turn and two side by side turn apart', () => {
    const at = (elapsedMs: number, x: number) => pickupSpinOf({ elapsedMs, x })
    expect(at(0, 0)).toBe(0)
    expect(at(1200, 0)).toBeCloseTo(Math.PI, 6)
    expect(at(0, 40)).not.toBeCloseTo(at(0, 80), 3)
  })

  test('its ring of light lies round it on the floor', () => {
    const ring = pickupRingOf({
      x: 100,
      footY: 80,
      radius: 7,
      color: 0xffd23f,
      elapsedMs: 500,
    })
    expect(ring.length).toBe(10)
    expect(Array.every(ring, cube => cube.rise === 0)).toBe(true)
    expect(
      Array.every(
        ring,
        cube => Math.abs(cube.x - 100) <= 7 && Math.abs(cube.footY - 80) <= 4,
      ),
    ).toBe(true)
  })
})
