import { Array, Option } from 'effect'
import { expect, test } from 'vitest'

import { TILE_SIZE } from '../../../shared/constants'
import { atClock, quietWave } from '../../../test/model.fixture'
import { rectsOf } from '../../../test/viewReading'
import { TILE_DOOR, hasTileFlag, levelFor } from '../../../world/level/arena'
import { EVERY_LEVEL_SPEC } from '../../../world/level/plan'
import { symbolAt, tileIndex } from '../../../world/level/tileGrid'
import { rugsOf } from '../../room/room'
import {
  dripsOf,
  leaksOf,
  maybeDripHeard,
  puddleGlintsOf,
  puddleKeyOf,
  puddlesOf,
} from '../leaks'
import { strikeOf } from '../mood'

// The roof leaks (src/render/iso/leaks.ts): a few seeded puddles in every
// open room, on plain floor clear of cover and doorways, drips off the
// World's clock, and glints mirrored from the flames and the lightning.

const EVERY_EXIT = [
  'West',
  'East',
  'Far',
  'Kitchen',
  'NorthStack',
  'SouthStack',
] as const

const levels = Array.map(EVERY_LEVEL_SPEC, spec => levelFor(spec, EVERY_EXIT))
const wave = atClock(quietWave(5), 0)
const manor = Option.getOrThrow(Array.get(levels, 1))

test('every open room leaks two or three times, on plain floor far from any door', () => {
  Array.forEach(levels, level => {
    const leaks = leaksOf(level)
    const openRooms = Array.filter(level.rooms, ({ isOpen }) => isOpen)
    expect(leaks.length).toBeGreaterThanOrEqual(openRooms.length * 2)
    Array.forEach(leaks, ({ spot, rows }) => {
      const column = Math.floor(spot.x / TILE_SIZE)
      const row = Math.floor(spot.y / TILE_SIZE)
      Array.forEach(
        Array.makeBy(9, around => around),
        around => {
          const at = symbolAt(
            level,
            column + (around % 3) - 1,
            row + Math.floor(around / 3) - 1,
          )
          expect(Option.getOrThrow(at)).toBe('.')
        },
      )
      Array.forEach(level.doorIds, id => {
        const { center } = level.doors[id]
        expect(
          Math.max(
            Math.abs(Math.floor(center.x / TILE_SIZE) - column),
            Math.abs(Math.floor(center.y / TILE_SIZE) - row),
          ),
        ).toBeGreaterThan(2)
      })
      Array.forEach(rows, puddle => {
        Array.forEach([puddle.left, puddle.right], x => {
          const at = symbolAt(
            level,
            Math.floor(x / TILE_SIZE),
            Math.floor(puddle.y / TILE_SIZE),
          )
          expect(Option.getOrThrow(at)).toBe('.')
          expect(
            hasTileFlag(
              level,
              tileIndex(
                level,
                Math.floor(x / TILE_SIZE),
                Math.floor(puddle.y / TILE_SIZE),
              ),
              TILE_DOOR,
            ),
          ).toBe(false)
        })
      })
    })
  })
})

test('no puddle lies on a rug or a runner', () => {
  Array.forEach(levels, level => {
    const rugs = rugsOf(level)
    Array.forEach(leaksOf(level), ({ rows }) => {
      Array.forEach(rows, ({ y, left, right }) => {
        Array.forEach(rugs, rug => {
          const isOn =
            y >= rug.y &&
            y < rug.y + rug.height &&
            right >= rug.x &&
            left < rug.x + rug.width
          expect(isOn).toBe(false)
        })
      })
    })
  })
})

test('the leaks stay put as more of the house opens', () => {
  const shut = levelFor(Option.getOrThrow(Array.get(EVERY_LEVEL_SPEC, 1)), [])
  const parlourSpots = Array.map(leaksOf(shut), ({ spot }) => spot)
  const openSpots = Array.map(leaksOf(manor), ({ spot }) => spot)
  Array.forEach(parlourSpots, spot => {
    expect(openSpots).toContainEqual(spot)
  })
})

test('the puddles lie in whole pixels', () => {
  const rects = rectsOf(puddlesOf(manor), { x: 0, y: 0 })
  expect(rects.length).toBeGreaterThan(0)
  Array.forEach(rects, ({ x, y, width, height }) => {
    Array.forEach([x, y, width, height], value => {
      expect(Number.isInteger(value)).toBe(true)
    })
  })
})

test('a drop falls in whole pixels and lands where it is heard', () => {
  const leak = Option.getOrThrow(Array.head(leaksOf(manor)))
  const clocks = Array.makeBy(4000 / 16, index => index * 16)
  const drops = Array.flatMap(clocks, ms =>
    dripsOf({ world: atClock(wave, ms), level: manor }),
  )
  expect(drops.length).toBeGreaterThan(0)
  Array.forEach(drops, ({ x, y, hover }) => {
    Array.forEach([x, y, hover], value => {
      expect(Number.isInteger(value)).toBe(true)
    })
  })
  const heard = Array.getSomes(
    Array.map(Array.drop(clocks, 1), (ms, index) =>
      maybeDripHeard({
        world: atClock(wave, ms),
        level: manor,
        listener: leak.spot,
        previousMs: Option.getOrThrow(Array.get(clocks, index)),
      }),
    ),
  )
  expect(heard.length).toBeGreaterThan(0)
  expect(Array.some(heard, ({ volume }) => volume > 0.9)).toBe(true)
  const far = maybeDripHeard({
    world: atClock(wave, 4000),
    level: manor,
    listener: { x: leak.spot.x + 2000, y: leak.spot.y },
    previousMs: 0,
  })
  expect(Option.isNone(far)).toBe(true)
})

test('a strike lights the puddles, and only a change paints them again', () => {
  const clocks = Array.makeBy(30_000 / 10, index => index * 10)
  const calm = Option.getOrThrow(
    Array.findFirst(clocks, ms => strikeOf(atClock(wave, ms)) === 0),
  )
  const struck = Option.getOrThrow(
    Array.findFirst(clocks, ms => strikeOf(atClock(wave, ms)) === 1),
  )
  const viewer = { x: 10_000, y: 10_000 }
  const glints = (ms: number) =>
    rectsOf(
      puddleGlintsOf({ world: atClock(wave, ms), level: manor, viewer }),
      { x: 0, y: 0 },
    )
  expect(glints(struck).length).toBeGreaterThan(glints(calm).length)
  const keyAt = (ms: number) =>
    puddleKeyOf({ world: atClock(wave, ms), level: manor, viewer })
  expect(keyAt(calm)).not.toBe(keyAt(struck))
  expect(keyAt(calm)).toBe(keyAt(calm + 10))
})
