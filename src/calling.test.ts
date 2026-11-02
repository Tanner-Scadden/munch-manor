import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { playerPixels } from './appearance'
import {
  CALLINGS,
  UNLOCK_RANKS,
  callingForRun,
  callingPriceOf,
  callingStandingOf,
  callingsOpenedBy,
  isCallingUnlocked,
  isPistolBarred,
  isRepairFree,
  killPayFor,
  magazineFor,
  maxHpOf,
  plankPriceFor,
  shopPriceFor,
  speedScaleOf,
  startingGunKind,
  startsWithCooker,
  woundGraceScaleOf,
} from './calling'
import { playerOfCalling } from './callingPlayer'
import { specialsOf } from './callingSpecials'
import { PLAYER_MAX_HP } from './constants'
import { defaultAppearance } from './model'
import { heldGun } from './weapons'
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

  test('a run starts with a hero not bought as YOU', () => {
    expect(callingForRun('TrackStar', [])).toBe('You')
    expect(callingForRun('TrackStar', ['hero:Handyman'])).toBe('You')
    expect(callingForRun('TrackStar', ['hero:TrackStar'])).toBe('TrackStar')
    expect(callingForRun('You', [])).toBe('You')
  })

  test('a hero is locked below its rank, for sale at it, and owned once bought', () => {
    expect(callingStandingOf('Handyman', 2, [])).toBe('Locked')
    expect(callingStandingOf('Handyman', 3, [])).toBe('ForSale')
    expect(callingStandingOf('Handyman', 3, ['hero:Handyman'])).toBe('Owned')
    expect(callingStandingOf('You', 1, [])).toBe('Owned')
  })

  test('the prices: Handyman 60, Track Star 100, Penny Pincher 150, Line Cook 200', () => {
    expect(
      CALLINGS.map(calling =>
        Option.getOrElse(callingPriceOf(calling), () => 0),
      ),
    ).toEqual([0, 60, 100, 150, 200])
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
  test('has one fewer heart, a longer grace after a bite, pays half for a Plank Pile, and mends for free', () => {
    expect(woundGraceScaleOf({ calling: 'Handyman' })).toBe(2)
    expect(woundGraceScaleOf({ calling: 'You' })).toBe(1)
    expect(isRepairFree('Handyman')).toBe(true)
    expect(isRepairFree('You')).toBe(false)
    expect(maxHpOf({ calling: 'Handyman' })).toBe(PLAYER_MAX_HP - 1)
    expect(maxHpOf({ calling: 'You' })).toBe(PLAYER_MAX_HP)
    expect(plankPriceFor('Handyman', 40)).toBe(20)
    expect(plankPriceFor('You', 40)).toBe(40)
  })
})

describe('the Track Star', () => {
  test('runs 10 percent faster', () => {
    expect(speedScaleOf({ calling: 'TrackStar' })).toBe(1.2)
    expect(speedScaleOf({ calling: 'Handyman' })).toBe(1)
  })

  test('has 10 percent smaller magazines, rounded down, never under 1', () => {
    expect(magazineFor('TrackStar', 14)).toBe(12)
    expect(magazineFor('TrackStar', 6)).toBe(5)
    expect(magazineFor('TrackStar', 30)).toBe(27)
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

  test('is paid 20 percent less a kill, to the nearest dollar, at least 1', () => {
    expect(killPayFor('PennyPincher', 20)).toBe(16)
    expect(killPayFor('PennyPincher', 3)).toBe(2)
    expect(killPayFor('PennyPincher', 2)).toBe(2)
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

describe('the gun in the Look preview', () => {
  test('is the gun the calling starts a run holding', () => {
    for (const calling of CALLINGS) {
      expect(startingGunKind(calling)).toBe(
        heldGun(playerOfCalling(calling).arsenal).kind,
      )
    }
  })
})

describe('the specials as short lines', () => {
  test('the Handyman reads his own numbers, perks and drawbacks apart', () => {
    expect(
      specialsOf('Handyman').map(({ isPerk, line }) => [isPerk, line]),
    ).toEqual([
      [true, 'Planks 50% off'],
      [true, 'Free repairs'],
      [true, 'Bite blink 100% longer'],
      [false, `${PLAYER_MAX_HP - 1} max hearts`],
    ])
  })

  test('the Track Star and the Penny Pincher read theirs', () => {
    expect(specialsOf('TrackStar').map(({ line }) => line)).toEqual([
      'Runs 20% faster',
      'Mags 10% smaller',
    ])
    expect(specialsOf('PennyPincher').map(({ line }) => line)).toEqual([
      'Rattles 15% off',
      'Kills pay 20% less',
    ])
  })

  test('the Line Cook starts with the Cooker and has no Pop Pistol', () => {
    expect(
      specialsOf('LineCook').map(({ isPerk, line }) => [isPerk, line]),
    ).toEqual([
      [true, 'Starts with Pressure Cooker'],
      [false, 'No Pop Pistol'],
    ])
  })

  test('YOU has none', () => {
    expect(specialsOf('You')).toEqual([])
  })
})
