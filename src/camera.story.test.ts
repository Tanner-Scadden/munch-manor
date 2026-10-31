import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR, ROOM_MAP, makeLevel } from './arena'
import { cameraFor, cameraOf, viewToWorld, worldToView } from './camera'
import { VIEW_HEIGHT, VIEW_WIDTH } from './constants'
import { deriveIntent } from './input'
import { update } from './main'
import { Message } from './message'
import { type Input, type Model, Phase, initialModel } from './model'
import { clientToView } from './screen'
import { WIDE_SURFACE } from './testing'

const WIDE_LEVEL = makeLevel(Array.map(ROOM_MAP, line => line + line))

const NARROW_LEVEL = makeLevel(Array.map(ROOM_MAP, line => line.slice(0, 16)))

const playingModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(WIDE_SURFACE),
  phase: () =>
    Phase.Wave({
      wave: 1,
      elapsedMs: 0,
      spawns: [],
    }),
})

const mouseInputAt = (mouseInView: { x: number; y: number }): Input => ({
  ...initialModel.input,
  maybeMouseInView: Option.some(mouseInView),
})

describe('camera', () => {
  test('stands still on the one-screen arena wherever the player goes', () => {
    expect(PARLOUR.width).toBe(VIEW_WIDTH)
    expect(PARLOUR.height).toBe(VIEW_HEIGHT)
    Array.forEach(
      [
        { x: 10, y: 10 },
        { x: 160, y: 90 },
        { x: 310, y: 170 },
      ],
      focus => {
        expect(cameraFor(PARLOUR, focus)).toMatchObject({ x: 0, y: 0 })
      },
    )
  })

  test('follows the player across a map twice the width and stops at its edges', () => {
    expect(WIDE_LEVEL.width).toBe(VIEW_WIDTH * 2)
    expect(WIDE_LEVEL.height).toBe(VIEW_HEIGHT)

    expect(cameraFor(WIDE_LEVEL, { x: 320, y: 90 })).toMatchObject({
      x: 160,
      y: 0,
    })
    expect(cameraFor(WIDE_LEVEL, { x: 400.4, y: 30 })).toMatchObject({
      x: 240,
      y: 0,
    })
    expect(cameraFor(WIDE_LEVEL, { x: 40, y: 90 })).toMatchObject({
      x: 0,
      y: 0,
    })
    expect(cameraFor(WIDE_LEVEL, { x: 620, y: 170 })).toMatchObject({
      x: WIDE_LEVEL.width - VIEW_WIDTH,
      y: 0,
    })
  })

  test('keeps the followed player in the middle of the view between the edges', () => {
    const player = { x: 333, y: 90 }
    const camera = cameraFor(WIDE_LEVEL, player)
    const onScreen = worldToView(camera, player)
    expect(Math.abs(onScreen.x - VIEW_WIDTH / 2)).toBeLessThanOrEqual(0.5)
    expect(viewToWorld(camera, onScreen)).toEqual(player)
  })

  test('centers a map narrower than the view and holds it still', () => {
    expect(NARROW_LEVEL.width).toBe(VIEW_WIDTH / 2)
    expect(cameraFor(NARROW_LEVEL, { x: 10, y: 90 })).toMatchObject({
      x: -VIEW_WIDTH / 4,
      y: 0,
    })
    expect(cameraFor(NARROW_LEVEL, { x: 150, y: 90 })).toMatchObject({
      x: -VIEW_WIDTH / 4,
      y: 0,
    })
  })

  test('aims the mouse at the world point under the cursor on a scrolled map', () => {
    const player = {
      ...initialModel.player,
      x: 400,
      y: 90,
    }
    const camera = cameraFor(WIDE_LEVEL, player)
    expect(camera).toMatchObject({ x: 240, y: 0 })

    const cursorInView = Option.getOrThrow(
      clientToView(WIDE_SURFACE, { x: 1120, y: 360 }),
    )
    expect(cursorInView).toEqual({ x: 280, y: 90 })
    expect(viewToWorld(camera, cursorInView)).toEqual({ x: 520, y: 90 })

    const scrolledAim = deriveIntent(mouseInputAt(cursorInView), player, camera)
    expect(scrolledAim.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))

    const leftOfPlayer = { x: 100, y: 90 }
    const unscrolledAim = deriveIntent(
      mouseInputAt(leftOfPlayer),
      player,
      cameraFor(PARLOUR, player),
    )
    expect(unscrolledAim.maybeAim).toEqual(Option.some({ x: -1, y: 0 }))
    const followedAim = deriveIntent(mouseInputAt(leftOfPlayer), player, camera)
    expect(followedAim.maybeAim).toEqual(Option.some({ x: -1, y: 0 }))
    expect(viewToWorld(camera, leftOfPlayer)).toEqual({ x: 340, y: 90 })
  })

  test('in the arena, the mouse aims where it points on the screen', () => {
    story(
      update,
      given(
        modifyFields(playingModel, {
          player: player => ({ ...player, x: 100, y: 90 }),
        }),
      ),
      message(Message.MovedMouse({ clientX: 1000, clientY: 360 })),
      model(current => {
        expect(cameraOf(current)).toMatchObject({ x: 0, y: 0 })
        expect(current.input.maybeMouseInView).toEqual(
          Option.some({ x: 250, y: 90 }),
        )
        expect(current.intent.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))
      }),
    )
  })
})
