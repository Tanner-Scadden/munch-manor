import { Array } from 'effect'
import { Canvas } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { crewInWave, withSeatLife } from '../../test/model.fixture'
import { Life } from '../../world/schema/worldSchema'
import {
  isLeadArmed,
  isLeadInHouse,
  leadBodyShapes,
  mateModelsOf,
} from '../partyView'

// A player who stepped out through the front door (src/world/dare/finale.ts)
// is gone from the house: no body to draw, theirs or a teammate's.

describe('a player who stepped out', () => {
  it('is not drawn as a teammate', () => {
    const crew = withSeatLife(crewInWave(3), 1, Life.Out())
    expect(Array.map(mateModelsOf(crew), ({ seat }) => seat.slot)).toEqual([2])
  })

  const BODY = [Canvas.Rect({ x: 0, y: 0, width: 1, height: 1, fill: '#fff' })]

  it('leaves no body, gun, or shadow of their own', () => {
    const out = withSeatLife(crewInWave(2), 0, Life.Out())
    expect(isLeadInHouse(out)).toBe(false)
    expect(isLeadArmed(out)).toBe(false)
    expect(leadBodyShapes(out, () => BODY)).toEqual([])
    expect(leadBodyShapes(crewInWave(2), () => BODY)).toEqual(BODY)
    expect(isLeadArmed(crewInWave(2))).toBe(true)
  })
})
