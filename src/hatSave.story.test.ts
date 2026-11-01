import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { cleanLook } from '@munch/netcode'

import { HAT_ART } from './hatArt'
import { defaultAppearance, initialModel } from './model'
import { type Appearance, Hat, lookCodeOf, lookOfCode } from './playerData'
import { SAVE_VERSION, decodeSave, restoreSave, saveOf } from './save'
import { legacySave } from './store.fixture'

// The hat in what is kept and what is sent: the save at version 15, and the
// look code the co-op lobby carries.

const BARE = { ...defaultAppearance, hat: 'None' } satisfies Appearance

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
}

describe('the save with hats', () => {
  const { boughtHats: _bought, ...withoutBought } = legacySave
  const { hat: _hat, ...lookWithoutHat } = legacySave.appearance

  test('a save from before hats is bare headed and has bought none', () => {
    const json = JSON.stringify({
      ...withoutBought,
      version: 14,
      appearance: lookWithoutHat,
    })
    const migrated = Option.getOrThrow(decodeSave(json))
    expect(migrated.version).toBe(SAVE_VERSION)
    expect(migrated.appearance).toEqual({ ...lookWithoutHat, hat: 'None' })
    expect(migrated.boughtHats).toEqual([])
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
    expect(migrated.boughtHats).toEqual([])
  })

  test('the hat and the hats bought round trip through the model', () => {
    const save = {
      ...legacySave,
      appearance: { ...legacySave.appearance, hat: 'Fez' as const },
      boughtHats: ['Fez' as const, 'Plunger' as const],
      rank: { ...legacySave.rank, earnedBones: 200, spentBones: 110 },
    }
    const restored = restoreSave(initialModel, save)
    expect(restored.appearance.hat).toBe('Fez')
    expect(restored.boughtHats).toEqual(['Fez', 'Plunger'])
    expect(saveOf(restored).boughtHats).toEqual(['Fez', 'Plunger'])
    expect(saveOf(restored).appearance.hat).toBe('Fez')
    const json = JSON.stringify(saveOf(restored))
    expect(decodeSave(json)).toEqual(Option.some(saveOf(restored)))
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
      'Slim.Mohawk.Pink.Tan.Teal.CCBA.M.A',
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
