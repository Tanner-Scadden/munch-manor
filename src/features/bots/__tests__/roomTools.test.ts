import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../../app/model'
import { newPlayerReady, quietWave } from '../../../test/model.fixture'
import { zombieOf } from '../../../test/testing'
import { gapBoxOf } from '../../../world/dining/chandelier'
import { levelOf } from '../../../world/level/arena'
import { CHANDELIER_DROP } from '../../../world/level/plan'
import { CHANDELIER_CROWD, chandelierShot } from '../dareSearch'

const gapOf = (model: Model) => Option.getOrThrow(gapBoxOf(levelOf(model)))

const withCrowd = (model: Model, count: number): Model => {
  const gap = gapOf(model)
  const middle = {
    x: (gap.left + gap.right) / 2,
    y: (gap.top + gap.bottom) / 2,
  }
  return UiStruct.evolve(model, {
    zombies: () =>
      Array.makeBy(count, at =>
        zombieOf('Shambler', 900 + at, middle.x - 4 + at * 4, middle.y),
      ),
  })
}

const southOf = (model: Model) => {
  const gap = gapOf(model)
  return { x: (gap.left + gap.right) / 2, y: gap.bottom + 30 }
}

describe('chandelierShot', () => {
  const wave = quietWave(5)

  test('with a crowd in the gap, it shoots the chandelier down', () => {
    const shot = chandelierShot(
      withCrowd(wave, CHANDELIER_CROWD),
      southOf(wave),
    )
    expect(Option.isSome(shot)).toBe(true)
    expect(Option.getOrThrow(shot).y).toBeLessThan(gapOf(wave).top)
  })

  test('with too few in the gap, it saves it', () => {
    expect(
      chandelierShot(withCrowd(wave, CHANDELIER_CROWD - 1), southOf(wave)),
    ).toEqual(Option.none())
  })

  test('once it is down, there is nothing to shoot', () => {
    const fallen = UiStruct.evolve(withCrowd(wave, CHANDELIER_CROWD), {
      level: state => ({
        ...state,
        dropped: [...state.dropped, CHANDELIER_DROP],
      }),
    })
    expect(chandelierShot(fallen, southOf(wave))).toEqual(Option.none())
  })

  test('in a break, a shot does not drop it', () => {
    expect(
      chandelierShot(
        withCrowd(newPlayerReady, CHANDELIER_CROWD),
        southOf(newPlayerReady),
      ),
    ).toEqual(Option.none())
  })
})
