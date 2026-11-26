import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../../app/model'
import { quietWave, withPlayerAt } from '../../../test/model.fixture'
import { CELLAR_SPOT } from '../../../test/testing'
import { levelOf, openExitIn } from '../../../world/level/arena'
import { EAST_EXIT, FAR_EXIT } from '../../../world/level/plan'
import { focusOf } from '../../../world/party/party'
import { TOOL_RULES } from '../../../world/stations/toolRules'
import {
  AMBIENT,
  DARK_EVEN,
  DARK_TAKES,
  flameSpecsOf,
  lightsFrameOf,
} from '../lightSpecs'
import { LOOK } from '../lookSpecs'

const LIGHTS_LEFT = 32 - 4

const everyRoomOpen = (model: Model): Model =>
  UiStruct.evolve(model, {
    level: state => openExitIn(openExitIn(state, EAST_EXIT), FAR_EXIT),
  })

const inCellar = (model: Model): Model =>
  withPlayerAt(everyRoomOpen(model), CELLAR_SPOT.x, CELLAR_SPOT.y)

const frameOf = (model: Model) =>
  lightsFrameOf({
    world: model,
    level: levelOf(model),
    viewer: focusOf(model).player,
    rattle: 0,
  })

const lightsUsed = (model: Model): number => {
  const frame = frameOf(model)
  return (
    Array.filter(frame.fillShares, share => share > 0).length +
    (frame.isInDark ? 2 : 0) +
    Array.filter(frame.flames, ({ isShown }) => isShown).length
  )
}

describe('the house lights', () => {
  test('stay within what the renderer can light, every room open', () => {
    expect(lightsUsed(everyRoomOpen(quietWave(4)))).toBeLessThanOrEqual(
      LIGHTS_LEFT,
    )
    expect(lightsUsed(inCellar(quietWave(4)))).toBeLessThanOrEqual(LIGHTS_LEFT)
  })

  test('show a flame for every one the budget has room for', () => {
    const model = everyRoomOpen(quietWave(4))
    const frame = frameOf(model)
    expect(frame.flames.length).toBe(flameSpecsOf(levelOf(model)).length)
    expect(
      Array.filter(frame.flames, ({ isShown }) => isShown).length,
    ).toBeGreaterThan(0)
  })

  test('darken the open cellar, and hand the flashlight to a player in it', () => {
    const shut = frameOf(quietWave(4))
    const open = frameOf(everyRoomOpen(quietWave(4)))
    const inside = frameOf(inCellar(quietWave(4)))
    expect([shut.isDark, open.isDark, inside.isDark]).toEqual([
      false,
      true,
      true,
    ])
    expect([open.isInDark, inside.isInDark]).toEqual([false, true])
  })

  test('lift the dark while the bulb is lit', () => {
    const lit = UiStruct.evolve(inCellar(quietWave(4)), {
      stations: stations => ({
        ...stations,
        Bulb: {
          workedMs: 0,
          cooldownMs: TOOL_RULES.Bulb.cooldownMs - 1,
          timesWorked: 1,
        },
      }),
    })
    expect(frameOf(lit).isDark).toBe(false)
  })

  test('take the whole ambient off a side in the dark, and less than off a top', () => {
    expect(DARK_EVEN).toBeGreaterThan((AMBIENT / Math.PI) * LOOK.ambient)
    expect(DARK_EVEN).toBeLessThan(DARK_TAKES)
  })

  test('is the same for the same World', () => {
    const model = inCellar(quietWave(4))
    expect(frameOf(model)).toEqual(frameOf(model))
  })
})
