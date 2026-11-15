import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../app/message'
import { STICK_RADIUS_PX } from '../../shared/constants'
import { nearly } from '../../test/lensTesting'
import { playingModel } from '../../test/model.fixture'
import {
  APPLICATION,
  FRAME_MS,
  WIDE_SURFACE,
  ticks,
  touchDown,
  touchMove,
} from '../../test/testing'
import { focusOf } from '../../world/party/party'
import { cameraOf, worldToView } from '../camera'
import {
  type LensFrame,
  YAW,
  floorToScreenDirection,
  lensOf,
  screenToFloorDirection,
} from '../lens'

// NOTE: the desktop's view on its own canvas, and a phone held upright with
// its view zoomed in under the HUD band.
const DESKTOP: LensFrame = {
  x: 240,
  y: 60,
  width: 320,
  height: 180,
  scale: 1,
  left: 0,
  top: 0,
}
const PORTRAIT: LensFrame = {
  x: 100,
  y: 40,
  width: 135,
  height: 230,
  scale: 3,
  left: 0,
  top: 72,
}

const SPOTS = [
  { x: 400, y: 150 },
  { x: 250, y: 70 },
  { x: 550, y: 230 },
  { x: 245, y: 235 },
]

const onScreen = (frame: LensFrame, spot: { x: number; y: number }) =>
  lensOf(frame).projectInto(spot.x, spot.y, { x: 0, y: 0 })

describe('the lens', () => {
  test('a floor point projected and unprojected comes back to itself', () => {
    Array.forEach([DESKTOP, PORTRAIT], frame => {
      const lens = lensOf(frame)
      Array.forEach(SPOTS, spot => {
        const at = onScreen(frame, spot)
        expect(nearly(lens.unprojectInto(at.x, at.y, { x: 0, y: 0 }))).toEqual(
          nearly(spot),
        )
        expect(lens.screenX(spot.x, spot.y)).toBe(at.x)
        expect(lens.screenY(spot.x, spot.y)).toBe(at.y)
      })
    })
  })

  test('a point written into a kept point is the same as a fresh one', () => {
    const lens = lensOf(DESKTOP)
    const out = { x: 0, y: 0 }
    Array.forEach(SPOTS, spot => {
      const written = lens.projectInto(spot.x, spot.y, out)
      expect(written).toBe(out)
      expect({ ...written }).toEqual(onScreen(DESKTOP, spot))
    })
  })

  test('the same frame gives the same lens, built once', () => {
    expect(lensOf({ ...DESKTOP })).toBe(lensOf({ ...DESKTOP }))
  })

  test("the floor at the view's middle sits at the screen's middle, a game pixel to a pixel", () => {
    const middle = {
      x: DESKTOP.x + DESKTOP.width / 2,
      y: DESKTOP.y + DESKTOP.height / 2,
    }
    expect(nearly(onScreen(DESKTOP, middle))).toEqual({ x: 160, y: 90 })
    // NOTE: a game pixel east shows a hair under a pixel, as the turn tips
    // it a little into the floor's stretched north to south.
    const east = onScreen(DESKTOP, { x: middle.x + 1, y: middle.y })
    expect(Math.hypot(east.x - 160, east.y - 90)).toBeCloseTo(1, 1)
    const portraitMiddle = onScreen(PORTRAIT, {
      x: PORTRAIT.x + PORTRAIT.width / 2,
      y: PORTRAIT.y + PORTRAIT.height / 2,
    })
    expect(nearly(portraitMiddle)).toEqual({
      x: (PORTRAIT.width * PORTRAIT.scale) / 2,
      y: PORTRAIT.top + (PORTRAIT.height * PORTRAIT.scale) / 2,
    })
  })

  test('the camera is turned: east on the floor runs a little down the screen, north a little right', () => {
    const east = floorToScreenDirection({ x: 1, y: 0 })
    expect(east.x).toBeGreaterThan(0)
    expect(east.y).toBeCloseTo(Math.sin(YAW) * Math.sin((49 * Math.PI) / 180))
    const north = floorToScreenDirection({ x: 0, y: -1 })
    expect(north.y).toBeLessThan(0)
    expect(north.x).toBeGreaterThan(0)
  })

  test('nearer the lens a pixel of floor shows bigger than farther off', () => {
    const near = onScreen(DESKTOP, { x: 400, y: 230 })
    const nearOver = onScreen(DESKTOP, { x: 401, y: 230 })
    const far = onScreen(DESKTOP, { x: 400, y: 70 })
    const farOver = onScreen(DESKTOP, { x: 401, y: 70 })
    expect(
      Math.hypot(nearOver.x - near.x, nearOver.y - near.y),
    ).toBeGreaterThan(Math.hypot(farOver.x - far.x, farOver.y - far.y))
  })

  test('a push on the screen walks the floor the way the screen shows, as hard as it came', () => {
    Array.forEach(
      [
        { x: 1, y: 0 },
        { x: 0, y: -1 },
        { x: -0.5, y: 0.5 },
        { x: 0.3, y: 0 },
      ],
      push => {
        const floor = screenToFloorDirection(push)
        expect(Math.hypot(floor.x, floor.y)).toBeCloseTo(
          Math.hypot(push.x, push.y),
          9,
        )
        const shown = floorToScreenDirection(floor)
        const shownLength = Math.hypot(shown.x, shown.y)
        const pushLength = Math.hypot(push.x, push.y)
        expect(
          nearly({ x: shown.x / shownLength, y: shown.y / shownLength }),
        ).toEqual(nearly({ x: push.x / pushLength, y: push.y / pushLength }))
      },
    )
    expect(screenToFloorDirection({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})

// NOTE: a run under way on a window four times the game's size.
const fighting = modifyFields(playingModel, {
  maybeSurface: () => Option.some(WIDE_SURFACE),
})

describe('input through the lens', () => {
  it.effect('W walks the player straight up the screen', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      Story.message(Message.PressedKey({ code: 'KeyW' })),
      ...ticks(10, FRAME_MS),
      Story.model(current => {
        const camera = cameraOf(current)
        const before = worldToView(camera, focusOf(fighting).player)
        const after = worldToView(camera, focusOf(current).player)
        expect(after.y).toBeLessThan(before.y - 5)
        // NOTE: up is the lens's up at the view's middle; off the middle the
        // floor's lines run a hair toward the far vanishing point.
        expect(Math.abs(after.x - before.x)).toBeLessThan(0.25)
      }),
    ),
  )

  it.effect(
    'the move stick pushed right walks straight right on the screen',
    () =>
      Story.story(
        APPLICATION,
        Story.given(fighting),
        touchDown(11, 100, 300),
        touchMove(11, 100 + STICK_RADIUS_PX, 300),
        ...ticks(10, FRAME_MS),
        Story.model(current => {
          const camera = cameraOf(current)
          const before = worldToView(camera, focusOf(fighting).player)
          const after = worldToView(camera, focusOf(current).player)
          expect(after.x).toBeGreaterThan(before.x + 5)
          expect(Math.abs(after.y - before.y)).toBeLessThan(0.01)
        }),
      ),
  )

  it.effect('the mouse aims at the floor point under the cursor', () => {
    const player = focusOf(fighting).player
    const target = { x: player.x + 30, y: player.y - 40 }
    const cursor = worldToView(cameraOf(fighting), target)
    return Story.story(
      APPLICATION,
      Story.given(fighting),
      Story.message(
        Message.MovedMouse({ clientX: cursor.x * 4, clientY: cursor.y * 4 }),
      ),
      Story.model(current => {
        expect(
          nearly(Option.getOrThrow(focusOf(current).intent.maybeAim)),
        ).toEqual(nearly({ x: 30 / 50, y: -40 / 50 }))
      }),
    )
  })
})
