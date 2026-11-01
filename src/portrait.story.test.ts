import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { levelOf, openExitIn } from './arena'
import {
  cameraOf,
  leanCamera,
  screenCameraOf,
  viewToWorld,
  worldToView,
  worldWindowOf,
} from './camera'
import { CAMERA_LEAN_PX, FIXED_STEP_MS, STICK_RADIUS_PX } from './constants'
import { refreshIntent } from './frame'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, Stick, initialModel } from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { moveHintBand } from './onboarding'
import {
  LANDSCAPE_SCREEN,
  PORTRAIT_HUD_PX,
  PORTRAIT_VIEW_ROWS,
  PORTRAIT_WIDTH,
  clientToView,
  isPortrait,
  portraitHeightFor,
  portraitScreen,
  screenOf,
  thumbAreaTop,
} from './screen'
import { scoreOf } from './stats'
import { PHONE_LANDSCAPE, PHONE_PORTRAIT, scoring, ticks } from './testing'
import { asVeteran } from './veteran'

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
  modifyFields(base, { player: player => ({ ...player, x, y }) })

const pressThumb = (pointerId: number, clientX: number, clientY: number) =>
  message(
    Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
  )

const moveThumb = (pointerId: number, clientX: number, clientY: number) =>
  message(Message.MovedPointer({ pointerId, clientX, clientY }))

const rotateTo = (surface: typeof PHONE_PORTRAIT) =>
  message(Message.MeasuredGameSurface(surface))

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
  test('zooms the world 4/3 on a touch phone on its side, and the HUD keeps its screen', () => {
    const screen = screenOf(fightingInLandscape)
    expect(screen.layout).toBe('Landscape')
    expect(screen.zoom).toBeCloseTo(4 / 3)
    expect(screen).toMatchObject({
      width: 320,
      height: 180,
      world: { x: 0, y: 0, width: 320, height: 180 },
    })
    expect(worldWindowOf(screen)).toEqual({ width: 240, height: 135 })
  })

  test('keeps the whole room at zoom 1 on a keyboard and mouse, in any window', () => {
    Array.forEach(['Landscape', 'Portrait'] as const, orientation => {
      Array.forEach([PHONE_LANDSCAPE, PHONE_PORTRAIT], surface => {
        const desktop = modifyFields(fightingInLandscape, {
          lastDevice: () => 'KeyboardMouse',
          orientation: () => orientation,
          maybeSurface: () => Option.some(surface),
        })
        expect(screenOf(desktop)).toEqual(LANDSCAPE_SCREEN)
        expect(cameraOf(desktop)).toEqual({
          x: 0,
          y: 0,
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
    const cameraAt = (x: number) =>
      cameraOf(standingAt(fightingInPortrait, x, 120))
    expect(cameraAt(20)).toEqual({
      x: 0,
      y: 20,
      width: 120,
      height: 160,
      scale: 1,
      left: 0,
      top: 0,
    })
    expect(cameraAt(160)).toMatchObject({ x: 100, y: 20 })
    expect(cameraAt(300)).toMatchObject({ x: 200, y: 20 })
    expect(cameraOf(standingAt(fightingInPortrait, 160, 10))).toMatchObject({
      y: 0,
    })
    Array.forEach([0, 40, 90, 200, 260, 320], x => {
      Array.forEach([0, 60, 120, 180], y => {
        const camera = cameraOf(standingAt(fightingInPortrait, x, y))
        expect(camera.x).toBeGreaterThanOrEqual(0)
        expect(camera.x + camera.width).toBeLessThanOrEqual(320)
        expect(camera.y).toBeGreaterThanOrEqual(0)
        expect(camera.y + camera.height).toBeLessThanOrEqual(180)
      })
    })
  })

  test('keeps the player in the middle of the window between the walls', () => {
    const fighting = standingAt(fightingInPortrait, 151, 90)
    const onWindow = worldToView(cameraOf(fighting), fighting.player)
    expect(Math.abs(onWindow.x - 120 / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(onWindow.y - 160 / 2)).toBeLessThanOrEqual(0.5)
    const onScreen = worldToView(screenCameraOf(fighting), fighting.player)
    expect(onScreen.x).toBeCloseTo((onWindow.x * 3) / 2)
    expect(onScreen.y).toBeCloseTo((onWindow.y * 3) / 2 + PORTRAIT_HUD_PX)
  })

  test('on a phone on its side, follows the player and stops at the walls', () => {
    const cameraAt = (x: number, y: number) =>
      cameraOf(standingAt(fightingInLandscape, x, y))
    expect(cameraAt(20, 90)).toEqual({
      x: 0,
      y: 23,
      width: 240,
      height: 135,
      scale: 1,
      left: 0,
      top: 0,
    })
    expect(cameraAt(160, 90)).toMatchObject({ x: 40, y: 23 })
    expect(cameraAt(300, 170)).toMatchObject({ x: 80, y: 45 })
    expect(cameraAt(10, 10)).toMatchObject({ x: 0, y: 0 })
    expect(
      screenCameraOf(standingAt(fightingInLandscape, 160, 90)),
    ).toMatchObject({ x: 40, y: 23, scale: 4 / 3, left: 0, top: 0 })
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
    const steps = Array.reduce(
      Array.makeBy(240, () => FRAME_MS),
      [{ x: 0, y: 0 }],
      (leans, deltaMs) => [
        ...leans,
        leanCamera(
          leans[leans.length - 1]!,
          Option.some({ x: 1, y: 0 }),
          deltaMs,
        ),
      ],
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

  test('the right thumb leans the camera toward the aim, and letting go brings it back', () => {
    story(
      update,
      given(standingAt(fightingInPortrait, 160, 120)),
      pressThumb(RIGHT_THUMB, 300, 700),
      moveThumb(RIGHT_THUMB, 300 + STICK_RADIUS_PX, 700),
      ...ticks(90, FRAME_MS),
      model(current => {
        expect(current.cameraLean.x).toBeGreaterThan(CAMERA_LEAN_PX - 1)
        expect(current.cameraLean.x).toBeLessThanOrEqual(CAMERA_LEAN_PX)
        expect(Math.abs(current.cameraLean.y)).toBeLessThan(0.5)
        const camera = cameraOf(current)
        expect(camera.x).toBeGreaterThan(93)
        expect(current.player.x - camera.x).toBeLessThan(135 / 2)
      }),
      message(Message.ReleasedPointer({ pointerId: RIGHT_THUMB })),
      ...ticks(120, FRAME_MS),
      model(current => {
        expect(current.cameraLean).toEqual({ x: 0, y: 0 })
      }),
    )
  })

  test('the same messages lean the camera the same way every time', () => {
    const leanAfter = (): Model => {
      const steps = [
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
      ]
      return Array.reduce(
        steps,
        standingAt(fightingInPortrait, 200, 100),
        (current, next) => update(current, next).model,
      )
    }
    const first = leanAfter()
    const second = leanAfter()
    expect(first.cameraLean).toEqual(second.cameraLean)
    expect(first.cameraLean.x).toBeLessThan(0)
  })
})

describe('portrait input', () => {
  test('the sticks stay in screen space wherever the camera is', () => {
    const aimFrom = (x: number): Model =>
      Array.reduce(
        [
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
        ],
        standingAt(fightingInPortrait, x, 120),
        (current, next) => update(current, next).model,
      )
    const atLeftWall = aimFrom(20)
    const atRightWall = aimFrom(300)
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
      expect(fighting.intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
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
    expect(camera).toMatchObject({ x: 80, y: 45 })
    const onScreen = Option.getOrThrow(
      clientToView(PHONE_LANDSCAPE, { x: 422, y: 195 }, screen),
    )
    expect(onScreen.x).toBeCloseTo(160)
    expect(onScreen.y).toBeCloseTo(90)
    const world = viewToWorld(screenCameraOf(fighting), onScreen)
    expect(world.x).toBeCloseTo(160 * (3 / 4) + 80)
    expect(world.y).toBeCloseTo(90 * (3 / 4) + 45)
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
    const aim = Option.getOrThrow(aimed.intent.maybeAim)
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
  test('mid-wave, the run, the money, and both thumbs carry over, with no pause', () => {
    const rich = modifyFields(standingAt(fightingInLandscape, 120, 90), {
      stats: scoring(340),
      wallet: () => ({ balance: 75, earned: 120, shown: 75 }),
    })
    story(
      update,
      given(rich),
      pressThumb(LEFT_THUMB, 120, 300),
      pressThumb(RIGHT_THUMB, 700, 300),
      moveThumb(RIGHT_THUMB, 700 + STICK_RADIUS_PX, 300),
      rotateTo(PHONE_PORTRAIT),
      model(current => {
        expect(isPortrait(current)).toBe(true)
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(scoreOf(current.stats)).toBe(340)
        expect(current.wallet.balance).toBe(75)
        expect(Stick.isAnyOf(['Active'])(current.input.moveStick)).toBe(true)
        expect(Stick.isAnyOf(['Active'])(current.input.aimStick)).toBe(true)
        expect(current.intent.trigger).toBe('Held')
      }),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(current.stats.shotsFired).toBeGreaterThan(0)
      }),
      rotateTo(PHONE_LANDSCAPE),
      model(current => {
        expect(isPortrait(current)).toBe(false)
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(Stick.isAnyOf(['Active'])(current.input.aimStick)).toBe(true)
      }),
    )
  })
})
