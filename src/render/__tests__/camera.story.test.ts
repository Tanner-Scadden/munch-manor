import { Array, Option, String } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Model, Phase } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { deriveIntent } from '#input/input.ts'
import type { Input } from '#input/inputSchema.ts'
import {
  cameraFor,
  cameraOf,
  viewToWorld,
  worldToView,
} from '#render/camera.ts'
import { clientToView } from '#render/screen.ts'
import { VIEW_HEIGHT, VIEW_WIDTH } from '#shared/constants.ts'
import { floorSeenOf, nearly } from '#test/lensTesting.ts'
import {
  WIDE_SURFACE,
  checkModel,
  modelAfter,
  send,
  steps,
} from '#test/testing.ts'
import { PARLOUR, makeLevel } from '#world/level/arena.ts'
import { ROOM_MAP } from '#world/level/plan.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'

const WIDE_LEVEL = makeLevel(Array.map(ROOM_MAP, line => line + line))

const NARROW_LEVEL = makeLevel(
  Array.map(ROOM_MAP, line => String.slice(0, 16)(line)),
)

const ONE_SCREEN_Y = cameraFor(PARLOUR, { x: 160, y: 90 }).y

const playingModel: Model = UiStruct.evolve(initialModel, {
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
        expect(cameraFor(PARLOUR, focus)).toMatchObject({
          x: 0,
          y: ONE_SCREEN_Y,
        })
      },
    )
    const seen = floorSeenOf(cameraFor(PARLOUR, { x: 160, y: 90 }))
    expect(seen.top).toBeLessThanOrEqual(PARLOUR.bounds.top)
    expect(seen.bottom).toBeGreaterThanOrEqual(PARLOUR.bounds.bottom)
  })

  test('follows the player across a map twice the width and stops at its edges', () => {
    expect(WIDE_LEVEL.width).toBe(VIEW_WIDTH * 2)
    expect(WIDE_LEVEL.height).toBe(VIEW_HEIGHT)

    expect(cameraFor(WIDE_LEVEL, { x: 320, y: 90 })).toMatchObject({
      x: 160,
      y: ONE_SCREEN_Y,
    })
    expect(cameraFor(WIDE_LEVEL, { x: 400.4, y: 30 })).toMatchObject({
      x: 240,
      y: ONE_SCREEN_Y,
    })
    expect(cameraFor(WIDE_LEVEL, { x: 40, y: 90 })).toMatchObject({
      x: 0,
      y: ONE_SCREEN_Y,
    })
    expect(cameraFor(WIDE_LEVEL, { x: 620, y: 170 })).toMatchObject({
      x: WIDE_LEVEL.width - VIEW_WIDTH,
      y: ONE_SCREEN_Y,
    })
  })

  test('keeps the followed player in the middle of the view between the edges', () => {
    const player = { x: 333, y: ONE_SCREEN_Y + VIEW_HEIGHT / 2 }
    const camera = cameraFor(WIDE_LEVEL, player)
    const onScreen = worldToView(camera, player)
    expect(Math.abs(onScreen.x - VIEW_WIDTH / 2)).toBeLessThanOrEqual(0.5)
    expect(nearly(viewToWorld(camera, onScreen))).toEqual(nearly(player))
  })

  test('centers a map narrower than the view and holds it still', () => {
    expect(NARROW_LEVEL.width).toBe(VIEW_WIDTH / 2)
    expect(cameraFor(NARROW_LEVEL, { x: 10, y: 90 })).toMatchObject({
      x: -VIEW_WIDTH / 4,
      y: ONE_SCREEN_Y,
    })
    expect(cameraFor(NARROW_LEVEL, { x: 150, y: 90 })).toMatchObject({
      x: -VIEW_WIDTH / 4,
      y: ONE_SCREEN_Y,
    })
  })

  test('aims the mouse at the world point under the cursor on a scrolled map', () => {
    const player = {
      ...focusOf(initialModel).player,
      x: 400,
      y: 90,
    }
    const camera = cameraFor(WIDE_LEVEL, player)
    expect(camera).toMatchObject({ x: 240, y: ONE_SCREEN_Y })

    const cursorInView = Option.getOrThrow(
      clientToView(WIDE_SURFACE, { x: 1120, y: 360 }),
    )
    expect(cursorInView).toEqual({ x: 280, y: 90 })
    const underCursor = viewToWorld(camera, cursorInView)
    expect(nearly(worldToView(camera, underCursor))).toEqual(
      nearly(cursorInView),
    )
    expect(underCursor.x).toBeGreaterThan(player.x + 100)

    const east = worldToView(camera, { x: 520, y: 90 })
    const scrolledAim = deriveIntent(mouseInputAt(east), player, camera)
    expect(nearly(Option.getOrThrow(scrolledAim.maybeAim))).toEqual(
      nearly({ x: 1, y: 0 }),
    )

    const west = worldToView(camera, { x: 340, y: 90 })
    const followedAim = deriveIntent(mouseInputAt(west), player, camera)
    expect(nearly(Option.getOrThrow(followedAim.maybeAim))).toEqual(
      nearly({ x: -1, y: 0 }),
    )
    expect(nearly(viewToWorld(camera, west))).toEqual(nearly({ x: 340, y: 90 }))
  })

  it.effect('in the arena, the mouse aims where it points on the screen', () =>
    modelAfter(
      modifyFocus(playingModel, {
        player: player => ({ ...player, x: 100, y: 90 }),
      }),
      steps(
        send(Message.MovedMouse({ clientX: 1000, clientY: 360 })),
        checkModel(current => {
          expect(cameraOf(current)).toMatchObject({ x: 0 })
          expect(current.input.maybeMouseInView).toEqual(
            Option.some({ x: 250, y: 90 }),
          )
          const target = viewToWorld(cameraOf(current), { x: 250, y: 90 })
          const length = Math.hypot(target.x - 100, target.y - 90)
          expect(
            nearly(Option.getOrThrow(focusOf(current).intent.maybeAim)),
          ).toEqual(
            nearly({
              x: (target.x - 100) / length,
              y: (target.y - 90) / length,
            }),
          )
        }),
      ),
    ),
  )
})
