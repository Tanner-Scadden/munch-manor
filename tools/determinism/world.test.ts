// The World split (MULTIPLAYER.md, Phase 0, step 6). stepWorld must run on
// a World alone, with no client field in it, the way a co-op room holds
// it, and play exactly what the client's frame loop plays.

import { Array, Record, Struct } from 'effect'
import { describe, expect, test } from 'vitest'

import { refreshIntent } from '../../src/app/frame'
import type { Model } from '../../src/app/model'
import { WORLD_KEYS } from '../../src/test/testing'
import { focusOf } from '../../src/world/party/party'
import type { World } from '../../src/world/schema/world'
import { soloInputs, stepWorld } from '../../src/world/step/stepWorld'
import { firstDifference } from './diff'
import { FIELD_CLASSES } from './fields'
import { playFrame, startedRun } from './script'

const worldOf = (model: Model): World => Struct.pick(model, WORLD_KEYS)

describe('the World', () => {
  test('every World field is hashed as World, or derived from it', () => {
    const classes = new Map<string, string>(Record.toEntries(FIELD_CLASSES))
    const misfiled = Array.filter(
      WORLD_KEYS,
      key => classes.get(key) !== 'World' && classes.get(key) !== 'Derived',
    )
    expect(misfiled).toEqual([])
    const outside = Array.filter(
      Array.map(
        Array.filter(
          [...classes.entries()],
          ([, fieldClass]) => fieldClass === 'World',
        ),
        ([key]) => key,
      ),
      key => !Array.some(WORLD_KEYS, worldKey => worldKey === key),
    )
    expect(outside).toEqual([])
  })

  test('stepWorld on a bare World plays what the client plays', () => {
    const played = Array.reduce(
      globalThis.Array.from({ length: 900 }),
      startedRun(9, 'Campaign'),
      (model, _, frame) => playFrame(model, frame, 'Fixed60'),
    )
    const intended = refreshIntent(played)
    const bare = stepWorld(
      worldOf(intended),
      soloInputs(focusOf(intended).intent),
    )
    const full = stepWorld(intended, soloInputs(focusOf(intended).intent))
    expect(Record.keys(bare.world).sort()).toEqual([...WORLD_KEYS].sort())
    expect(
      firstDifference(
        Struct.pick(bare.world, WORLD_KEYS),
        Struct.pick(full.world, WORLD_KEYS),
      ),
    ).toBe(undefined)
  })

  test('a bare World plays a whole minute on its own', () => {
    const start = refreshIntent(startedRun(4, 'Campaign'))
    const world = Array.reduce(
      globalThis.Array.from({ length: 3600 }),
      worldOf(start),
      current => stepWorld(current, soloInputs(focusOf(start).intent)).world,
    )
    expect(Record.keys(world).sort()).toEqual([...WORLD_KEYS].sort())
    expect(world.elapsedMs).toBeGreaterThan(0)
  })
})
