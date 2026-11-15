import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { expect, test } from 'vitest'

import { Phase } from '../../../app/model'
import { LANDSCAPE_SCREEN } from '../../../render/screen'
import { DISTANT_SPAWN, quietWave } from '../../../test/model.fixture'
import { imagesIn, rectsOf } from '../../../test/viewReading'
import { overlayShapes } from '../overlay'

// The overlay's banners (src/screens/game/overlay.ts): each on a dark plate
// of whole pixels, so WAVE reads over the chandelier and the table's
// candles, never sitting on a half pixel.

const PLATE_COLOR = 'rgba(8, 10, 12, 0.55)'

const waveStart = modifyFields(quietWave(4), {
  phase: () => Phase.Wave({ wave: 4, elapsedMs: 400, spawns: [DISTANT_SPAWN] }),
})

test('a banner sits on a plate of whole pixels that holds its words', () => {
  const shapes = overlayShapes(waveStart, LANDSCAPE_SCREEN)
  const plate = Option.getOrThrow(
    Array.findFirst(
      rectsOf(shapes, { x: 0, y: 0 }),
      ({ fill }) => fill === PLATE_COLOR,
    ),
  )
  Array.forEach([plate.x, plate.y, plate.width, plate.height], value => {
    expect(Number.isInteger(value)).toBe(true)
  })
  const words = Array.filter(
    imagesIn(shapes),
    ({ y, height }) => y < plate.y + plate.height && y + height > plate.y,
  )
  expect(words.length).toBeGreaterThan(0)
  Array.forEach(words, ({ x, y, width, height }) => {
    Array.forEach([x, y, width, height], value => {
      expect(Number.isInteger(value)).toBe(true)
    })
    expect(x).toBeGreaterThan(plate.x)
    expect(x + width).toBeLessThan(plate.x + plate.width)
    expect(y).toBeGreaterThanOrEqual(plate.y)
    expect(y + height).toBeLessThanOrEqual(plate.y + plate.height)
  })
})
