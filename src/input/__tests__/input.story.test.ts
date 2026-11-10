import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Bullet, Phase } from '../../app/model'
import { cameraOf, worldToView } from '../../render/camera'
import {
  FIXED_STEP_MS,
  STICK_FIRE_ZONE,
  STICK_RADIUS_PX,
} from '../../shared/constants'
import { holdingSecond } from '../../test/arsenals'
import {
  FIGHTING_PHASE,
  playingModel,
  readyModel,
} from '../../test/model.fixture'
import { APPLICATION, tick, touchDown, touchMove } from '../../test/testing'
import { WEAPONS, freshGun } from '../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../world/party/party'
import { MouseButton, Stick } from '../inputSchema'

const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const STRAY_POINTER = 99
const MOUSE_POINTER = 1

describe('touch sticks', () => {
  it.effect('two thumbs drive the move and aim sticks independently', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(RIGHT_THUMB, 700, 300),
      Story.model(({ input }) => {
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
      Story.model(({ seats: [{ intent }] }) => {
        expect(intent.move).toEqual({ x: 0.5, y: 0 })
        expect(intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
        expect(intent.trigger).toBe('Held')
      }),
      touchMove(LEFT_THUMB, 100 + STICK_RADIUS_PX * 3, 300),
      Story.model(({ seats: [{ intent }] }) => {
        expect(intent.move).toEqual({ x: 1, y: 0 })
      }),
      Story.message(Message.ReleasedPointer({ pointerId: LEFT_THUMB })),
      Story.model(({ input, seats: [{ intent }] }) => {
        expect(input.moveStick).toEqual(Stick.Idle())
        expect(Stick.guards.Active(input.aimStick)).toBe(true)
        expect(intent.move).toEqual({ x: 0, y: 0 })
        expect(intent.trigger).toBe('Held')
      }),
    ),
  )

  it.effect(
    'a thumb that lands on the aim stick fires only once pushed, and the shot goes where it points',
    () => {
      const shotgunInHand = modifyFocus(playingModel, {
        player: player =>
          modifyFields(player, {
            facing: () => ({ x: 1, y: 0 }),
            arsenal: () => holdingSecond(freshGun('Shotgun')),
          }),
      })
      const isUpward = ({ velocityX, velocityY }: Bullet): boolean =>
        Math.abs(Math.atan2(velocityY, velocityX) + Math.PI / 2) <=
        WEAPONS.Shotgun.spread / 2 + 0.01

      return Story.story(
        APPLICATION,
        Story.given(shotgunInHand),
        touchDown(RIGHT_THUMB, 700, 300),
        tick(FIXED_STEP_MS),
        Story.model(({ seats: [{ intent, player }], bullets }) => {
          expect(intent.trigger).toBe('Released')
          expect(bullets).toEqual([])
          expect(player.facing).toEqual({ x: 1, y: 0 })
        }),
        touchMove(RIGHT_THUMB, 700, 300 - STICK_RADIUS_PX * 0.3),
        tick(FIXED_STEP_MS),
        Story.model(({ seats: [{ intent, player }], bullets }) => {
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
        Story.model(({ seats: [{ intent }], bullets }) => {
          expect(intent.trigger).toBe('Held')
          expect(bullets).toHaveLength(WEAPONS.Shotgun.pellets)
          expect(Array.every(bullets, isUpward)).toBe(true)
        }),
      )
    },
  )

  it.effect('ignores pointer events whose id matches no stick', () => {
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

    return Story.story(
      APPLICATION,
      Story.given(twoThumbsModel),
      touchMove(STRAY_POINTER, 10, 10),
      Story.message(Message.ReleasedPointer({ pointerId: STRAY_POINTER })),
      Story.message(Message.CancelledPointer({ pointerId: STRAY_POINTER })),
      Story.model(({ input }) => {
        expect(input).toEqual(twoThumbsModel.input)
      }),
    )
  })

  it.effect('a third touch on an occupied half does not steal the stick', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(STRAY_POINTER, 200, 100),
      touchMove(STRAY_POINTER, 300, 100),
      Story.model(({ input }) => {
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
    ),
  )

  it.effect('pointercancel clears the stick it owns', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(RIGHT_THUMB, 700, 300),
      Story.message(Message.CancelledPointer({ pointerId: RIGHT_THUMB })),
      Story.model(({ input, seats: [{ intent }] }) => {
        expect(input.aimStick).toEqual(Stick.Idle())
        expect(Stick.guards.Active(input.moveStick)).toBe(true)
        expect(intent.trigger).toBe('Released')
      }),
    ),
  )

  it.effect(
    'a tap on the home menu, beside its buttons, starts nothing and grabs no stick',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        touchDown(LEFT_THUMB, 100, 300),
        Story.model(({ phase, input }) => {
          expect(Phase.guards.Ready(phase)).toBe(true)
          expect(Stick.guards.Idle(input.moveStick)).toBe(true)
        }),
      ),
  )
})

describe('mouse', () => {
  it.effect(
    'aims at the pointer through the letterboxed canvas and fires while held',
    () => {
      const letterboxedModel = modifyFields(playingModel, {
        maybeSurface: () =>
          Option.some({ left: 0, top: 0, width: 640, height: 480 }),
      })
      // NOTE: the canvas is drawn twice as big, 60 px below the top. The
      // dining room is bigger than a screen, so the camera follows the
      // player, and the player's row on the screen is read off it.
      const playerView = worldToView(
        cameraOf(letterboxedModel),
        focusOf(letterboxedModel).player,
      )

      return Story.story(
        APPLICATION,
        Story.given(letterboxedModel),
        Story.message(Message.MovedMouse({ clientX: 320, clientY: 60 })),
        Story.model(({ input, seats: [{ intent }] }) => {
          expect(input.maybeMouseInView).toEqual(Option.some({ x: 160, y: 0 }))
          expect(intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
          expect(intent.trigger).toBe('Released')
        }),
        Story.message(
          Message.PressedPointer({
            pointerId: MOUSE_POINTER,
            device: 'Mouse',
            clientX: 640,
            clientY: 60 + playerView.y * 2,
          }),
        ),
        Story.model(({ input, seats: [{ intent }] }) => {
          expect(input.mouseButton).toEqual(
            MouseButton.Held({ pointerId: MOUSE_POINTER }),
          )
          expect(intent.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))
          expect(intent.trigger).toBe('Held')
        }),
        Story.message(Message.ReleasedPointer({ pointerId: MOUSE_POINTER })),
        Story.model(({ seats: [{ intent }] }) => {
          expect(intent.trigger).toBe('Released')
        }),
      )
    },
  )
})

describe('page visibility', () => {
  it.effect('hiding the page pauses the game and releases input', () =>
    Story.story(
      APPLICATION,
      Story.given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      Story.message(Message.PressedKey({ code: 'KeyD' })),
      Story.message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      Story.model(({ phase, input, seats: [{ intent }] }) => {
        expect(phase).toEqual(Phase.Paused({ round: FIGHTING_PHASE }))
        expect(input.moveStick).toEqual(Stick.Idle())
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
      }),
      tick(FIXED_STEP_MS),
      Story.model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(0)
      }),
      Story.message(Message.PressedKey({ code: 'Escape' })),
      Story.model(({ phase }) => {
        expect(phase).toEqual(FIGHTING_PHASE)
      }),
    ),
  )
})
