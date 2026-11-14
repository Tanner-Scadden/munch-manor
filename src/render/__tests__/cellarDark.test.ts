import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import type { Model } from '../../app/model'
import { quietWave, withPlayerAt } from '../../test/model.fixture'
import { CELLAR_SPOT, zombieAt } from '../../test/testing'
import { openExitIn } from '../../world/level/arena'
import { EAST_EXIT, FAR_EXIT } from '../../world/level/plan'
import { modifyFocus } from '../../world/party/party'
import { TOOL_RULES } from '../../world/stations/toolRules'
import { cellarDarkOf } from '../cellarDark'

// The cellar's dark (src/render/cellarDark.ts), once the cellar is open
// and its bulb is out. A zombie in it is not drawn at all (no eyes, bar, or shadow) unless it is
// close to the viewing player, fading in over the last tile, or in their
// flashlight's beam the way they face; a lit cellar draws every zombie.

const inCellar = (model: Model): Model =>
  withPlayerAt(
    modifyFields(model, {
      level: state => openExitIn(openExitIn(state, EAST_EXIT), FAR_EXIT),
    }),
    CELLAR_SPOT.x,
    CELLAR_SPOT.y,
  )

const NEAR = zombieAt(1, CELLAR_SPOT.x + 12, CELLAR_SPOT.y)
const FAR_OFF = zombieAt(2, 960, 30)

const darkOf = (model: Model) => cellarDarkOf(model)

describe('the cellar dark', () => {
  test('is only over the cellar, once it is open', () => {
    expect(Option.isNone(darkOf(quietWave(4)))).toBe(true)
    expect(Option.isSome(darkOf(inCellar(quietWave(4))))).toBe(true)
  })

  test('draws nothing of a zombie far in the dark, and all of a near one', () => {
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4))),
    )
    expect(dark.fadeOf(NEAR)).toBe(1)
    expect(dark.fadeOf(FAR_OFF)).toBe(0)
  })

  test('fades a zombie in over the last tile, by the viewing player', () => {
    const fading = zombieAt(3, CELLAR_SPOT.x - 25, CELLAR_SPOT.y)
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4))),
    )
    expect(dark.fadeOf(fading)).toBeGreaterThan(0)
    expect(dark.fadeOf(fading)).toBeLessThan(1)
  })

  test('shows a zombie far off in the beam the way the player faces', () => {
    const ahead = zombieAt(5, CELLAR_SPOT.x + 60, CELLAR_SPOT.y)
    const behind = zombieAt(6, CELLAR_SPOT.x - 60, CELLAR_SPOT.y)
    const facingRight = inCellar(quietWave(4))
    const facingLeft = modifyFocus(facingRight, {
      player: player =>
        modifyFields(player, { facing: () => ({ x: -1, y: 0 }) }),
    })
    const right = Option.getOrThrow(darkOf(facingRight))
    const left = Option.getOrThrow(darkOf(facingLeft))
    expect([right.fadeOf(ahead), right.fadeOf(behind)]).toEqual([1, 0])
    expect([left.fadeOf(ahead), left.fadeOf(behind)]).toEqual([0, 1])
  })

  test('draws a zombie outside the cellar as usual', () => {
    const dark = Option.getOrThrow(
      darkOf(inCellar(quietWave(4))),
    )
    expect(dark.fadeOf(zombieAt(4, 40, 60))).toBe(1)
  })

  test('a lit cellar has no dark, so it draws both', () => {
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
    expect(Option.isNone(darkOf(lit))).toBe(true)
  })
})
