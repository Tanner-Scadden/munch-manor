import { Array, Option, String } from 'effect'

import { describe, expect, it, test } from '@effect/vitest'

import { levelPopLines } from '../../../render/powerupView'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { gunAt, holdingSecond } from '../../../test/arsenals'
import { killShot, spareGunOf } from '../../../test/model.fixture'
import {
  checkModel,
  modelAfter,
  steps,
  tick,
  ticks,
} from '../../../test/testing'
import { isJustLeveled, maybeLevelBarOf } from '../hud'

describe("a gun slot's level bar", () => {
  test('fills from the last tier to the next, full once maxed', () => {
    expect(maybeLevelBarOf(gunAt('Smg', 0, 0))).toEqual(
      Option.some({ share: 0, isMaxed: false }),
    )
    expect(maybeLevelBarOf(gunAt('Smg', 0, 20))).toEqual(
      Option.some({ share: 0.5, isMaxed: false }),
    )
    expect(maybeLevelBarOf(gunAt('Smg', 1, 80))).toEqual(
      Option.some({ share: 0.5, isMaxed: false }),
    )
    expect(maybeLevelBarOf(gunAt('Smg', 3, 300))).toEqual(
      Option.some({ share: 1, isMaxed: true }),
    )
    expect(maybeLevelBarOf(gunAt('Freeze', 0, 50))).toEqual(Option.none())
  })

  it.effect('a kill moves the bar of the gun that made it', () =>
    modelAfter(
      killShot(holdingSecond(gunAt('Smg', 0, 19)), 'Smg'),
      steps(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(maybeLevelBarOf(spareGunOf(current))).toEqual(
            Option.some({ share: 0.5, isMaxed: false }),
          )
        }),
      ),
    ),
  )
})

describe('the level up', () => {
  it.effect('the 40th kill flashes the slot, then the flash stops', () =>
    modelAfter(
      killShot(holdingSecond(gunAt('Smg', 0, 39)), 'Smg'),
      steps(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(spareGunOf(current).tier).toBe(1)
          expect(isJustLeveled(current, spareGunOf(current))).toBe(true)
          expect(maybeLevelBarOf(spareGunOf(current))).toEqual(
            Option.some({ share: 0, isMaxed: false }),
          )
        }),
        ticks(60, FIXED_STEP_MS),
        checkModel(current => {
          expect(isJustLeveled(current, spareGunOf(current))).toBe(false)
        }),
      ),
    ),
  )

  test('the pop reads the tier word, the new name, and what changed, in capitals', () => {
    const lines = levelPopLines('Smg', 1)
    expect(lines.word).toBe('BEEFY!')
    expect(lines.name).toBe('BEEFY CHATTERBOX')
    expect(levelPopLines('Smg', 3).word).toBe('3000!')
    Array.forEach([1, 2, 3], tier => {
      const { word, name, change } = levelPopLines('Rifle', tier)
      Array.forEach([word, name, change], line => {
        expect(line).toBe(String.toUpperCase(line))
        expect(line.length).toBeGreaterThan(0)
      })
    })
  })
})
