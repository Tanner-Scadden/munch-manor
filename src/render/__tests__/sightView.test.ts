import { Array, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase, type Vector } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { BULLET_STEP_PX, TILE_SIZE } from '../../shared/constants'
import { SHOTGUN, holdingFirst, holdingSecond } from '../../test/arsenals'
import { checkModel, modelAfter, send, steps } from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { levelOf } from '../../world/level/arena'
import { isSolidAt } from '../../world/level/tileQueries'
import { focusOf, modifyFocus } from '../../world/party/party'
import type * as Draw from '../draw'
import { floorToScreenDirection } from '../lens'
import { aimSightShapes } from '../sightView'

const fighting: Model = modifyFocus(
  UiStruct.evolve(asVeteran(initialModel), {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
  }),
  {
    player: player =>
      UiStruct.evolve(player, {
        y: () => 70,
        arsenal: () => holdingFirst(SHOTGUN),
      }),
    laserSight: () => 'Fitted',
  },
)

const unfitted: Model = modifyFocus(fighting, { laserSight: () => 'None' })

const THUMB = 70

const thumbAim = (dx: number, dy: number) => {
  const onScreen = floorToScreenDirection({ x: dx, y: dy })
  const stretch = Math.hypot(dx, dy) / Math.hypot(onScreen.x, onScreen.y)
  return [
    send(
      Message.PressedPointer({
        pointerId: THUMB,
        device: 'Touch',
        clientX: 600,
        clientY: 200,
      }),
    ),
    send(
      Message.MovedPointer({
        pointerId: THUMB,
        clientX: 600 + onScreen.x * stretch,
        clientY: 200 + onScreen.y * stretch,
      }),
    ),
  ]
}

const liftThumb = send(Message.ReleasedPointer({ pointerId: THUMB }))

const onlyPath = (current: Model) => {
  const shapes = aimSightShapes(current)
  expect(shapes).toHaveLength(1)
  const shape = Option.getOrThrow(Array.head(shapes))
  if (shape._tag !== 'Path') {
    throw new Error(`expected a Path, got ${shape._tag}`)
  }
  return shape
}

const pointOf = (instruction: Draw.PathInstruction): Vector => {
  if (instruction._tag === 'MoveTo' || instruction._tag === 'LineTo') {
    return { x: instruction.x, y: instruction.y }
  } else {
    throw new Error(`expected a point, got ${instruction._tag}`)
  }
}

describe('the laser sight', () => {
  it.effect('shows nothing until it is bought, whichever device aims', () =>
    modelAfter(
      unfitted,
      steps(
        send(Message.MovedMouse({ clientX: 700, clientY: 200 })),
        checkModel(current => {
          expect(aimSightShapes(current)).toEqual([])
        }),
        ...thumbAim(50, 0),
        checkModel(current => {
          expect(aimSightShapes(current)).toEqual([])
        }),
      ),
    ),
  )

  it.effect('once fitted it shows for the mouse', () =>
    modelAfter(
      fighting,
      steps(
        send(Message.MovedMouse({ clientX: 700, clientY: 200 })),
        checkModel(current => {
          expect(aimSightShapes(current)).toHaveLength(1)
        }),
      ),
    ),
  )

  it.effect('draws a laser line for the pistol that stops at the wall', () =>
    modelAfter(
      fighting,
      steps(
        ...thumbAim(50, 0),
        checkModel(current => {
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
      ),
    ),
  )

  it.effect('draws a fan as wide as the shotgun spread', () =>
    modelAfter(
      modifyFocus(fighting, {
        player: player =>
          UiStruct.evolve(player, {
            arsenal: () => holdingSecond(SHOTGUN),
          }),
      }),
      steps(
        ...thumbAim(50, 0),
        checkModel(current => {
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
      ),
    ),
  )

  it.effect('stops at a doorway instead of leaving the room', () =>
    modelAfter(
      modifyFocus(fighting, { player: player => ({ ...player, y: 90 }) }),
      steps(
        ...thumbAim(50, 0),
        checkModel(current => {
          const [, to] = Array.map(onlyPath(current).instructions, pointOf)
          expect(to).toBeDefined()
          if (to === undefined) {
            return
          }
          expect(to.x).toBeLessThan(levelOf(current).columns * TILE_SIZE)
        }),
      ),
    ),
  )

  it.effect('follows whichever device aims', () =>
    modelAfter(
      fighting,
      steps(
        ...thumbAim(0, -50),
        checkModel(current => {
          const to = Option.getOrThrow(
            Array.get(Array.map(onlyPath(current).instructions, pointOf), 1),
          )
          expect(to.y).toBeLessThan(focusOf(current).player.y)
        }),
        liftThumb,
        send(Message.MovedMouse({ clientX: 700, clientY: 200 })),
        checkModel(current => {
          const to = Option.getOrThrow(
            Array.get(Array.map(onlyPath(current).instructions, pointOf), 1),
          )
          expect(to.x).toBeGreaterThan(focusOf(current).player.x)
        }),
      ),
    ),
  )
})
