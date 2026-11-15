import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import type { Model } from '../../../app/model'
import { quietWave, withPlayerAt } from '../../../test/model.fixture'
import { CELLAR_SPOT } from '../../../test/testing'
import { levelOf, openExitIn } from '../../../world/level/arena'
import { CELLAR_ROOM_ID, EAST_EXIT, FAR_EXIT } from '../../../world/level/plan'
import { focusOf } from '../../../world/party/party'
import { TOOL_RULES } from '../../../world/stations/toolRules'
import { darkCellsOf, flameSpecsOf, lightsFrameOf } from '../lightSpecs'

// The house's light as plain data (src/render/iso/lightSpecs.ts): every
// room's fill, the cellar's dark, and the flames nearest the viewer, held
// to what the renderer can light at once.

// NOTE: pixi 3D lights at most 32; the ambient, the lamp, the muzzle flash,
// and one spare are always there.
const LIGHTS_LEFT = 32 - 4

const everyRoomOpen = (model: Model): Model =>
  modifyFields(model, {
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
  const cells = Option.match(
    Array.findFirst(levelOf(model).rooms, ({ id }) => id === CELLAR_ROOM_ID),
    { onNone: () => 0, onSome: ({ box }) => darkCellsOf(box).length },
  )
  return (
    Array.filter(frame.fillShares, share => share > 0).length +
    (frame.isDark ? cells : 0) +
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
    const lit = modifyFields(inCellar(quietWave(4)), {
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

  test('is the same for the same World', () => {
    const model = inCellar(quietWave(4))
    expect(frameOf(model)).toEqual(frameOf(model))
  })
})
