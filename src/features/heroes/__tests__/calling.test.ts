import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { defaultAppearance } from '../../../app/model'
import { playerPixels } from '../../../art/appearance'
import { specialsOf } from '../../../domain/callingSpecials'
import { PLAYER_MAX_HP } from '../../../shared/constants'
import { heldGun } from '../../../world/gear/weapons'
import {
  CALLINGS,
  UNLOCK_RANKS,
  callingForRun,
  callingPriceOf,
  callingStandingOf,
  callingsOpenedBy,
  isCallingUnlocked,
  isPistolBarred,
  keyScaleOf,
  magazineFor,
  maxHpOf,
  mendSpeedScaleOf,
  speedScaleOf,
  startingGunKind,
  startsWithCooker,
  stoveKillsFor,
  trapHealthScaleOf,
  woundGraceScaleOf,
} from '../../../world/heroes/calling'
import { playerOfCalling } from '../../../world/heroes/callingPlayer'
import { initialPlayer } from '../../../world/schema/worldSchema'

// The callings' rules (src/world/heroes/calling.ts), each a pure function of a calling.

describe('unlocking', () => {
  test('YOU is open at rank 1, the rest at 3, 6, 10, and 15', () => {
    expect(Array.map(CALLINGS, calling => UNLOCK_RANKS[calling])).toEqual([
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
      Array.map(CALLINGS, calling =>
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
  test('has one fewer heart, a longer grace after a bite, sturdier traps, and mends twice as fast', () => {
    expect(woundGraceScaleOf({ calling: 'Handyman' })).toBe(2)
    expect(woundGraceScaleOf({ calling: 'You' })).toBe(1)
    expect(maxHpOf({ calling: 'Handyman' })).toBe(PLAYER_MAX_HP - 1)
    expect(maxHpOf({ calling: 'You' })).toBe(PLAYER_MAX_HP)
    expect(trapHealthScaleOf({ calling: 'Handyman' })).toBe(1.5)
    expect(trapHealthScaleOf({ calling: 'You' })).toBe(1)
    expect(mendSpeedScaleOf({ calling: 'Handyman' })).toBe(2)
    expect(mendSpeedScaleOf({ calling: 'You' })).toBe(1)
  })
})

describe('the Track Star', () => {
  test('runs 20 percent faster', () => {
    expect(speedScaleOf({ calling: 'TrackStar' })).toBe(1.2)
    expect(speedScaleOf({ calling: 'Handyman' })).toBe(1)
  })

  test('has 5 percent smaller magazines, rounded to the nearest, never under 1', () => {
    expect(magazineFor('TrackStar', 14)).toBe(13)
    expect(magazineFor('TrackStar', 6)).toBe(6)
    expect(magazineFor('TrackStar', 30)).toBe(29)
    expect(magazineFor('TrackStar', 1)).toBe(1)
    expect(magazineFor('You', 14)).toBe(14)
  })
})

describe('the Penny Pincher', () => {
  test('her kills drop half again as many keys, for one fewer heart', () => {
    expect(keyScaleOf({ calling: 'PennyPincher' })).toBe(1.5)
    expect(keyScaleOf({ calling: 'You' })).toBe(1)
    expect(maxHpOf({ calling: 'PennyPincher' })).toBe(PLAYER_MAX_HP - 1)
  })
})

describe('the Line Cook', () => {
  test('starts with the Cooker and is never sold the pistol', () => {
    expect(startsWithCooker('LineCook')).toBe(true)
    expect(isPistolBarred('LineCook')).toBe(true)
    expect(startsWithCooker('You')).toBe(false)
    expect(isPistolBarred('Handyman')).toBe(false)
  })

  test('lights the stove after half the kitchen kills, rounded up', () => {
    expect(stoveKillsFor('LineCook', 15)).toBe(8)
    expect(stoveKillsFor('LineCook', 10)).toBe(5)
    expect(stoveKillsFor('You', 15)).toBe(15)
    expect(stoveKillsFor('PennyPincher', 15)).toBe(15)
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
    for (const calling of Array.filter(CALLINGS, next => next !== 'You')) {
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
      Array.map(specialsOf('Handyman'), ({ isPerk, line }) => [isPerk, line]),
    ).toEqual([
      [true, 'Traps 50% sturdier'],
      [true, 'Mends 2x faster'],
      [true, 'Bite blink 100% longer'],
      [false, `${PLAYER_MAX_HP - 1} max hearts`],
    ])
  })

  test('the Track Star and the Penny Pincher read theirs', () => {
    expect(Array.map(specialsOf('TrackStar'), ({ line }) => line)).toEqual([
      'Runs 20% faster',
      'Mags 5% smaller',
    ])
    expect(Array.map(specialsOf('PennyPincher'), ({ line }) => line)).toEqual([
      'Kills drop 50% more keys',
      `${PLAYER_MAX_HP - 1} max hearts`,
    ])
  })

  test('the Line Cook starts with the Cooker, lights the stove sooner, and has no Pop Pistol', () => {
    expect(
      Array.map(specialsOf('LineCook'), ({ isPerk, line }) => [isPerk, line]),
    ).toEqual([
      [true, 'Starts with Pressure Cooker'],
      [true, 'Stove at 50% fewer kills'],
      [false, 'No Pop Pistol'],
    ])
  })

  test('YOU has none', () => {
    expect(specialsOf('You')).toEqual([])
  })
})
