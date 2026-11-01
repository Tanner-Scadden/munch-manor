import { describe, expect, test } from 'vitest'

import { playerPixels } from './appearance'
import {
  CALLINGS,
  UNLOCK_RANKS,
  callingForRun,
  callingsOpenedBy,
  isCallingUnlocked,
  isPistolBarred,
  killPayFor,
  magazineFor,
  maxHpOf,
  plankPriceFor,
  shopPriceFor,
  speedScaleOf,
  startsWithCooker,
} from './calling'
import { playerOfCalling } from './callingPlayer'
import { PLAYER_MAX_HP } from './constants'
import { defaultAppearance } from './model'
import { initialPlayer } from './worldSchema'

// The callings' rules (src/calling.ts), each a pure function of a calling.

describe('unlocking', () => {
  test('YOU is open at rank 1, the rest at 3, 6, 10, and 15', () => {
    expect(CALLINGS.map(calling => UNLOCK_RANKS[calling])).toEqual([
      1, 3, 6, 10, 15,
    ])
    expect(isCallingUnlocked('Handyman', 2)).toBe(false)
    expect(isCallingUnlocked('Handyman', 3)).toBe(true)
    expect(isCallingUnlocked('LineCook', 14)).toBe(false)
    expect(isCallingUnlocked('LineCook', 15)).toBe(true)
  })

  test('a run starts with a locked calling as YOU', () => {
    expect(callingForRun('TrackStar', 5)).toBe('You')
    expect(callingForRun('TrackStar', 6)).toBe('TrackStar')
  })

  test('a rank up lists the callings it opened', () => {
    expect(callingsOpenedBy(2, 3)).toEqual(['Handyman'])
    expect(callingsOpenedBy(2, 10)).toEqual([
      'Handyman',
      'TrackStar',
      'PennyPincher',
    ])
    expect(callingsOpenedBy(3, 5)).toEqual([])
  })
})

describe('the Handyman', () => {
  test('has one fewer heart and pays half for a Plank Pile', () => {
    expect(maxHpOf({ calling: 'Handyman' })).toBe(PLAYER_MAX_HP - 1)
    expect(maxHpOf({ calling: 'You' })).toBe(PLAYER_MAX_HP)
    expect(plankPriceFor('Handyman', 40)).toBe(20)
    expect(plankPriceFor('You', 40)).toBe(40)
  })
})

describe('the Track Star', () => {
  test('runs 10 percent faster', () => {
    expect(speedScaleOf({ calling: 'TrackStar' })).toBe(1.1)
    expect(speedScaleOf({ calling: 'Handyman' })).toBe(1)
  })

  test('has 20 percent smaller magazines, rounded down, never under 1', () => {
    expect(magazineFor('TrackStar', 14)).toBe(11)
    expect(magazineFor('TrackStar', 6)).toBe(4)
    expect(magazineFor('TrackStar', 30)).toBe(24)
    expect(magazineFor('TrackStar', 1)).toBe(1)
    expect(magazineFor('You', 14)).toBe(14)
  })
})

describe('the Penny Pincher', () => {
  test('is charged 15 percent less, but never for nothing', () => {
    expect(shopPriceFor('PennyPincher', 100)).toBe(85)
    expect(shopPriceFor('PennyPincher', 35)).toBe(30)
    expect(shopPriceFor('PennyPincher', 1)).toBe(1)
    expect(shopPriceFor('PennyPincher', 0)).toBe(0)
    expect(shopPriceFor('You', 35)).toBe(35)
  })

  test('is paid 15 percent less a kill, rounded down, at least 1', () => {
    expect(killPayFor('PennyPincher', 20)).toBe(17)
    expect(killPayFor('PennyPincher', 3)).toBe(2)
    expect(killPayFor('PennyPincher', 1)).toBe(1)
    expect(killPayFor('PennyPincher', 0)).toBe(0)
    expect(killPayFor('You', 20)).toBe(20)
  })
})

describe('the Line Cook', () => {
  test('starts with the Cooker and is never sold the pistol', () => {
    expect(startsWithCooker('LineCook')).toBe(true)
    expect(isPistolBarred('LineCook')).toBe(true)
    expect(startsWithCooker('You')).toBe(false)
    expect(isPistolBarred('Handyman')).toBe(false)
  })
})

describe('the player of a calling', () => {
  test('YOU is the initial player, and the others differ by hearts and gun', () => {
    expect(playerOfCalling('You')).toEqual(initialPlayer)
    expect(playerOfCalling('Handyman').hp).toBe(PLAYER_MAX_HP - 1)
    expect(playerOfCalling('LineCook').arsenal).not.toEqual(
      initialPlayer.arsenal,
    )
  })

  test('each calling but YOU wears a prop over the look', () => {
    const bare = playerPixels(defaultAppearance, 'You').idle
    expect(playerPixels(defaultAppearance).idle).toEqual(bare)
    for (const calling of CALLINGS.filter(next => next !== 'You')) {
      expect(playerPixels(defaultAppearance, calling).idle).not.toEqual(bare)
    }
  })
})
