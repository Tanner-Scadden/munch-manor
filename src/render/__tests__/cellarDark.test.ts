import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import type { Model } from '../../app/model'
import { quietWave, withPlayerAt } from '../../test/model.fixture'
import { CELLAR_SPOT, zombieAt } from '../../test/testing'
import { openExitIn } from '../../world/level/arena'
import { EAST_EXIT, FAR_EXIT } from '../../world/level/plan'
import { modifyFocus } from '../../world/party/party'
import type { Camera } from '../camera'
import { cellarDarkOf } from '../cellarDark'

// The cellar's dark (src/render/cellarDark.ts): a mask over the part of
// the cellar on the camera, lit round each player, each shot, and the bulb,
// and a zombie out in the dark drawn only as its eyes.

const CELLAR_CAMERA: Camera = {
  x: 680,
  y: 0,
  width: 320,
  height: 180,
  scale: 1,
  left: 0,
  top: 0,
}

const DINING_CAMERA: Camera = { ...CELLAR_CAMERA, x: 20 }

const inCellar = (model: Model): Model =>
  withPlayerAt(
    modifyFields(model, {
      level: state => openExitIn(openExitIn(state, EAST_EXIT), FAR_EXIT),
    }),
    CELLAR_SPOT.x,
    CELLAR_SPOT.y,
  )

const NEAR = zombieAt(1, CELLAR_SPOT.x + 12, CELLAR_SPOT.y)
const FAR_OFF = zombieAt(2, 960, 30)

const darkOf = (model: Model, camera: Camera) => cellarDarkOf(model, camera)

describe('the cellar dark', () => {
  test('is only over the cellar, once it is open and on the camera', () => {
    expect(Option.isNone(darkOf(quietWave(4), CELLAR_CAMERA))).toBe(true)
    expect(Option.isSome(darkOf(inCellar(quietWave(4)), CELLAR_CAMERA))).toBe(
      true,
    )
    expect(Option.isNone(darkOf(inCellar(quietWave(4)), DINING_CAMERA))).toBe(
      true,
    )
  })

  test('costs a few shapes, the pools drawn as crops of baked images', () => {
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4)), CELLAR_CAMERA),
    )
    expect(dark.maskShapes.length).toBeLessThanOrEqual(30)
    expect(
      Array.filter(dark.maskShapes, ({ _tag }) => _tag === 'Image').length,
    ).toBeGreaterThan(0)
  })

  test('hides a zombie out in the dark, and shows its eyes, but not one in the light', () => {
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4)), CELLAR_CAMERA),
    )
    expect(dark.isHidden(NEAR)).toBe(false)
    expect(dark.isHidden(FAR_OFF)).toBe(true)
    expect(dark.eyesShapes([NEAR, FAR_OFF])).toHaveLength(1)
  })

  test('a shot widens the light', () => {
    const edge = zombieAt(3, CELLAR_SPOT.x + 52, CELLAR_SPOT.y)
    const still = Option.getOrThrow(
      darkOf(inCellar(quietWave(4)), CELLAR_CAMERA),
    )
    const firing = Option.getOrThrow(
      darkOf(
        modifyFocus(inCellar(quietWave(4)), {
          player: player =>
            modifyFields(player, { recoilRemainingMs: () => 40 }),
        }),
        CELLAR_CAMERA,
      ),
    )
    expect(still.isHidden(edge)).toBe(true)
    expect(firing.isHidden(edge)).toBe(false)
  })
})
