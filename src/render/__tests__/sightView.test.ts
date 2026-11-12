import { Array, Option } from 'effect'
import { type Canvas, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase, type Vector } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { BULLET_STEP_PX, TILE_SIZE } from '../../shared/constants'
import { SHOTGUN, holdingFirst, holdingSecond } from '../../test/arsenals'
import { APPLICATION } from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { levelOf } from '../../world/level/arena'
import { isSolidAt } from '../../world/level/tileQueries'
import { focusOf, modifyFocus } from '../../world/party/party'
import { aimSightShapes } from '../sightView'

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
  Story.message(
    Message.PressedPointer({
      pointerId: THUMB,
      device: 'Touch',
      clientX: 600,
      clientY: 200,
    }),
  ),
  Story.message(
    Message.MovedPointer({
      pointerId: THUMB,
      clientX: 600 + dx,
      clientY: 200 + dy,
    }),
  ),
]

const liftThumb = Story.message(Message.ReleasedPointer({ pointerId: THUMB }))

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
  it.effect('shows nothing until it is bought, whichever device aims', () =>
    Story.story(
      APPLICATION,
      Story.given(unfitted),
      Story.message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      Story.model(current => {
        expect(aimSightShapes(current)).toEqual([])
      }),
      ...thumbAim(50, 0),
      Story.model(current => {
        expect(aimSightShapes(current)).toEqual([])
      }),
    ),
  )

  it.effect('once fitted it shows for the mouse', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      Story.message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      Story.model(current => {
        expect(aimSightShapes(current)).toHaveLength(1)
      }),
    ),
  )

  it.effect('draws a laser line for the pistol that stops at the wall', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      ...thumbAim(50, 0),
      Story.model(current => {
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
  )

  it.effect('draws a fan as wide as the shotgun spread', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(fighting, {
          player: player =>
            modifyFields(player, {
              arsenal: () => holdingSecond(SHOTGUN),
            }),
        }),
      ),
      ...thumbAim(50, 0),
      Story.model(current => {
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
  )

  it.effect('stops at a doorway instead of leaving the room', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(fighting, { player: player => ({ ...player, y: 90 }) }),
      ),
      ...thumbAim(50, 0),
      Story.model(current => {
        const [, to] = Array.map(onlyPath(current).instructions, pointOf)
        expect(to).toBeDefined()
        if (to === undefined) {
          return
        }
        expect(to.x).toBeLessThan(levelOf(current).columns * TILE_SIZE)
      }),
    ),
  )

  it.effect('follows whichever device aims', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      ...thumbAim(0, -50),
      Story.model(current => {
        const to = Option.getOrThrow(
          Array.get(Array.map(onlyPath(current).instructions, pointOf), 1),
        )
        expect(to.y).toBeLessThan(focusOf(current).player.y)
      }),
      liftThumb,
      Story.message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      Story.model(current => {
        const to = Option.getOrThrow(
          Array.get(Array.map(onlyPath(current).instructions, pointOf), 1),
        )
        expect(to.x).toBeGreaterThan(focusOf(current).player.x)
      }),
    ),
  )
})
