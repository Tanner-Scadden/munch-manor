import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../../app/model'
import { atClock, quietWave } from '../../../test/model.fixture'
import { levelOf, openExitIn } from '../../../world/level/arena'
import { WEST_EXIT } from '../../../world/level/plan'
import { houseRattleOf } from '../../juice'
import { airOf } from '../air'

const airAt = (model: Model, ms: number) => {
  const world = atClock(model, ms)
  return airOf({
    world,
    level: levelOf(world),
    viewer: { x: 180, y: 110 },
    rattle: 0,
  })
}

const isIn =
  (
    box: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  ) =>
  ({ x, y }: Readonly<{ x: number; y: number }>): boolean =>
    x >= box.left - 20 &&
    x <= box.right + 20 &&
    y >= box.top - 20 &&
    y <= box.bottom + 20

describe('the air', () => {
  test('is the same for the same clock, and moves as it runs', () => {
    const wave = quietWave(3)
    expect(airAt(wave, 4000)).toEqual(airAt(wave, 4000))
    expect(airAt(wave, 4000)).not.toEqual(airAt(wave, 4500))
  })

  test('dust drifts only in the open rooms', () => {
    const wave = quietWave(3)
    const opened = UiStruct.evolve(wave, {
      level: state => openExitIn(state, WEST_EXIT),
    })
    const dust = (model: Model) =>
      Array.filter(airAt(model, 4000), ({ isGlowing }) => !isGlowing)
    expect(dust(opened).length).toBeGreaterThan(dust(wave).length)
    const open = Array.filter(levelOf(wave).rooms, ({ isOpen }) => isOpen)
    expect(
      Array.every(dust(wave), mote =>
        Array.some(open, ({ box }) => isIn(box)(mote)),
      ),
    ).toBe(true)
  })

  test('embers rise and fade as they climb', () => {
    const opened = UiStruct.evolve(quietWave(3), {
      level: state => openExitIn(state, WEST_EXIT),
    })
    const embers = Array.filter(
      airAt(opened, 4000),
      ({ isGlowing }) => isGlowing,
    )
    expect(embers.length).toBeGreaterThan(0)
    const high = Array.filter(embers, ({ hover }) => hover > 40)
    const low = Array.filter(embers, ({ hover }) => hover < 25)
    expect(high.length + low.length).toBeGreaterThan(0)
    expect(
      Array.every(high, up => Array.every(low, down => up.alpha <= down.alpha)),
    ).toBe(true)
  })

  test('a rattle sifts dust off the ceiling, and gunfire never does', () => {
    const wave = quietWave(3)
    const level = levelOf(wave)
    const viewer = { x: 180, y: 110 }
    const motes = (trauma: number) =>
      airOf({ world: wave, level, viewer, rattle: houseRattleOf(trauma) })
        .length
    expect(houseRattleOf(0.3)).toBe(0)
    expect(motes(0.3)).toBe(motes(0))
    expect(motes(1)).toBeGreaterThan(motes(0.6))
    expect(motes(0.6)).toBeGreaterThan(motes(0))
  })
})
