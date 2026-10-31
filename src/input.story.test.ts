import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, STICK_FIRE_ZONE, STICK_RADIUS_PX } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Bullet, MouseButton, Phase, Stick } from './model'
import { FIGHTING_PHASE, playingModel, readyModel } from './model.fixture'
import { holdingSecond, tick, touchDown, touchMove } from './testing'
import { WEAPONS, freshGun } from './weapons'

const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const STRAY_POINTER = 99
const MOUSE_POINTER = 1

describe('touch sticks', () => {
  test('two thumbs drive the move and aim sticks independently', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(RIGHT_THUMB, 700, 300),
      model(({ input }) => {
        expect(input.moveStick).toEqual(
          Stick.Active({
            pointerId: LEFT_THUMB,
            originX: 100,
            originY: 300,
            currentX: 100,
            currentY: 300,
          }),
        )
        expect(input.aimStick).toEqual(
          Stick.Active({
            pointerId: RIGHT_THUMB,
            originX: 700,
            originY: 300,
            currentX: 700,
            currentY: 300,
          }),
        )
      }),
      touchMove(LEFT_THUMB, 100 + STICK_RADIUS_PX / 2, 300),
      touchMove(RIGHT_THUMB, 700, 300 - STICK_RADIUS_PX),
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 0.5, y: 0 })
        expect(intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
        expect(intent.trigger).toBe('Held')
      }),
      touchMove(LEFT_THUMB, 100 + STICK_RADIUS_PX * 3, 300),
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 1, y: 0 })
      }),
      message(Message.ReleasedPointer({ pointerId: LEFT_THUMB })),
      model(({ input, intent }) => {
        expect(input.moveStick).toEqual(Stick.Idle())
        expect(Stick.guards.Active(input.aimStick)).toBe(true)
        expect(intent.move).toEqual({ x: 0, y: 0 })
        expect(intent.trigger).toBe('Held')
      }),
    )
  })

  test('a thumb that lands on the aim stick fires only once pushed, and the shot goes where it points', () => {
    const shotgunInHand = modifyFields(playingModel, {
      player: player =>
        modifyFields(player, {
          facing: () => ({ x: 1, y: 0 }),
          arsenal: () => holdingSecond(freshGun('Shotgun')),
        }),
    })
    const isUpward = ({ velocityX, velocityY }: Bullet): boolean =>
      Math.abs(Math.atan2(velocityY, velocityX) + Math.PI / 2) <=
      WEAPONS.Shotgun.spread / 2 + 0.01

    story(
      update,
      given(shotgunInHand),
      touchDown(RIGHT_THUMB, 700, 300),
      tick(FIXED_STEP_MS),
      model(({ intent, bullets, player }) => {
        expect(intent.trigger).toBe('Released')
        expect(bullets).toEqual([])
        expect(player.facing).toEqual({ x: 1, y: 0 })
      }),
      touchMove(RIGHT_THUMB, 700, 300 - STICK_RADIUS_PX * 0.3),
      tick(FIXED_STEP_MS),
      model(({ intent, bullets, player }) => {
        expect(intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
        expect(intent.trigger).toBe('Released')
        expect(bullets).toEqual([])
        expect(player.facing).toEqual({ x: 0, y: -1 })
      }),
      touchMove(
        RIGHT_THUMB,
        700,
        300 - STICK_RADIUS_PX * (STICK_FIRE_ZONE + 0.05),
      ),
      tick(FIXED_STEP_MS),
      model(({ intent, bullets }) => {
        expect(intent.trigger).toBe('Held')
        expect(bullets).toHaveLength(WEAPONS.Shotgun.pellets)
        expect(Array.every(bullets, isUpward)).toBe(true)
      }),
    )
  })

  test('ignores pointer events whose id matches no stick', () => {
    const twoThumbsModel = modifyFields(playingModel, {
      input: input =>
        modifyFields(input, {
          moveStick: () =>
            Stick.Active({
              pointerId: LEFT_THUMB,
              originX: 100,
              originY: 300,
              currentX: 120,
              currentY: 300,
            }),
          aimStick: () =>
            Stick.Active({
              pointerId: RIGHT_THUMB,
              originX: 700,
              originY: 300,
              currentX: 700,
              currentY: 280,
            }),
        }),
    })

    story(
      update,
      given(twoThumbsModel),
      touchMove(STRAY_POINTER, 10, 10),
      message(Message.ReleasedPointer({ pointerId: STRAY_POINTER })),
      message(Message.CancelledPointer({ pointerId: STRAY_POINTER })),
      model(({ input }) => {
        expect(input).toEqual(twoThumbsModel.input)
      }),
    )
  })

  test('a third touch on an occupied half does not steal the stick', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(STRAY_POINTER, 200, 100),
      touchMove(STRAY_POINTER, 300, 100),
      model(({ input }) => {
        expect(input.moveStick).toEqual(
          Stick.Active({
            pointerId: LEFT_THUMB,
            originX: 100,
            originY: 300,
            currentX: 100,
            currentY: 300,
          }),
        )
        expect(input.aimStick).toEqual(Stick.Idle())
      }),
    )
  })

  test('pointercancel clears the stick it owns', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(RIGHT_THUMB, 700, 300),
      message(Message.CancelledPointer({ pointerId: RIGHT_THUMB })),
      model(({ input, intent }) => {
        expect(input.aimStick).toEqual(Stick.Idle())
        expect(Stick.guards.Active(input.moveStick)).toBe(true)
        expect(intent.trigger).toBe('Released')
      }),
    )
  })

  test('a tap on the home menu, beside its buttons, starts nothing and grabs no stick', () => {
    story(
      update,
      given(readyModel),
      touchDown(LEFT_THUMB, 100, 300),
      model(({ phase, input }) => {
        expect(Phase.guards.Ready(phase)).toBe(true)
        expect(Stick.guards.Idle(input.moveStick)).toBe(true)
      }),
    )
  })
})

describe('mouse', () => {
  test('aims at the pointer through the letterboxed canvas and fires while held', () => {
    const letterboxedModel = modifyFields(playingModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 640, height: 480 }),
    })

    story(
      update,
      given(letterboxedModel),
      message(Message.MovedMouse({ clientX: 320, clientY: 60 })),
      model(({ input, intent }) => {
        expect(input.maybeMouseInView).toEqual(Option.some({ x: 160, y: 0 }))
        expect(intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
        expect(intent.trigger).toBe('Released')
      }),
      message(
        Message.PressedPointer({
          pointerId: MOUSE_POINTER,
          device: 'Mouse',
          clientX: 640,
          clientY: 240,
        }),
      ),
      model(({ input, intent }) => {
        expect(input.mouseButton).toEqual(
          MouseButton.Held({ pointerId: MOUSE_POINTER }),
        )
        expect(intent.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))
        expect(intent.trigger).toBe('Held')
      }),
      message(Message.ReleasedPointer({ pointerId: MOUSE_POINTER })),
      model(({ intent }) => {
        expect(intent.trigger).toBe('Released')
      }),
    )
  })
})

describe('page visibility', () => {
  test('hiding the page pauses the game and releases input', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      message(Message.PressedKey({ code: 'KeyD' })),
      message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      model(({ phase, input, intent }) => {
        expect(phase).toEqual(Phase.Paused({ round: FIGHTING_PHASE }))
        expect(input.moveStick).toEqual(Stick.Idle())
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
      }),
      tick(FIXED_STEP_MS),
      model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(0)
      }),
      message(Message.PressedKey({ code: 'Escape' })),
      model(({ phase }) => {
        expect(phase).toEqual(FIGHTING_PHASE)
      }),
    )
  })
})
