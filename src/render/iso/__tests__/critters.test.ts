import { Array } from 'effect'
import { expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../../app/model'
import { atClock, quietWave } from '../../../test/model.fixture'
import { levelOf } from '../../../world/level/arena'
import { CHANDELIER_DROP } from '../../../world/level/plan'
import { crittersOf } from '../critters'

// The manor's small lives (src/render/iso/critters.ts): moths circling the
// lit flames, read off the World's clock alone.

const mothsAt = (model: Model, ms: number) => {
  const world = atClock(model, ms)
  return crittersOf({ world, level: levelOf(world) })
}

test('moths circle the lit flames, the same for the same clock', () => {
  const wave = quietWave(3)
  const moths = mothsAt(wave, 4000)
  expect(moths.length).toBeGreaterThan(0)
  expect(mothsAt(wave, 4000)).toEqual(moths)
  expect(mothsAt(wave, 4300)).not.toEqual(moths)
})

test('the chandelier brought down takes its moths with it', () => {
  const wave = quietWave(3)
  const fallen = UiStruct.evolve(wave, {
    level: state => ({
      ...state,
      dropped: Array.append(state.dropped, CHANDELIER_DROP),
    }),
  })
  expect(mothsAt(fallen, 4000).length).toBeLessThan(mothsAt(wave, 4000).length)
})
