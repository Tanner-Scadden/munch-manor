import { Array, Record } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { PICKUPS } from '../gear/powerups'
import { PICKUP_NAMES } from '../names'
import { DIFFICULTIES, NIGHTMARE_LOCK_NOTE } from '../run/difficulty'

// NOTE: the dare's names (ESCAPE_PLAN layer 1): players read these, while
// the tags in saves, sync, analytics, and the wire stay as they were.
describe('the names a player reads', () => {
  it('names the difficulties for the dare', () => {
    expect([
      DIFFICULTIES.Easy.name,
      DIFFICULTIES.Normal.name,
      DIFFICULTIES.Hard.name,
      DIFFICULTIES.Nightmare.name,
    ]).toEqual(['Dare', 'Double Dare', 'Triple Dare', 'Triple Dog Dare'])
    expect(NIGHTMARE_LOCK_NOTE).toBe('Beat Triple Dare first')
  })

  it('names the power-ups as the house things', () => {
    expect(PICKUP_NAMES).toEqual({
      RapidFire: 'WIND-UP KEY',
      Damage: 'FAMILY SILVER',
      Speed: 'DANCING SHOES',
      Pierce: 'HAT PINS',
      Burp: 'DINNER GONG',
      Heart: 'PICKLED HEART',
    })
    expect(PICKUPS.Pierce.name).toBe('HAT PINS')
  })

  it('leaves no old name where a player reads one', () => {
    const shown = Array.join(
      [
        ...Array.flatMap(Record.values(DIFFICULTIES), ({ name, blurb }) => [
          name,
          blurb,
        ]),
        NIGHTMARE_LOCK_NOTE,
        ...Array.flatMap(Record.values(PICKUPS), ({ name, blurb }) => [
          name,
          blurb,
        ]),
      ],
      ' ',
    )
    expect(shown).not.toMatch(
      /\b(easy|normal|hard|nightmare)\b|hot sauce|mean beans|zoomy|kebullets|big burp/i,
    )
  })
})
