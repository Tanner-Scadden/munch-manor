import { Array, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { BoostTimer, type Model, Phase, idleBoosts } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PICKUP_TINTS } from '../../../art/sprites/pickups'
import { cameraFor, cameraOf } from '../../../render/camera'
import { gunSlotBox } from '../../../render/hudLayout'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_SCREEN,
  type Screen,
} from '../../../render/screen'
import { hudShapes, hudStripShapes } from '../../../screens/game/hud'
import { VIEW_HEIGHT } from '../../../shared/constants'
import { holdingSecond } from '../../../test/arsenals'
import { rectsOf } from '../../../test/testing'
import { PARLOUR } from '../../../world/level/arena'
import { focusOf, modifyFocus } from '../../../world/party/party'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const twoBoosts: Model = modifyFocus(
  modifyFields(initialModel, {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
  }),
  {
    boosts: () => ({
      ...idleBoosts,
      RapidFire: BoostTimer.On({ remainingMs: 6000, durationMs: 8000 }),
      Speed: BoostTimer.On({ remainingMs: 3000, durationMs: 10000 }),
    }),
  },
)

const chipFrames = (model: Model): ReadonlyArray<Box> =>
  Array.filterMap(
    rectsOf(
      hudShapes(
        model,
        LANDSCAPE_SCREEN,
        cameraFor(PARLOUR, focusOf(model).player),
      ),
      {
        x: 0,
        y: 0,
      },
    ),
    rect =>
      rect.width === 13 &&
      rect.height === 12 &&
      (rect.fill === PICKUP_TINTS.RapidFire || rect.fill === PICKUP_TINTS.Speed)
        ? Result.succeed(rect)
        : Result.failVoid,
  )

const LEVEL_BAR_GOLD = '#ffe066'
const HEARTS_RIGHT = 48
const WAVE_LABEL_LEFT = 120
const BOSS_NAME_LEFT = 94

describe('the boost chips', () => {
  test('two running boosts show as chips on the hearts row at the top left', () => {
    const chips = chipFrames(twoBoosts)
    expect(chips).toHaveLength(2)
    Array.forEach(chips, chip => {
      expect(chip.y + chip.height).toBeLessThan(VIEW_HEIGHT / 4)
      expect(chip.x).toBeGreaterThan(HEARTS_RIGHT)
      expect(chip.x + chip.width).toBeLessThan(WAVE_LABEL_LEFT)
    })
  })

  test('all four boosts stack in two rows, clear of the boss name under the wave label', () => {
    const allFour = modifyFocus(twoBoosts, {
      boosts: () => ({
        RapidFire: BoostTimer.On({ remainingMs: 6000, durationMs: 8000 }),
        Damage: BoostTimer.On({ remainingMs: 5000, durationMs: 8000 }),
        Speed: BoostTimer.On({ remainingMs: 3000, durationMs: 10000 }),
        Pierce: BoostTimer.On({ remainingMs: 4000, durationMs: 9000 }),
      }),
    })
    const frames = Array.filter(
      rectsOf(
        hudShapes(
          allFour,
          LANDSCAPE_SCREEN,
          cameraFor(PARLOUR, focusOf(allFour).player),
        ),
        {
          x: 0,
          y: 0,
        },
      ),
      rect => rect.width === 13 && rect.height === 12,
    )
    expect(frames).toHaveLength(4)
    expect(new Set(Array.map(frames, ({ y }) => y)).size).toBe(2)
    Array.forEach(frames, chip => {
      expect(chip.x + chip.width).toBeLessThan(BOSS_NAME_LEFT)
    })
  })

  test('no boost running shows no chip', () => {
    expect(
      chipFrames(modifyFocus(twoBoosts, { boosts: () => idleBoosts })),
    ).toEqual([])
  })
})

describe('the top HUD strip', () => {
  test('backs the landscape HUD rows over the wall, and only in landscape', () => {
    const camera = cameraOf(twoBoosts)
    const [strip, ...rest] = hudStripShapes(twoBoosts, LANDSCAPE_SCREEN, camera)
    expect(strip).toMatchObject({ _tag: 'Rect', x: 0, y: 0 })
    expect(hudStripShapes(twoBoosts, DEFAULT_PORTRAIT_SCREEN, camera)).toEqual(
      [],
    )
    expect(hudStripShapes(initialModel, LANDSCAPE_SCREEN, camera)).toEqual([])
    // NOTE: the strip leaves a gap over the boarded kitchen door, so it is
    // two pieces that reach the screen's two edges and leave the door out.
    expect(rest).toHaveLength(1)
    const [door] = rest
    expect(door).toMatchObject({ _tag: 'Rect' })
    expect(strip?._tag === 'Rect' ? strip.width : 0).toBeLessThan(
      LANDSCAPE_SCREEN.width / 2,
    )
  })
})

// NOTE: a gun's kills toward its next tier (src/world/gear/gunLevels.ts),
// a one-pixel bar along its slot's inner bottom edge, in both layouts.
describe("a gun slot's level bar", () => {
  const withSmg = (tier: number, kills: number): Model =>
    modifyFocus(twoBoosts, {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            holdingSecond({ kind: 'Smg', loaded: 30, tier, kills }),
        }),
    })

  const barIn = (model: Model, screen: Screen): ReadonlyArray<Box> => {
    const slot = gunSlotBox(screen, 1)
    return Array.filter(
      rectsOf(
        hudShapes(model, screen, cameraFor(PARLOUR, focusOf(model).player)),
        { x: 0, y: 0 },
      ),
      rect =>
        rect.height === 1 &&
        rect.fill === LEVEL_BAR_GOLD &&
        rect.x === slot.x + 1 &&
        rect.y === slot.y + slot.height - 2,
    )
  }

  test('fills with the kills from the last tier toward the next', () => {
    Array.forEach([LANDSCAPE_SCREEN, DEFAULT_PORTRAIT_SCREEN], screen => {
      const inner = gunSlotBox(screen, 1).width - 2
      expect(
        Array.map(barIn(withSmg(1, 80), screen), ({ width }) => width),
      ).toEqual([Math.round(inner / 2)])
      expect(barIn(withSmg(0, 0), screen)).toEqual([])
    })
  })

  test('is gone once the gun is at its top tier', () => {
    expect(barIn(withSmg(3, 300), LANDSCAPE_SCREEN)).toEqual([])
  })
})
