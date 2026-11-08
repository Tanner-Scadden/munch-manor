import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { randoms, zombieOf } from '../../../test/testing'
import type { Vector, Zombie, ZombieKind } from '../../schema/worldSchema'
import { separationPushes } from '../zombieMotion'
import { bodyRadiusOf, isGrounded, statsOf } from '../zombies'

// The all-pairs rule the crowd's columns replaced, written out plainly: every
// grounded zombie sums the pushes of every grounded zombie in list order.
const pushApart = (zombie: Zombie, other: Zombie): Vector | undefined => {
  const deltaX = zombie.x - other.x
  const deltaY = zombie.y - other.y
  const distance = Math.hypot(deltaX, deltaY)
  const reach = bodyRadiusOf(zombie) + bodyRadiusOf(other)
  if (other.id === zombie.id || distance >= reach) {
    return undefined
  }
  const mass = statsOf(zombie).mass
  const otherMass = statsOf(other).mass
  const share = (2 * otherMass) / (mass + otherMass)
  const strength = ((reach - distance) / reach) * share
  return distance > 0
    ? { x: (deltaX / distance) * strength, y: (deltaY / distance) * strength }
    : { x: zombie.id < other.id ? -strength : strength, y: 0 }
}

const allPairs = (zombies: ReadonlyArray<Zombie>): ReadonlyArray<Vector> =>
  Array.map(zombies, zombie => {
    if (!isGrounded(zombie)) {
      return { x: 0, y: 0 }
    }
    let pushX = 0
    let pushY = 0
    for (const other of zombies) {
      const push = isGrounded(other) ? pushApart(zombie, other) : undefined
      if (push !== undefined) {
        pushX += push.x
        pushY += push.y
      }
    }
    return { x: pushX, y: pushY }
  })

const KINDS: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
]

const crowd = (seed: number, count: number, spread: number): Array<Zombie> => {
  const next = randoms(seed)
  return globalThis.Array.from({ length: count }, (_, index) => {
    const kind = KINDS[Math.floor(next() * KINDS.length)] ?? 'Shambler'
    return zombieOf(kind, 100 + index, next() * spread, next() * spread)
  })
}

const asZero = (value: number): number => (Object.is(value, -0) ? 0 : value)

describe('separation', () => {
  for (const [name, count, spread] of [
    ['a crowd packed tight', 150, 120],
    ['a crowd in a room', 90, 320],
    ['a few far apart', 12, 4000],
  ] as const) {
    test(`the columns push as the all-pairs rule does, bit for bit: ${name}`, () => {
      const zombies = crowd(count + spread, count, spread)
      const pushes = separationPushes(zombies)
      const wanted = allPairs(zombies)
      expect(pushes.length).toBe(wanted.length)
      Array.forEach(pushes, (push, index) => {
        expect(asZero(push.x)).toBe(asZero(wanted[index]?.x ?? NaN))
        expect(asZero(push.y)).toBe(asZero(wanted[index]?.y ?? NaN))
      })
    })
  }

  test('two bodies on the same spot part by id, and one that is not grounded pushes nothing', () => {
    const first = zombieOf('Shambler', 1, 50, 50)
    const second = zombieOf('Shambler', 2, 50, 50)
    const [firstPush, secondPush] = separationPushes([first, second])
    expect(firstPush?.x).toBeLessThan(0)
    expect(secondPush?.x).toBeGreaterThan(0)
    expect(separationPushes([first, { ...second, hp: 0 }]).length).toBe(2)
  })
})
