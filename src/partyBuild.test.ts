import { describe, expect, test } from 'vitest'

import { Screen, screenInRoom } from './coop/model'
import { freshRoom } from './coop/roomState'
import { crewInWave } from './model.fixture'
import { leadSeatOf } from './party'
import { Party, crewOf } from './worldSchema'

describe('values built without validating', () => {
  const world = crewInWave(3)
  const matesOf = (model: typeof world) =>
    Party.match(model.party, { Solo: () => [], Crew: ({ mates }) => mates })

  test('a Crew from crewOf is what Party.Crew builds for the same seats', () => {
    const lead = leadSeatOf(world)
    const mates = matesOf(world)
    const built = crewOf(lead, mates)
    const validated = Party.Crew({ lead, mates })
    expect(built).toStrictEqual(validated)
    expect(Object.keys(built)).toStrictEqual(Object.keys(validated))
  })

  test('the Party union reads a built Crew', () => {
    const crew = crewOf(leadSeatOf(world), matesOf(world))
    expect(Party.isAnyOf(['Crew'])(crew)).toBe(true)
    expect(Party.isAnyOf(['Solo'])(crew)).toBe(false)
  })

  test('Screen.InRoom from screenInRoom matches the validating constructor', () => {
    const room = freshRoom('ABCDE', 2)
    const built = screenInRoom(room)
    const validated = Screen.InRoom({ room })
    expect(built).toStrictEqual(validated)
    expect(Object.keys(built)).toStrictEqual(Object.keys(validated))
  })
})
