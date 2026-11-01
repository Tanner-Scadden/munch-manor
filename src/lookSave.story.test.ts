import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { cleanLook } from '@munch/netcode'

import { HAT_ART } from './hatArt'
import { defaultAppearance, initialModel } from './model'
import {
  type Appearance,
  GunSkin,
  Hat,
  Print,
  SEEN_BASELINE,
  ShirtColor,
  lookCodeOf,
  lookOfCode,
} from './playerData'
import { pointsForRank } from './rank'
import { SAVE_VERSION, decodeSave, restoreSave, saveOf } from './save'
import { legacySave } from './store.fixture'
import { unlocksAt } from './unlocks'

// The hat, shirt color, print, and gun skin in what is kept and what is
// sent: the save at version 16, and the look code the co-op lobby carries.

const BARE = defaultAppearance

const MOHAWK: Appearance = {
  body: 'Slim',
  hairStyle: 'Mohawk',
  hairColor: 'Pink',
  skinTone: 'Tan',
  shirtColor: 'Teal',
  outfit: 'Dress',
  print: 'Rainbow',
  beard: true,
  glasses: false,
  hat: 'None',
  gunSkin: 'Stock',
}

describe('the save with hats', () => {
  const {
    boughtCosmetics: _bought,
    seenUnlocks: _seen,
    ...withoutBought
  } = legacySave
  const { hat: _hat, gunSkin: _skin, ...lookWithoutHat } = legacySave.appearance

  test('a save from before hats is bare headed and has bought none', () => {
    const json = JSON.stringify({
      ...withoutBought,
      version: 14,
      appearance: lookWithoutHat,
    })
    const migrated = Option.getOrThrow(decodeSave(json))
    expect(migrated.version).toBe(SAVE_VERSION)
    expect(migrated.appearance).toEqual({
      ...lookWithoutHat,
      hat: 'None',
      gunSkin: 'Stock',
    })
    expect(migrated.boughtCosmetics).toEqual([])
    expect(migrated.calling).toBe(legacySave.calling)
    expect(migrated.rank).toEqual(legacySave.rank)
    expect(migrated.name).toBe(legacySave.name)
  })

  test('older saves still reach the current version through the chain', () => {
    const { calling: _calling, ...beforeCallings } = withoutBought
    const json = JSON.stringify({
      ...beforeCallings,
      version: 13,
      appearance: lookWithoutHat,
    })
    const migrated = Option.getOrThrow(decodeSave(json))
    expect(migrated.version).toBe(SAVE_VERSION)
    expect(migrated.calling).toBe('You')
    expect(migrated.appearance.hat).toBe('None')
    expect(migrated.boughtCosmetics).toEqual([])
  })

  test('the hat and the hats bought round trip through the model', () => {
    const save = {
      ...legacySave,
      appearance: { ...legacySave.appearance, hat: 'Fez' as const },
      boughtCosmetics: ['Fez' as const, 'Plunger' as const],
      rank: { ...legacySave.rank, earnedBones: 200, spentBones: 110 },
    }
    const restored = restoreSave(initialModel, save)
    expect(restored.appearance.hat).toBe('Fez')
    expect(restored.boughtCosmetics).toEqual(['Fez', 'Plunger'])
    expect(saveOf(restored).boughtCosmetics).toEqual(['Fez', 'Plunger'])
    expect(saveOf(restored).appearance.hat).toBe('Fez')
    const json = JSON.stringify(saveOf(restored))
    expect(decodeSave(json)).toEqual(Option.some(saveOf(restored)))
  })
})

describe('the save at version 16', () => {
  const {
    boughtCosmetics: _bought,
    seenUnlocks: _seen,
    ...current
  } = legacySave
  const savedAt15 = (rankPoints: number) => ({
    ...current,
    version: 15,
    rank: { ...legacySave.rank, earnedPoints: rankPoints },
    appearance: (({ gunSkin: _skin, ...look }) => look)(legacySave.appearance),
    boughtHats: ['Fez', 'Plunger'],
  })

  test('a save from before gun skins has stock guns and keeps its hats', () => {
    const migrated = Option.getOrThrow(decodeSave(JSON.stringify(savedAt15(0))))
    expect(migrated.version).toBe(SAVE_VERSION)
    expect(migrated.appearance.gunSkin).toBe('Stock')
    expect(migrated.appearance.hat).toBe(legacySave.appearance.hat)
    expect(migrated.boughtCosmetics).toEqual(['Fez', 'Plunger'])
    expect(Object.keys(migrated)).not.toContain('boughtHats')
  })

  test('it has seen every unlock it had reached, so no wall of NEW', () => {
    const rank16 = pointsForRank(16)
    const migrated = Option.getOrThrow(
      decodeSave(JSON.stringify(savedAt15(rank16))),
    )
    expect([...migrated.seenUnlocks].sort()).toEqual([...unlocksAt(16)].sort())
    expect(migrated.seenUnlocks).toContain('hat:TrafficCone')
    expect(migrated.seenUnlocks).toContain('shirt:Gold')
    expect(migrated.seenUnlocks).toContain('calling:LineCook')
    expect(migrated.seenUnlocks).not.toContain('print:Polka')
    expect(migrated.seenUnlocks).not.toContain('calling:You')
  })

  test('a new player has seen none, and one older save reaches the chain end', () => {
    const migrated = Option.getOrThrow(decodeSave(JSON.stringify(savedAt15(0))))
    expect(migrated.seenUnlocks).toEqual([])
  })

  test('the skin and the unlocks seen round trip through the model', () => {
    const save = {
      ...legacySave,
      appearance: { ...legacySave.appearance, gunSkin: 'Candy' as const },
      boughtCosmetics: ['skin:Candy'],
      seenUnlocks: ['hat:PartyHat'],
      rank: { ...legacySave.rank, earnedBones: 100, spentBones: 60 },
    }
    const restored = restoreSave(initialModel, save)
    expect(restored.appearance.gunSkin).toBe('Candy')
    expect(restored.seenUnlocks).toEqual(['hat:PartyHat'])
    expect(saveOf(restored).seenUnlocks).toEqual(['hat:PartyHat'])
    const json = JSON.stringify(saveOf(restored))
    expect(decodeSave(json)).toEqual(Option.some(saveOf(restored)))
  })

  test('the baseline mark of a row from before NEW badges stands for what is reached', () => {
    const save = {
      ...legacySave,
      rank: { ...legacySave.rank, earnedPoints: pointsForRank(8) },
      seenUnlocks: [SEEN_BASELINE],
    }
    const restored = restoreSave(initialModel, save)
    expect([...restored.seenUnlocks].sort()).toEqual([...unlocksAt(8)].sort())
    expect(restored.seenUnlocks).not.toContain(SEEN_BASELINE)
    expect(restored.seenUnlocks).toContain('calling:TrackStar')
  })

  test('unlocks seen on another device stay seen: a synced save adds to them', () => {
    const here = restoreSave(initialModel, {
      ...legacySave,
      seenUnlocks: ['hat:PartyHat'],
    })
    const synced = restoreSave(here, {
      ...legacySave,
      seenUnlocks: ['calling:Handyman'],
    })
    expect([...synced.seenUnlocks].sort()).toEqual([
      'calling:Handyman',
      'hat:PartyHat',
    ])
  })
})

describe('the gun skin and the other earned looks in the look code', () => {
  test('a stock look has the code it always had', () => {
    expect(lookCodeOf(MOHAWK)).toBe('Slim.Mohawk.Pink.Tan.Teal.CCBA')
  })

  test('a skin is an eighth word, after the hat word, A for no hat', () => {
    expect(lookCodeOf({ ...MOHAWK, gunSkin: 'Gold' })).toBe(
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.A.B',
    )
    expect(lookCodeOf({ ...MOHAWK, hat: 'Fez', gunSkin: 'Neon' })).toBe(
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.M.F',
    )
    expect(lookCodeOf({ ...MOHAWK, hat: 'Fez', gunSkin: 'Stock' })).toBe(
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.M',
    )
  })

  test('every skin reads back, with and without a hat', () => {
    Array.forEach(GunSkin.literals, gunSkin => {
      Array.forEach(['None', 'Fez', 'WitchHat'] as const, hat => {
        const look: Appearance = { ...MOHAWK, hat, gunSkin }
        expect(lookOfCode(lookCodeOf(look))).toEqual(Option.some(look))
      })
    })
  })

  test('the new shirt colors and prints read back by their place', () => {
    Array.forEach(ShirtColor.literals, shirtColor => {
      Array.forEach(Print.literals, print => {
        const look: Appearance = { ...MOHAWK, shirtColor, print }
        expect(lookOfCode(lookCodeOf(look))).toEqual(Option.some(look))
      })
    })
    expect(lookCodeOf({ ...MOHAWK, shirtColor: 'Gold', print: 'Flames' })).toBe(
      'Slim.Mohawk.Pink.Tan.Gold.CGBA',
    )
  })

  test('older codes of five, six, and seven words still read', () => {
    expect(lookOfCode('Slim.Mohawk.Pink.Tan.Teal.CCBA')).toEqual(
      Option.some(MOHAWK),
    )
    expect(lookOfCode('Slim.Mohawk.Pink.Tan.Teal.CCBA.M')).toEqual(
      Option.some({ ...MOHAWK, hat: 'Fez' }),
    )
    expect(lookOfCode('Female.Ponytail.Pink.Tan.Teal')).toEqual(
      Option.some({
        ...BARE,
        hairStyle: 'Ponytail',
        hairColor: 'Pink',
        skinTone: 'Tan',
        shirtColor: 'Teal',
      }),
    )
  })

  test('the lobby accepts the longest code', () => {
    const code = lookCodeOf({
      ...MOHAWK,
      shirtColor: 'Midnight',
      print: 'Flames',
      hat: 'PumpkinHead',
      gunSkin: 'Neon',
    })
    expect(cleanLook(code)).toBe(code)
  })
})

describe('the hat in the look code', () => {
  test('a bare headed look has the code it always had', () => {
    expect(lookCodeOf(MOHAWK)).toBe('Slim.Mohawk.Pink.Tan.Teal.CCBA')
  })

  test('a hat is one more word, the letter of its place in the hats', () => {
    expect(lookCodeOf({ ...MOHAWK, hat: 'PartyHat' })).toBe(
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.B',
    )
    expect(lookCodeOf({ ...MOHAWK, hat: 'Fez' })).toBe(
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.M',
    )
    expect(lookCodeOf({ ...MOHAWK, hat: 'PumpkinHead' })).toBe(
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.Q',
    )
  })

  test('every hat reads back from its code, on every body and hair style', () => {
    Array.forEach(Hat.literals, hat => {
      Array.forEach(['Slim', 'Broad'] as const, body => {
        Array.forEach(
          ['Short', 'Long', 'Ponytail', 'Curly', 'Mohawk', 'Bald'] as const,
          hairStyle => {
            const look: Appearance = { ...MOHAWK, body, hairStyle, hat }
            expect(lookOfCode(lookCodeOf(look))).toEqual(Option.some(look))
          },
        )
      })
    })
  })

  test('a code from before hats, or from an old lobby row, reads bare headed', () => {
    expect(lookOfCode('Slim.Mohawk.Pink.Tan.Teal.CCBA')).toEqual(
      Option.some(MOHAWK),
    )
    expect(lookOfCode('Slim.Mohawk.Pink.Tan.Teal.CCBA.A')).toEqual(
      Option.some(MOHAWK),
    )
    expect(lookOfCode('Female.Ponytail.Pink.Tan.Teal')).toEqual(
      Option.some({
        ...BARE,
        body: 'Broad',
        hairStyle: 'Ponytail',
        hairColor: 'Pink',
        skinTone: 'Tan',
        shirtColor: 'Teal',
      }),
    )
  })

  test('a hat word that is not a hat, or two of them, is no look', () => {
    ;[
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.R',
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.MM',
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.m',
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.',
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.M.A.A',
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.M.Z',
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.M.AA',
    ].forEach(code => {
      expect(lookOfCode(code)).toEqual(Option.none())
    })
  })

  test('the lobby accepts the longer code', () => {
    const code = lookCodeOf({ ...MOHAWK, hat: 'Colander' })
    expect(cleanLook(code)).toBe(code)
  })

  test('every hat has art to wear', () => {
    Array.forEach(Hat.literals, hat => {
      expect(hat === 'None' || hat in HAT_ART).toBe(true)
    })
  })
})
