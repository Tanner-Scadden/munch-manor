import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { refreshIntent } from '../../app/frame'
import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { moveHintBand } from '../../features/onboarding/onboarding'
import { Stick } from '../../input/inputSchema'
import {
  CAMERA_LEAN_PX,
  FIXED_STEP_MS,
  STICK_RADIUS_PX,
} from '../../shared/constants'
import { DISTANT_SPAWN, withKeys } from '../../test/model.fixture'
import {
  APPLICATION,
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  modelAfterMessages,
  scoring,
  ticks,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { levelOf, openExitIn } from '../../world/level/arena'
import { focusOf, modifyFocus } from '../../world/party/party'
import { scoreOf } from '../../world/run/stats'
import {
  cameraOf,
  leanCamera,
  screenCameraOf,
  viewToWorld,
  worldToView,
  worldWindowOf,
} from '../camera'
import {
  LANDSCAPE_MAX_WIDTH,
  LANDSCAPE_SCREEN,
  LANDSCAPE_TOUCH_SCREEN,
  PORTRAIT_HUD_PX,
  PORTRAIT_VIEW_ROWS,
  PORTRAIT_WIDTH,
  clientToView,
  isPortrait,
  landscapeTouchScreen,
  landscapeWidthFor,
  portraitHeightFor,
  portraitScreen,
  screenOf,
  thumbAreaTop,
} from '../screen'

const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const FRAME_MS = FIXED_STEP_MS

const fightingInPortrait: Model = modifyFields(asVeteran(initialModel), {
  lastDevice: () => 'Touch',
  orientation: () => 'Portrait',
  maybeSurface: () => Option.some(PHONE_PORTRAIT),
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

const fightingInLandscape: Model = modifyFields(fightingInPortrait, {
  orientation: () => 'Landscape',
  maybeSurface: () => Option.some(PHONE_LANDSCAPE),
})

const standingAt = (base: Model, x: number, y: number): Model =>
  modifyFocus(base, { player: player => ({ ...player, x, y }) })

const pressThumb = (pointerId: number, clientX: number, clientY: number) =>
  Story.message(
    Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
  )

const moveThumb = (pointerId: number, clientX: number, clientY: number) =>
  Story.message(Message.MovedPointer({ pointerId, clientX, clientY }))

const rotateTo = (surface: typeof PHONE_PORTRAIT) =>
  Story.message(Message.MeasuredGameSurface(surface))

describe('the portrait screen', () => {
  test('is a touch phone held upright, as wide as a landscape phone is tall', () => {
    expect(isPortrait(fightingInPortrait)).toBe(true)
    expect(isPortrait(fightingInLandscape)).toBe(false)
    expect(
      isPortrait(
        modifyFields(fightingInPortrait, { lastDevice: () => 'KeyboardMouse' }),
      ),
    ).toBe(false)

    const screen = screenOf(fightingInPortrait)
    expect(screen.width).toBe(PORTRAIT_WIDTH)
    expect(screen.height).toBe(390)
    expect(screen.world).toEqual({
      x: 0,
      y: PORTRAIT_HUD_PX,
      width: PORTRAIT_WIDTH,
      height: 240,
    })
    expect(screen.zoom).toBeCloseTo(3 / 2)
    expect(
      portraitHeightFor({ left: 0, top: 0, width: 430, height: 932 }),
    ).toBe(390)
    expect(
      portraitHeightFor({ left: 0, top: 0, width: 360, height: 800 }),
    ).toBe(400)
  })

  test('shows 160 rows of the room in a window as tall as the thumbs leave room for', () => {
    const phones = [
      { width: 390, height: 844, world: 240, viewWidth: 120 },
      { width: 430, height: 932, world: 240, viewWidth: 120 },
      { width: 360, height: 780, world: 240, viewWidth: 120 },
      { width: 360, height: 800, world: 240, viewWidth: 120 },
      { width: 360, height: 840, world: 240, viewWidth: 120 },
    ]
    Array.forEach(phones, phone => {
      const screen = portraitScreen(
        portraitHeightFor({ left: 0, top: 0, ...phone }),
      )
      expect(screen.world.height).toBe(phone.world)
      expect(PORTRAIT_WIDTH / screen.zoom).toBeCloseTo(phone.viewWidth)
      expect(screen.world.height / screen.zoom).toBeCloseTo(PORTRAIT_VIEW_ROWS)
      expect(worldWindowOf(screen)).toEqual({
        width: phone.viewWidth,
        height: PORTRAIT_VIEW_ROWS,
      })
      expect(screen.height - thumbAreaTop(screen)).toBeGreaterThanOrEqual(76)
      expect(screen.world.height).toBeLessThan(screen.height * 0.64)
    })
  })

  test('never zooms a short window out past a phone on its side', () => {
    const short = portraitScreen(
      portraitHeightFor({ left: 0, top: 0, width: 375, height: 667 }),
    )
    expect(short.world.height).toBe(192)
    expect(short.zoom).toBeCloseTo(4 / 3)
    expect(worldWindowOf(short)).toEqual({ width: 135, height: 144 })
    const widest = portraitScreen(
      portraitHeightFor({ left: 0, top: 0, width: 768, height: 1024 }),
    )
    expect(widest.zoom).toBeCloseTo(4 / 3)
    expect(widest.world.height).toBe(180)
    expect(worldWindowOf(widest)).toEqual({ width: 135, height: 135 })
  })

  test('fills the window with whole columns and rows of the room at every height', () => {
    Array.forEach(Array.range(300, 440), height => {
      const screen = portraitScreen(height)
      const window = worldWindowOf(screen)
      expect(window.width * screen.zoom).toBeCloseTo(screen.world.width)
      expect(window.height * screen.zoom).toBeCloseTo(screen.world.height)
    })
  })
})

describe('the landscape phone screen', () => {
  test('zooms the world 4/3 on a touch phone on its side, and widens to the phone', () => {
    const screen = screenOf(fightingInLandscape)
    expect(screen.layout).toBe('Landscape')
    expect(screen.zoom).toBeCloseTo(4 / 3)
    expect(screen).toMatchObject({
      width: 388,
      height: 180,
      world: { x: 0, y: 0, width: 388, height: 180 },
    })
    expect(worldWindowOf(screen)).toEqual({ width: 291, height: 135 })
  })

  test('keeps 320 by 180 on a 16:9 phone and before the surface is measured', () => {
    const sixteenByNine = modifyFields(fightingInLandscape, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 667, height: 375 }),
    })
    expect(screenOf(sixteenByNine)).toEqual(LANDSCAPE_TOUCH_SCREEN)
    const unmeasured = modifyFields(fightingInLandscape, {
      maybeSurface: () => Option.none(),
    })
    expect(screenOf(unmeasured)).toEqual(LANDSCAPE_TOUCH_SCREEN)
    expect(worldWindowOf(LANDSCAPE_TOUCH_SCREEN)).toEqual({
      width: 240,
      height: 135,
    })
  })

  test('widens by whole steps of 4 to the phone, from 320 up to 388', () => {
    const widthAt = (width: number, height: number): number =>
      landscapeWidthFor({ left: 0, top: 0, width, height })
    // NOTE: 16:9, a little wider, iPhone 15 (19.5:9), 20:9, 21:9, and a
    // window narrower than 16:9.
    expect(widthAt(1280, 720)).toBe(320)
    expect(widthAt(1300, 720)).toBe(324)
    expect(widthAt(852, 393)).toBe(388)
    expect(widthAt(800, 400)).toBe(360)
    expect(widthAt(2400, 1080)).toBe(388)
    expect(widthAt(1000, 1000)).toBe(320)
    expect(widthAt(0, 0)).toBe(320)
    Array.forEach(Array.range(560, 1200), width => {
      const wide = widthAt(width, 360)
      expect(wide % 4).toBe(0)
      expect(wide).toBeGreaterThanOrEqual(320)
      expect(wide).toBeLessThanOrEqual(LANDSCAPE_MAX_WIDTH)
      // NOTE: never wider than the phone, so the rows still fill it.
      expect(wide / 180).toBeLessThanOrEqual(Math.max(width / 360, 16 / 9))
      // NOTE: the window shows whole columns of the room at the 4/3 zoom.
      expect(
        Number.isInteger(worldWindowOf(landscapeTouchScreen(wide)).width),
      ).toBe(true)
    })
  })

  test('a wider screen shows more of the room, and nothing bigger', () => {
    const narrow = screenOf(
      modifyFields(fightingInLandscape, {
        maybeSurface: () =>
          Option.some({ left: 0, top: 0, width: 667, height: 375 }),
      }),
    )
    const wide = screenOf(fightingInLandscape)
    expect(wide.zoom).toBe(narrow.zoom)
    expect(worldWindowOf(wide).height).toBe(worldWindowOf(narrow).height)
    expect(worldWindowOf(wide).width).toBeGreaterThan(
      worldWindowOf(narrow).width,
    )
  })

  test('keeps a whole screen of the room at zoom 1 on a keyboard and mouse, in any window', () => {
    // NOTE: the dining room is bigger than one screen, so even at zoom 1
    // the camera follows the player from the start spot, inside the room.
    const { bounds } = levelOf(fightingInLandscape)
    const { player } = focusOf(fightingInLandscape)
    Array.forEach(['Landscape', 'Portrait'] as const, orientation => {
      Array.forEach([PHONE_LANDSCAPE, PHONE_PORTRAIT], surface => {
        const desktop = modifyFields(fightingInLandscape, {
          lastDevice: () => 'KeyboardMouse',
          orientation: () => orientation,
          maybeSurface: () => Option.some(surface),
        })
        expect(screenOf(desktop)).toEqual(LANDSCAPE_SCREEN)
        expect(cameraOf(desktop)).toEqual({
          x: Math.min(player.x - 160, bounds.right - 320),
          y: Math.min(player.y - 90, bounds.bottom - 180),
          width: 320,
          height: 180,
          scale: 1,
          left: 0,
          top: 0,
        })
      })
    })
  })
})

describe('the portrait camera', () => {
  test('follows the player across the room and stops at its walls', () => {
    const { bounds } = levelOf(fightingInPortrait)
    const cameraAt = (x: number) =>
      cameraOf(standingAt(fightingInPortrait, x, 120))
    expect(cameraAt(20)).toEqual({
      x: 0,
      y: 40,
      width: 120,
      height: 160,
      scale: 1,
      left: 0,
      top: 0,
    })
    expect(cameraAt(160)).toMatchObject({ x: 100, y: 40 })
    expect(cameraAt(bounds.right - 20)).toMatchObject({
      x: bounds.right - 120,
      y: 40,
    })
    expect(cameraOf(standingAt(fightingInPortrait, 160, 10))).toMatchObject({
      y: 0,
    })
    expect(
      cameraOf(standingAt(fightingInPortrait, 160, bounds.bottom - 10)),
    ).toMatchObject({ y: bounds.bottom - 160 })
    Array.forEach([0, 40, 90, 200, 260, 320, 360], x => {
      Array.forEach([0, 60, 120, 180, 220], y => {
        const camera = cameraOf(standingAt(fightingInPortrait, x, y))
        expect(camera.x).toBeGreaterThanOrEqual(bounds.left)
        expect(camera.x + camera.width).toBeLessThanOrEqual(bounds.right)
        expect(camera.y).toBeGreaterThanOrEqual(bounds.top)
        expect(camera.y + camera.height).toBeLessThanOrEqual(bounds.bottom)
      })
    })
  })

  test('keeps the player in the middle of the window between the walls', () => {
    const fighting = standingAt(fightingInPortrait, 151, 90)
    const onWindow = worldToView(cameraOf(fighting), focusOf(fighting).player)
    expect(Math.abs(onWindow.x - 120 / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(onWindow.y - 160 / 2)).toBeLessThanOrEqual(0.5)
    const onScreen = worldToView(
      screenCameraOf(fighting),
      focusOf(fighting).player,
    )
    expect(onScreen.x).toBeCloseTo((onWindow.x * 3) / 2)
    expect(onScreen.y).toBeCloseTo((onWindow.y * 3) / 2 + PORTRAIT_HUD_PX)
  })

  test('on a phone on its side, follows the player and stops at the walls', () => {
    const cameraAt = (x: number, y: number) =>
      cameraOf(standingAt(fightingInLandscape, x, y))
    expect(cameraAt(20, 90)).toEqual({
      x: 0,
      y: 23,
      width: 291,
      height: 135,
      scale: 1,
      left: 0,
      top: 0,
    })
    expect(cameraAt(160, 90)).toMatchObject({ x: 15, y: 23 })
    const { bounds } = levelOf(fightingInLandscape)
    expect(cameraAt(bounds.right - 20, bounds.bottom - 10)).toMatchObject({
      x: bounds.right - 291,
      y: bounds.bottom - 135,
    })
    expect(cameraAt(10, 10)).toMatchObject({ x: 0, y: 0 })
    expect(
      screenCameraOf(standingAt(fightingInLandscape, 160, 90)),
    ).toMatchObject({ x: 15, y: 23, scale: 4 / 3, left: 0, top: 0 })
  })

  test('on a phone on its side, reaches the kitchen once it opens and stays in its walls', () => {
    const kitchen = modifyFields(fightingInLandscape, {
      level: level => openExitIn(level, 'Kitchen'),
    })
    const { bounds } = levelOf(kitchen)
    expect(cameraOf(standingAt(fightingInLandscape, 40, 10)).y).toBe(0)
    expect(cameraOf(standingAt(kitchen, 40, bounds.top + 10))).toMatchObject({
      x: 0,
      y: bounds.top,
    })
    Array.forEach([bounds.left, 100, 220, bounds.right], x => {
      Array.forEach([bounds.top, -100, 0, 90, bounds.bottom], y => {
        const camera = cameraOf(standingAt(kitchen, x, y))
        expect(camera.x).toBeGreaterThanOrEqual(bounds.left)
        expect(camera.x + camera.width).toBeLessThanOrEqual(bounds.right)
        expect(camera.y).toBeGreaterThanOrEqual(bounds.top)
        expect(camera.y + camera.height).toBeLessThanOrEqual(bounds.bottom)
      })
    })
  })
})

describe('the aim lean', () => {
  test('eases toward the aim and never goes past its cap', () => {
    const steps = Array.scan(
      Array.makeBy(240, () => FRAME_MS),
      { x: 0, y: 0 },
      (lean, deltaMs) => leanCamera(lean, Option.some({ x: 1, y: 0 }), deltaMs),
    )
    Array.forEach(steps, ({ x, y }) => {
      expect(x).toBeLessThanOrEqual(CAMERA_LEAN_PX)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBe(0)
    })
    expect(steps[1]!.x).toBeLessThan(CAMERA_LEAN_PX / 4)
    expect(steps[steps.length - 1]).toEqual({ x: CAMERA_LEAN_PX, y: 0 })
    expect(
      leanCamera({ x: 0, y: 0 }, Option.some({ x: 1, y: 0 }), 10_000),
    ).toEqual({ x: CAMERA_LEAN_PX, y: 0 })
  })

  it.effect(
    'the right thumb leans the camera toward the aim, and letting go brings it back',
    () =>
      Story.story(
        APPLICATION,
        Story.given(standingAt(fightingInPortrait, 160, 120)),
        pressThumb(RIGHT_THUMB, 300, 700),
        moveThumb(RIGHT_THUMB, 300 + STICK_RADIUS_PX, 700),
        ...ticks(90, FRAME_MS),
        Story.model(current => {
          expect(current.cameraLean.x).toBeGreaterThan(CAMERA_LEAN_PX - 1)
          expect(current.cameraLean.x).toBeLessThanOrEqual(CAMERA_LEAN_PX)
          expect(Math.abs(current.cameraLean.y)).toBeLessThan(0.5)
          const camera = cameraOf(current)
          expect(camera.x).toBeGreaterThan(93)
          expect(focusOf(current).player.x - camera.x).toBeLessThan(135 / 2)
        }),
        Story.message(Message.ReleasedPointer({ pointerId: RIGHT_THUMB })),
        ...ticks(120, FRAME_MS),
        Story.model(current => {
          expect(current.cameraLean).toEqual({ x: 0, y: 0 })
        }),
      ),
  )

  it.effect('the same messages lean the camera the same way every time', () => {
    const leanAfter = () =>
      modelAfterMessages(standingAt(fightingInPortrait, 200, 100), [
        Message.PressedPointer({
          pointerId: RIGHT_THUMB,
          device: 'Touch',
          clientX: 300,
          clientY: 700,
        }),
        Message.MovedPointer({
          pointerId: RIGHT_THUMB,
          clientX: 260,
          clientY: 680,
        }),
        ...Array.makeBy(37, index =>
          Message.TickedFrame({ deltaTime: 10 + (index % 7) }),
        ),
      ])
    return Effect.gen(function* () {
      const first = yield* leanAfter()
      const second = yield* leanAfter()
      expect(first.cameraLean).toEqual(second.cameraLean)
      expect(first.cameraLean.x).toBeLessThan(0)
    })
  })
})

describe('portrait input', () => {
  it.effect('the sticks stay in screen space wherever the camera is', () => {
    const aimFrom = (x: number) =>
      modelAfterMessages(standingAt(fightingInPortrait, x, 120), [
        Message.PressedPointer({
          pointerId: RIGHT_THUMB,
          device: 'Touch',
          clientX: 300,
          clientY: 700,
        }),
        Message.MovedPointer({
          pointerId: RIGHT_THUMB,
          clientX: 300,
          clientY: 700 - STICK_RADIUS_PX,
        }),
        Message.PressedPointer({
          pointerId: LEFT_THUMB,
          device: 'Touch',
          clientX: 80,
          clientY: 700,
        }),
      ])
    return Effect.gen(function* () {
      const atLeftWall = yield* aimFrom(20)
      const atRightWall = yield* aimFrom(300)
      expect(cameraOf(atLeftWall).x).not.toBe(cameraOf(atRightWall).x)
      Array.forEach([atLeftWall, atRightWall], fighting => {
        expect(fighting.input.aimStick).toEqual(
          Stick.Active({
            pointerId: RIGHT_THUMB,
            originX: 300,
            originY: 700,
            currentX: 300,
            currentY: 700 - STICK_RADIUS_PX,
          }),
        )
        expect(Stick.isAnyOf(['Active'])(fighting.input.moveStick)).toBe(true)
        expect(focusOf(fighting).intent.maybeAim).toEqual(
          Option.some({ x: 0, y: -1 }),
        )
      })
    })
  })

  test('a point on a portrait phone turns into the world point under it', () => {
    const fighting = standingAt(fightingInPortrait, 300, 120)
    const screen = screenOf(fighting)
    const scale = PHONE_PORTRAIT.width / screen.width
    const onScreen = Option.getOrThrow(
      clientToView(PHONE_PORTRAIT, { x: 195, y: 422 }, screen),
    )
    expect(onScreen.x).toBeCloseTo(90)
    expect(onScreen.y).toBeCloseTo(
      (422 - (PHONE_PORTRAIT.height - screen.height * scale) / 2) / scale,
    )
    const world = viewToWorld(screenCameraOf(fighting), onScreen)
    expect(world.x).toBeCloseTo(90 / screen.zoom + cameraOf(fighting).x)
    expect(world.y).toBeCloseTo(
      (onScreen.y - PORTRAIT_HUD_PX) / screen.zoom + cameraOf(fighting).y,
    )
    const back = worldToView(screenCameraOf(fighting), world)
    expect(back.x).toBeCloseTo(onScreen.x)
    expect(back.y).toBeCloseTo(onScreen.y)
  })
})

describe('aiming on a phone on its side', () => {
  test('a point on the screen turns into the world point under it, through the zoom', () => {
    const fighting = standingAt(fightingInLandscape, 200, 120)
    const screen = screenOf(fighting)
    const camera = cameraOf(fighting)
    expect(camera).toMatchObject({ x: 55, y: 53 })
    const onScreen = Option.getOrThrow(
      clientToView(PHONE_LANDSCAPE, { x: 422, y: 195 }, screen),
    )
    expect(onScreen.x).toBeCloseTo(194)
    expect(onScreen.y).toBeCloseTo(90)
    const world = viewToWorld(screenCameraOf(fighting), onScreen)
    expect(world.x).toBeCloseTo(194 * (3 / 4) + 55)
    expect(world.y).toBeCloseTo(90 * (3 / 4) + camera.y)
    const back = worldToView(screenCameraOf(fighting), world)
    expect(back.x).toBeCloseTo(onScreen.x)
    expect(back.y).toBeCloseTo(onScreen.y)
  })

  test('a mouse pointed at a zombie on the zoomed screen aims at that zombie', () => {
    const fighting = standingAt(fightingInLandscape, 200, 120)
    const zombie = { x: 260, y: 60 }
    const onScreen = worldToView(screenCameraOf(fighting), zombie)
    const aimed = refreshIntent(
      modifyFields(fighting, {
        input: input => ({
          ...input,
          maybeMouseInView: Option.some(onScreen),
        }),
      }),
    )
    const length = Math.hypot(zombie.x - 200, zombie.y - 120)
    const aim = Option.getOrThrow(focusOf(aimed).intent.maybeAim)
    expect(aim.x).toBeCloseTo((zombie.x - 200) / length)
    expect(aim.y).toBeCloseTo((zombie.y - 120) / length)
  })
})

describe('the hint band on a zoomed phone', () => {
  test('moves away from the player where the player is on the screen, not in the room', () => {
    const at = (base: Model) =>
      moveHintBand(
        modifyFields(standingAt(base, 160, 60), { hintBand: () => 'Top' }),
      ).hintBand
    expect(
      at(
        modifyFields(fightingInLandscape, {
          lastDevice: () => 'KeyboardMouse',
        }),
      ),
    ).toBe('Bottom')
    expect(at(fightingInLandscape)).toBe('Top')
  })
})

describe('turning the phone', () => {
  it.effect(
    'mid-wave, the run, the keys, and both thumbs carry over, with no pause',
    () => {
      const rich = withKeys(
        modifyFields(standingAt(fightingInLandscape, 120, 90), {
          stats: scoring(340),
        }),
        7,
      )
      return Story.story(
        APPLICATION,
        Story.given(rich),
        pressThumb(LEFT_THUMB, 120, 300),
        pressThumb(RIGHT_THUMB, 700, 300),
        moveThumb(RIGHT_THUMB, 700 + STICK_RADIUS_PX, 300),
        rotateTo(PHONE_PORTRAIT),
        Story.model(current => {
          expect(isPortrait(current)).toBe(true)
          expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
          expect(scoreOf(current.stats)).toBe(340)
          expect(current.keys.held).toBe(7)
          expect(Stick.isAnyOf(['Active'])(current.input.moveStick)).toBe(true)
          expect(Stick.isAnyOf(['Active'])(current.input.aimStick)).toBe(true)
          expect(focusOf(current).intent.trigger).toBe('Held')
        }),
        ...ticks(3, FRAME_MS),
        Story.model(current => {
          expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
          expect(current.stats.shotsFired).toBeGreaterThan(0)
        }),
        rotateTo(PHONE_LANDSCAPE),
        Story.model(current => {
          expect(isPortrait(current)).toBe(false)
          expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
          expect(Stick.isAnyOf(['Active'])(current.input.aimStick)).toBe(true)
        }),
      )
    },
  )
})
