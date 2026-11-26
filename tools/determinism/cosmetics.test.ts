import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import { type Model, stillShake } from '../../src/app/model'
import { firstDivergentCheckpoint } from './diff'
import { runScript } from './run'

const stripCosmetics = (model: Model): Model =>
  UiStruct.evolve(model, {
    shake: () => stillShake,
    cosmetics: UiStruct.evolve({
      particles: () => [],
      decals: () => [],
      dustCooldownMs: () => 0,
      popups: () => [],
      blasts: () => [],
      callouts: () => [],
    }),
  })

describe('cosmetics', () => {
  test('stripping every cosmetic each frame leaves the gameplay hash alone', () => {
    const options = {
      seed: 7,
      frames: 1500,
      mode: 'Campaign',
      pattern: 'Fixed60',
      every: 1,
      cached: true,
    } as const
    const full = runScript(options)
    const stripped = runScript({ ...options, afterFrame: stripCosmetics })
    expect(full.frames).toBeGreaterThan(600)
    expect(
      firstDivergentCheckpoint(full.checkpoints, stripped.checkpoints),
    ).toBe(undefined)
  })
})
