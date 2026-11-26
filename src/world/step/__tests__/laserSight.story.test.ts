import { Array, Effect } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import type { Model } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { SHOTGUN, holdingSecond } from '../../../test/arsenals'
import { quietWave, withArsenal } from '../../../test/model.fixture'
import { holdFire, modelAfter, steps, tick } from '../../../test/testing'
import { LASER_SPREAD_SCALE } from '../../gear/powerups'
import { modifyFocus } from '../../party/party'

const shotgunReady = (laserSight: 'None' | 'Fitted'): Model =>
  modifyFocus(withArsenal(quietWave(2), holdingSecond(SHOTGUN)), {
    laserSight: () => laserSight,
  })

const coneOf = (laserSight: 'None' | 'Fitted') =>
  modelAfter(
    shotgunReady(laserSight),
    steps(holdFire, tick(FIXED_STEP_MS)),
  ).pipe(
    Effect.map(({ bullets }) => {
      const angles = Array.map(bullets, ({ velocityX, velocityY }) =>
        Math.atan2(velocityY, velocityX),
      )
      return {
        pellets: bullets.length,
        width: Math.max(...angles) - Math.min(...angles),
      }
    }),
  )

describe('the Laser Sight', () => {
  it.effect('narrows a scattering gun’s cone', () =>
    Effect.gen(function* () {
      const bare = yield* coneOf('None')
      const sighted = yield* coneOf('Fitted')
      expect(bare.pellets).toBeGreaterThan(1)
      expect(sighted.pellets).toBe(bare.pellets)
      expect(bare.width).toBeGreaterThan(0)
      expect(sighted.width).toBeCloseTo(bare.width * LASER_SPREAD_SCALE, 5)
    }),
  )
})
