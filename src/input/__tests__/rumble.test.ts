import { Option } from 'effect'

import { describe, expect, test } from '@effect/vitest'

import { GameEvent } from '../../world/schema/worldSchema'
import { rumbleOf } from '../rumble'

const PLAYER = { x: 100, y: 100 }

const strengthOf = (events: ReadonlyArray<GameEvent>): number =>
  Option.match(rumbleOf(PLAYER, events), {
    onNone: () => 0,
    onSome: ({ strong }) => strong,
  })

describe('the rumble a frame calls for', () => {
  test('a quiet frame rumbles nothing', () => {
    expect(rumbleOf(PLAYER, [])).toEqual(Option.none())
  })

  test('a bite on your own player rumbles, one on a teammate across the room does not', () => {
    const own = GameEvent.PlayerHurt({
      x: 100,
      y: 101,
      direction: { x: 1, y: 0 },
      source: 'Shambler',
    })
    const teammate = GameEvent.PlayerHurt({
      x: 300,
      y: 100,
      direction: { x: 1, y: 0 },
      source: 'Shambler',
    })
    expect(strengthOf([own])).toBeGreaterThan(0)
    expect(strengthOf([teammate])).toBe(0)
  })

  test('a stomp is felt more the nearer it lands, and not at all far off', () => {
    const stompAt = (x: number) =>
      GameEvent.BossStomped({ x, y: 100, radius: 40 })
    const near = strengthOf([stompAt(110)])
    const farther = strengthOf([stompAt(180)])
    expect(near).toBeGreaterThan(farther)
    expect(farther).toBeGreaterThan(0)
    expect(strengthOf([stompAt(400)])).toBe(0)
  })

  test('the strongest of a frame wins, one rumble a frame', () => {
    const blast = GameEvent.Exploded({ x: 150, y: 100, radius: 30 })
    const stomp = GameEvent.BossStomped({ x: 100, y: 100, radius: 40 })
    expect(strengthOf([blast, stomp])).toBe(strengthOf([stomp]))
  })
})
