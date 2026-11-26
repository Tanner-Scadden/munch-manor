// The lens in tests: a walk straight along the floor through the lens's
// turn, the floor a camera really shows, and points compared past the
// float noise of the lens there and back (src/render/lens.ts).

import { Message } from '../app/message'
import {
  type LensFrame,
  floorToScreenDirection,
  lensOf,
  screenToFloorDirection,
} from '../render/lens'
import { STICK_RADIUS_PX } from '../shared/constants'
import { hypot } from '../shared/detMath'
import type { Vector } from '../world/schema/entitySchema'
import { type StoryStep, send, steps } from './testing'

const WALK_THUMB = 71

// NOTE: a thumb that lands on the move stick and pushes it all the way
// toward a direction on the floor, as the screen shows it through the lens,
// so the player walks straight that way on the game's map: for the tests
// about where a walk ends, not about which key walks where.
export const walkToward = (direction: Vector): StoryStep => {
  const onScreen = floorToScreenDirection(direction)
  const length = Math.max(1e-9, hypot(onScreen.x, onScreen.y))
  return steps(
    send(
      Message.PressedPointer({
        pointerId: WALK_THUMB,
        device: 'Touch',
        clientX: 100,
        clientY: 200,
      }),
    ),
    send(
      Message.MovedPointer({
        pointerId: WALK_THUMB,
        clientX: 100 + (onScreen.x / length) * STICK_RADIUS_PX,
        clientY: 200 + (onScreen.y / length) * STICK_RADIUS_PX,
      }),
    ),
  )
}

// NOTE: the walking thumb lifted, so the player stops.
export const releaseWalk: StoryStep = send(
  Message.ReleasedPointer({ pointerId: WALK_THUMB }),
)

// NOTE: straight right on the screen (D, a stick, a pad) as the floor way
// under it, through the lens's turn (src/render/lens.ts).
export const RIGHT_ON_SCREEN = screenToFloorDirection({ x: 1, y: 0 })

// NOTE: the floor rows the lens shows at the middle of a camera's top and
// bottom edges: the stretch of the map the view really holds, for the
// tests about where the camera stops.
export const floorSeenOf = (
  camera: LensFrame,
): Readonly<{ top: number; bottom: number }> => {
  const lens = lensOf(camera)
  const middleX = camera.left + (camera.width * camera.scale) / 2
  const at = { x: 0, y: 0 }
  const top = lens.unprojectInto(middleX, camera.top, at).y
  const bottom = lens.unprojectInto(
    middleX,
    camera.top + camera.height * camera.scale,
    at,
  ).y
  return { top, bottom }
}

// NOTE: a point or a direction to six places: the lens there and back
// (src/render/lens.ts) leaves float noise past them, so a test compares two
// of these with toEqual.
export const nearly = ({ x, y }: Vector): Vector => ({
  x: Math.round(x * 1e6) / 1e6 + 0,
  y: Math.round(y * 1e6) / 1e6 + 0,
})
