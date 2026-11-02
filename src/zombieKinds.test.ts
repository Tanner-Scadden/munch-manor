import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { ZombieKind } from './entitySchema'
import { ZOMBIE_KINDS, bodyRadiusOf, radiusOf, statsOf, wearAt } from './zombies'
import { zombieOf } from './testing'

describe('the per-kind tables read by index', () => {
  test.each(ZombieKind.literals)('%s reads its own row', kind => {
    expect(statsOf(zombieOf(kind, 1, 0, 0))).toBe(ZOMBIE_KINDS[kind])
    expect(radiusOf(zombieOf(kind, 1, 0, 0))).toBe(ZOMBIE_KINDS[kind].radius)
    expect(bodyRadiusOf(zombieOf(kind, 1, 0, 0))).toBe(ZOMBIE_KINDS[kind].bodyRadius)
  })

  test.each(ZombieKind.literals)('%s wear counts the stages passed, as filtering did', kind => {
    const { wear } = ZOMBIE_KINDS[kind]
    Array.forEach(Array.range(0, 100), percent => {
      const hp = percent
      const expected = Array.filter(wear, ({ below }) => hp <= 100 * below + 1e-9).length
      expect(wearAt(kind, hp, 100)).toBe(expected)
    })
  })
})
