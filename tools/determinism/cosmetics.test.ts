// Cosmetics never steer gameplay (MULTIPLAYER.md, Phase 0, step 1). Two runs
// replay the same script; the second throws away every cosmetic after each
// frame, as a room that makes no particles or a phone that makes fewer would.
// The gameplay hash must agree on every frame.

import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { type Model, stillShake } from '../../src/app/model'
import { firstDivergentCheckpoint } from './diff'
import { runScript } from './run'

const stripCosmetics = (model: Model): Model =>
  modifyFields(model, {
    particles: () => [],
    decals: () => [],
    dustCooldownMs: () => 0,
    shake: () => stillShake,
    popups: () => [],
    blasts: () => [],
    callouts: () => [],
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
