import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { type Box, nearestInDirection } from '../padFocus'

// The stick's focus step on the page: the nearest control the way it
// points, a control off the line paying for the step sideways.

const boxAt = (left: number, top: number): Box => ({
  left,
  top,
  width: 40,
  height: 20,
})

// NOTE: a menu of two rows: PLAY and CO-OP side by side, MORE under PLAY,
// and the gear far off to the right of the second row.
const PLAY = boxAt(0, 0)
const COOP = boxAt(60, 0)
const MORE = boxAt(0, 40)
const GEAR = boxAt(300, 40)
const MENU = [PLAY, COOP, MORE, GEAR]

describe('nearestInDirection', () => {
  test('steps along a row and down a column', () => {
    expect(nearestInDirection(MENU, PLAY, 'Right')).toEqual(Option.some(1))
    expect(nearestInDirection(MENU, PLAY, 'Down')).toEqual(Option.some(2))
    expect(nearestInDirection(MENU, COOP, 'Left')).toEqual(Option.some(0))
  })

  test('makes a step sideways cost more than a step ahead', () => {
    expect(nearestInDirection(MENU, COOP, 'Down')).toEqual(Option.some(2))
    expect(nearestInDirection(MENU, PLAY, 'Down')).toEqual(Option.some(2))
    expect(
      nearestInDirection([boxAt(0, 100), boxAt(90, 50)], PLAY, 'Down'),
    ).toEqual(Option.some(0))
  })

  test('finds nothing past the edge', () => {
    expect(nearestInDirection(MENU, PLAY, 'Up')).toEqual(Option.none())
    expect(nearestInDirection(MENU, GEAR, 'Right')).toEqual(Option.none())
  })

  test('takes a control a pixel off level as level', () => {
    const nudged = boxAt(60, 1)
    expect(nearestInDirection([PLAY, nudged], PLAY, 'Down')).toEqual(
      Option.none(),
    )
  })
})
