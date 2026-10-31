// The World split (MULTIPLAYER.md, Phase 0, step 6). stepWorld must run on
// a World alone, with no client field in it, the way a co-op room holds
// it, and play exactly what the client's frame loop plays.

import { Struct } from 'effect'
import { describe, expect, test } from 'vitest'

import { refreshIntent } from '../../src/frame'
import type { Model } from '../../src/model'
import { soloInputs, stepWorld } from '../../src/stepWorld'
import { WORLD_KEYS } from '../../src/testing'
import type { World } from '../../src/world'
import { firstDifference } from './diff'
import { FIELD_CLASSES } from './fields'
import { playFrame, startedRun } from './script'

const worldOf = (model: Model): World => Struct.pick(model, WORLD_KEYS)

describe('the World', () => {
  test('every World field is hashed as World, or derived from it', () => {
    const classes = new Map<string, string>(Object.entries(FIELD_CLASSES))
    const misfiled = WORLD_KEYS.filter(
      key => classes.get(key) !== 'World' && classes.get(key) !== 'Derived',
    )
    expect(misfiled).toEqual([])
    const outside = [...classes.entries()]
      .filter(([, fieldClass]) => fieldClass === 'World')
      .map(([key]) => key)
      .filter(key => !WORLD_KEYS.some(worldKey => worldKey === key))
    expect(outside).toEqual([])
  })

  test('stepWorld on a bare World plays what the client plays', () => {
    const played = Array.from({ length: 900 }).reduce<Model>(
      (model, _, frame) => playFrame(model, frame, 'Fixed60'),
      startedRun(9, 'Campaign'),
    )
    const intended = refreshIntent(played)
    const bare = stepWorld(worldOf(intended), soloInputs(intended.intent))
    const full = stepWorld(intended, soloInputs(intended.intent))
    expect(Object.keys(bare.world).sort()).toEqual([...WORLD_KEYS].sort())
    expect(
      firstDifference(
        Struct.pick(bare.world, WORLD_KEYS),
        Struct.pick(full.world, WORLD_KEYS),
      ),
    ).toBe(undefined)
  })

  test('a bare World plays a whole minute on its own', () => {
    const start = refreshIntent(startedRun(4, 'Campaign'))
    const world = Array.from({ length: 3600 }).reduce<World>(
      current => stepWorld(current, soloInputs(start.intent)).world,
      worldOf(start),
    )
    expect(Object.keys(world).sort()).toEqual([...WORLD_KEYS].sort())
    expect(world.elapsedMs).toBeGreaterThan(0)
  })
})
