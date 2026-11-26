import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { rectsOf } from '../../../test/viewReading'
import { levelFor } from '../../../world/level/arena'
import { MANOR_SPEC } from '../../../world/level/plan'
import type { DoorId } from '../../../world/schema/entitySchema'
import { DOOR_DARK_COLOR, DOOR_DIM_COLOR } from '../roomPalette'
import { doorBox, doorwayShapes } from '../roomWalls'

const LEVEL = levelFor(MANOR_SPEC, ['Kitchen', 'West', 'East', 'Far'])
const DOORWAYS: ReadonlyArray<DoorId> = Array.filter(
  LEVEL.doorIds,
  id => id !== 'Window' && id !== 'Back',
)

describe('the doorways in 3D', () => {
  test('the manor has a doorway on every side', () => {
    expect(DOORWAYS).toEqual(
      expect.arrayContaining(['North', 'South', 'West', 'East', 'EastBottom']),
    )
  })

  test('nothing but the dark floor lies in a doorway', () => {
    const rects = rectsOf(doorwayShapes(LEVEL), { x: 0, y: 0 })
    Array.forEach(DOORWAYS, id => {
      const box = doorBox(LEVEL, id)
      const inside = Array.filter(
        rects,
        ({ x, y, width, height }) =>
          x < box.x + box.width &&
          x + width > box.x &&
          y < box.y + box.height &&
          y + height > box.y,
      )
      expect(
        Array.dedupe(Array.map(inside, ({ fill }) => `${id} ${fill}`)),
      ).toEqual(expect.arrayContaining([`${id} ${DOOR_DARK_COLOR}`]))
      expect(
        Array.filter(
          inside,
          ({ fill }) => fill !== DOOR_DARK_COLOR && fill !== DOOR_DIM_COLOR,
        ),
      ).toEqual([])
    })
  })
})
