import { Array, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import { cameraFor, cameraOf } from './camera'
import { VIEW_HEIGHT } from './constants'
import { hudShapes, hudStripShapes } from './hud'
import { BoostTimer, type Model, Phase, idleBoosts } from './model'
import { focusOf, modifyFocus } from './party'
import { BOOSTS } from './powerups'
import { initialModel } from './pureApp'
import { DEFAULT_PORTRAIT_SCREEN, LANDSCAPE_SCREEN } from './screen'
import { rectsOf } from './testing'

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
      (rect.fill === BOOSTS.RapidFire.color || rect.fill === BOOSTS.Speed.color)
        ? Result.succeed(rect)
        : Result.failVoid,
  )

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
