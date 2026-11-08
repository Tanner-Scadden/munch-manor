import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { isSolidAt, levelOf } from './arena'
import { BULLET_STEP_PX, TILE_SIZE } from './constants'
import { Message } from './message'
import { type Model, Phase, type Vector } from './model'
import { focusOf, modifyFocus } from './party'
import { initialModel, update } from './pureApp'
import { aimSightShapes } from './sightView'
import { SHOTGUN, holdingFirst, holdingSecond } from './testing'
import { asVeteran } from './veteran'

const fighting: Model = modifyFocus(
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
  }),
  {
    player: player =>
      modifyFields(player, {
        y: () => 70,
        arsenal: () => holdingFirst(SHOTGUN),
      }),
    laserSight: () => 'Fitted',
  },
)

const unfitted: Model = modifyFocus(fighting, { laserSight: () => 'None' })

// NOTE: the right thumb aims exactly along its deflection, so a stick pushed
// straight right or straight up gives a sight to test against.
const THUMB = 70

const thumbAim = (dx: number, dy: number) => [
  message(
    Message.PressedPointer({
      pointerId: THUMB,
      device: 'Touch',
      clientX: 600,
      clientY: 200,
    }),
  ),
  message(
    Message.MovedPointer({
      pointerId: THUMB,
      clientX: 600 + dx,
      clientY: 200 + dy,
    }),
  ),
]

const liftThumb = message(Message.ReleasedPointer({ pointerId: THUMB }))

const onlyPath = (current: Model) => {
  const shapes = aimSightShapes(current)
  expect(shapes).toHaveLength(1)
  const shape = Option.getOrThrow(Array.head(shapes))
  if (shape._tag !== 'Path') {
    throw new Error(`expected a Path, got ${shape._tag}`)
  }
  return shape
}

const pointOf = (instruction: Canvas.PathInstruction): Vector => {
  if (instruction._tag === 'MoveTo' || instruction._tag === 'LineTo') {
    return { x: instruction.x, y: instruction.y }
  } else {
    throw new Error(`expected a point, got ${instruction._tag}`)
  }
}

describe('the laser sight', () => {
  test('shows nothing until it is bought, whichever device aims', () => {
    story(
      update,
      given(unfitted),
      message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      model(current => {
        expect(aimSightShapes(current)).toEqual([])
      }),
      ...thumbAim(50, 0),
      model(current => {
        expect(aimSightShapes(current)).toEqual([])
      }),
    )
  })

  test('once fitted it shows for the mouse', () => {
    story(
      update,
      given(fighting),
      message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      model(current => {
        expect(aimSightShapes(current)).toHaveLength(1)
      }),
    )
  })

  test('draws a laser line for the pistol that stops at the wall', () => {
    story(
      update,
      given(fighting),
      ...thumbAim(50, 0),
      model(current => {
        const laser = onlyPath(current)
        expect(laser.fill).toBeUndefined()
        expect(laser.instructions).toHaveLength(2)
        const [from, to] = Array.map(laser.instructions, pointOf)
        expect(from).toBeDefined()
        expect(to).toBeDefined()
        if (from === undefined || to === undefined) {
          return
        }
        expect(from.x).toBeGreaterThan(focusOf(current).player.x)
        expect(to.y).toBeCloseTo(from.y)
        expect(to.x).toBeGreaterThan(from.x)
        const level = levelOf(current)
        expect(isSolidAt(level, to)).toBe(false)
        expect(isSolidAt(level, { x: to.x + BULLET_STEP_PX, y: to.y })).toBe(
          true,
        )
      }),
    )
  })

  test('draws a fan as wide as the shotgun spread', () => {
    story(
      update,
      given(
        modifyFocus(fighting, {
          player: player =>
            modifyFields(player, {
              arsenal: () => holdingSecond(SHOTGUN),
            }),
        }),
      ),
      ...thumbAim(50, 0),
      model(current => {
        const fan = onlyPath(current)
        expect(fan.fill).toBeDefined()
        expect(fan.instructions).toHaveLength(4)
        const [from, left, right] = Array.map(
          Array.take(fan.instructions, 3),
          pointOf,
        )
        expect(from).toBeDefined()
        expect(left).toBeDefined()
        expect(right).toBeDefined()
        if (from === undefined || left === undefined || right === undefined) {
          return
        }
        expect(left.y).toBeLessThan(from.y)
        expect(right.y).toBeGreaterThan(from.y)
        expect(left.x).toBeGreaterThan(from.x)
        expect(right.x).toBeGreaterThan(from.x)
      }),
    )
  })

  test('stops at a doorway instead of leaving the room', () => {
    story(
      update,
      given(
        modifyFocus(fighting, { player: player => ({ ...player, y: 90 }) }),
      ),
      ...thumbAim(50, 0),
      model(current => {
        const [, to] = Array.map(onlyPath(current).instructions, pointOf)
        expect(to).toBeDefined()
        if (to === undefined) {
          return
        }
        expect(to.x).toBeLessThan(levelOf(current).columns * TILE_SIZE)
      }),
    )
  })

  test('follows whichever device aims', () => {
    story(
      update,
      given(fighting),
      ...thumbAim(0, -50),
      model(current => {
        const to = Option.getOrThrow(
          Array.get(Array.map(onlyPath(current).instructions, pointOf), 1),
        )
        expect(to.y).toBeLessThan(focusOf(current).player.y)
      }),
      liftThumb,
      message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      model(current => {
        const to = Option.getOrThrow(
          Array.get(Array.map(onlyPath(current).instructions, pointOf), 1),
        )
        expect(to.x).toBeGreaterThan(focusOf(current).player.x)
      }),
    )
  })
})
